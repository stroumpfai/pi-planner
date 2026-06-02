import json
import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastmcp import FastMCP, Context
from fastmcp.server.auth import MultiAuth

from mcp_server.auth import APIKeyAuthProvider
from mcp_server.backend import get_client, set_http_client
from mcp_server.config import settings
from mcp_server.tools.read import read_mcp
from mcp_server.tools.projects import projects_mcp
from mcp_server.tools.swimlines import swimlines_mcp
from mcp_server.tools.features import features_mcp
from mcp_server.tools.groups import groups_mcp
from mcp_server.tools.workflows import workflows_mcp

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(server: FastMCP):
    """Create a shared httpx client at startup and close it on shutdown."""
    if settings.mcp_signing_secret in ("", "change-me"):
        raise RuntimeError(
            "MCP_SIGNING_SECRET is not configured. "
            "Set a strong random value (e.g. `openssl rand -hex 32`) in the environment."
        )
    log.info("PI Planner MCP server v%s starting...", os.environ.get("APP_VERSION", "dev"))
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


if __name__ == "__main__":
    # path="/" serves the MCP endpoint at root so Claude.ai/ChatGPT can connect
    # using the bare server URL (e.g. https://mcp.example.com) without a /mcp suffix.
    mcp.run(transport="streamable-http", port=settings.port, path="/")
