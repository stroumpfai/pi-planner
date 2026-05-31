import jwt
import time
import logging
from typing import Optional

import httpx
from fastmcp.server.dependencies import get_access_token

from mcp_server.config import settings

log = logging.getLogger(__name__)

# Module-level HTTP client set by the server lifespan.
# FastMCP v3 does not propagate the parent server's lifespan_context to
# mounted child servers, so we store the shared client here instead.
_http_client: Optional[httpx.AsyncClient] = None


def set_http_client(client: httpx.AsyncClient) -> None:
    global _http_client
    _http_client = client


def get_client() -> httpx.AsyncClient:
    if _http_client is None:
        raise RuntimeError("HTTP client not initialised — lifespan not entered")
    return _http_client


class MCPBackendError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def _mint_service_jwt() -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": "mcp-server", "sub": "service", "iat": now, "exp": now + 300},
        settings.mcp_signing_secret,
        algorithm="HS256",
    )


async def call_backend(method: str, path: str, **kwargs) -> dict:
    """
    Call the FastAPI backend using the shared httpx client.

    Mints a short-lived service JWT and attaches MCP actor headers so the backend
    can attribute the activity to the correct user. Classifies error responses into
    typed MCPBackendError exceptions with actionable messages for Claude.
    """
    client = get_client()
    access_token = get_access_token()
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {_mint_service_jwt()}"
    if access_token:
        headers["X-MCP-Actor"] = access_token.client_id
        headers["X-MCP-Key-Id"] = access_token.claims.get("key_id", "")

    start = time.monotonic()
    try:
        r = await client.request(method, path, headers=headers, **kwargs)
    except Exception:
        log.exception("backend_unreachable path=%s", path)
        raise MCPBackendError(
            503, "BACKEND_UNREACHABLE", "Backend is unreachable. Try again shortly."
        )

    elapsed_ms = int((time.monotonic() - start) * 1000)
    log.info(
        "backend_call method=%s path=%s status=%d elapsed_ms=%d",
        method,
        path,
        r.status_code,
        elapsed_ms,
    )

    if r.status_code == 409:
        body = {}
        try:
            body = r.json()
        except Exception:
            pass
        detail = body.get("detail", {}) if isinstance(body.get("detail"), dict) else {}
        locked_by = detail.get("locked_by", "another user")
        expires_at = detail.get("expires_at", "")
        retry_hint = (
            f" Lock expires at {expires_at}." if expires_at else " Try again in a few minutes."
        )
        raise MCPBackendError(
            409, "LOCKED", f"Project is being edited by {locked_by}.{retry_hint}"
        )
    if r.status_code == 403:
        raise MCPBackendError(403, "FORBIDDEN", "Your role does not permit this action.")
    if r.status_code == 422:
        raise MCPBackendError(
            422, "VALIDATION_ERROR", f"Invalid input: {r.json().get('detail')}"
        )
    if r.status_code >= 500:
        raise MCPBackendError(r.status_code, "BACKEND_ERROR", "Backend error. Try again later.")

    r.raise_for_status()
    data = r.json() if r.content else {}
    # FastMCP v3 requires tools to return dicts; wrap list responses so they
    # are consistent with the dict-only contract.
    if isinstance(data, list):
        return {"items": data}
    return data
