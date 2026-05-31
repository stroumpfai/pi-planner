import json
import logging
from contextlib import asynccontextmanager

import httpx
from fastmcp import FastMCP, Context

from mcp_server.auth import APIKeyAuthProvider
from mcp_server.backend import get_client, set_http_client
from mcp_server.config import settings
from mcp_server.tools.read import read_mcp
from mcp_server.tools.projects import projects_mcp

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(server: FastMCP):
    """Create a shared httpx client at startup and close it on shutdown."""
    async with httpx.AsyncClient(
        base_url=settings.backend_url,
        timeout=httpx.Timeout(10.0, connect=3.0),
    ) as client:
        set_http_client(client)
        yield {}


mcp = FastMCP(
    "pi-planner",
    lifespan=lifespan,
    auth=APIKeyAuthProvider(),
)
mcp.mount(read_mcp, "read")
mcp.mount(projects_mcp, "projects")


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
    mcp.run(transport="sse", port=settings.port)
