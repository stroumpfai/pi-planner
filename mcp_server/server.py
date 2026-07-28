import logging
import os

# Must run before any other imports so that FastMCP / uvicorn cannot pre-empt it.
# force=True removes any handlers that may already exist (e.g. from a pytest run)
# so the level always takes effect.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "WARNING").upper(), force=True)

import json
from contextlib import asynccontextmanager

import httpx
from fastmcp import FastMCP, Context
from fastmcp.server.auth import MultiAuth

from mcp_server.auth import APIKeyAuthProvider
from mcp_server.backend import call_backend_raw, get_client, set_http_client
from mcp_server.config import settings
from mcp_server.oauth_provider import ScopeHintMiddleware
from mcp_server.tools.read import read_mcp
from mcp_server.tools.projects import projects_mcp
from mcp_server.tools.swimlines import swimlines_mcp
from mcp_server.tools.features import features_mcp
from mcp_server.tools.groups import groups_mcp
from mcp_server.tools.workflows import workflows_mcp
from mcp_server.tools.pi_events import pi_events_mcp

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(server: FastMCP):
    """Create a shared httpx client at startup and close it on shutdown."""
    if settings.mcp_signing_secret in ("", "change-me"):
        raise RuntimeError(
            "MCP_SIGNING_SECRET is not configured. "
            "Set a strong random value (e.g. `openssl rand -hex 32`) in the environment."
        )
    from importlib.metadata import version as _pkg_version
    log.info(
        "PI Planner MCP server v%s starting... (mcp=%s)",
        os.environ.get("APP_VERSION", "dev"),
        _pkg_version("mcp"),
    )
    if settings.oauth_base_url:
        log.info("OAuth enabled — base URL: %s", settings.oauth_base_url)
        log.info("  discovery: %s/.well-known/oauth-authorization-server", settings.oauth_base_url.rstrip("/"))
        log.info("  token storage: %s", settings.oauth_token_storage)
    else:
        log.warning(
            "OAUTH_BASE_URL is not set — OAuth disabled. "
            "Claude.ai and ChatGPT will not be able to connect. "
            "Set OAUTH_BASE_URL=https://your-mcp-host in mcp_server/.env to enable OAuth."
        )
    async with httpx.AsyncClient(
        base_url=settings.backend_url,
        timeout=httpx.Timeout(10.0, connect=3.0),
    ) as client:
        set_http_client(client)
        yield {}


_api_key_auth = APIKeyAuthProvider()

if settings.oauth_base_url:
    from mcp_server.oauth_provider import PiPlannerOAuthProvider

    _oauth = PiPlannerOAuthProvider(
        base_url=settings.oauth_base_url,
        token_storage_path=settings.oauth_token_storage,
        token_ttl=settings.oauth_token_ttl,
        refresh_token_ttl=settings.oauth_refresh_token_ttl,
    )
    _auth = MultiAuth(server=_oauth, verifiers=[_api_key_auth])
else:
    _auth = _api_key_auth

mcp = FastMCP(
    "pi-planner",
    lifespan=lifespan,
    auth=_auth,
)
mcp.mount(read_mcp, "read")
mcp.mount(projects_mcp, "projects")
mcp.mount(swimlines_mcp, "swimlines")
mcp.mount(features_mcp, "features")
mcp.mount(groups_mcp, "groups")
mcp.mount(workflows_mcp, "workflows")
mcp.mount(pi_events_mcp, "pi_events")


@mcp.resource("health://status")
async def health_check(ctx: Context) -> str:
    """
    Check MCP server and backend health.

    Returns overall status: healthy | degraded | unhealthy.
    Forwards component-level health from the backend (database, disk).
    Call this before running compound workflows to verify connectivity.
    """
    client = get_client()
    try:
        r = await client.get("/health", timeout=3.0)
        if r.status_code == 200:
            backend_data = r.json()
            backend_status = backend_data.get("status", "healthy")
        elif r.status_code == 503:
            backend_data = r.json()
            backend_status = backend_data.get("status", "degraded")
        else:
            backend_data = {}
            backend_status = "unhealthy"
    except Exception as exc:
        backend_data = {"error": str(exc)}
        backend_status = "unhealthy"

    overall = "healthy" if backend_status == "healthy" else backend_status
    return json.dumps(
        {
            "status": overall,
            "mcp": "healthy",
            "backend": backend_status,
            "components": backend_data.get("components", {}),
        }
    )


@mcp.resource("dashboard://pi/{pi_id}", mime_type="text/html")
async def pi_dashboard(pi_id: str, ctx: Context) -> str:
    """
    Live HTML dashboard for a PI (C1).

    A self-contained page (inline CSS/JS, no external calls) bundling the
    glanceable planning views: per-sprint capacity gauges, the capacity-vs-load
    heatmap (team × sprint), the backlog-composition grid (PBI/bug counts), and a
    milestone timeline. Regenerated from live data on each read.

    `pi_id` is a PI system_id (UUID) — discover it with the read `list_pis` tool.
    Equivalent to the export_pi_dashboard tool; exposed as a resource for clients
    that consume resources.
    """
    r = await call_backend_raw("GET", f"/api/v1/pis/{pi_id}/export/html?refresh_seconds=0")
    return r.text


@mcp.resource("snapshot-diff://project/{project_id}", mime_type="text/html")
async def snapshot_diff(project_id: str, ctx: Context) -> str:
    """
    Live HTML diff of a project's current state vs. its latest snapshot.

    A self-contained page (inline CSS/JS, no external calls) showing what was
    added, removed, and changed across features, PBIs, PIs, swimlanes, sprints,
    groups, and events since the most recent snapshot — with an effort headline
    and field-level from → to deltas. Regenerated from live data on each read.

    `project_id` is a project system_id (UUID) — discover it with the read
    `list_projects` tool. Covers the common "latest snapshot, whole project" case;
    for an older baseline or a single-PI scope use the export_snapshot_diff tool.
    Equivalent to the JSON diff_snapshot tool, rendered for clients that consume
    resources.
    """
    r = await call_backend_raw(
        "GET", f"/api/v1/projects/{project_id}/snapshots/diff/html?refresh_seconds=0"
    )
    return r.text


if __name__ == "__main__":
    from starlette.middleware import Middleware as _Middleware

    # path="/" serves the MCP endpoint at root so Claude.ai/ChatGPT can connect
    # using the bare server URL (e.g. https://mcp.example.com) without a /mcp suffix.
    # ScopeHintMiddleware adds scope="admin editor" to WWW-Authenticate headers on
    # 401/403 responses so spec-compliant clients know what scopes to request (Finding 6).
    #
    # NOTE: run this as a SINGLE process. The OAuth token store, pending-consent
    # sessions, the API-key verification cache, and the auth rate limiter are all
    # per-process in-memory state. Running multiple uvicorn workers would split
    # that state across processes and cause intermittent auth/consent failures.
    # Scale horizontally only after moving this state to a shared backing store.
    mcp.run(
        transport="streamable-http",
        port=settings.port,
        path="/",
        middleware=[_Middleware(ScopeHintMiddleware, scopes=["admin", "editor"])],
    )
