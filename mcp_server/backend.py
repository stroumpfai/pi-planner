import time
import logging
from typing import Optional

import httpx
from fastmcp.server.dependencies import get_access_token

from mcp_server.auth import actor_username
from mcp_server.config import settings
from mcp_server.jwt_utils import mint_service_jwt

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


async def _make_request(method: str, path: str, **kwargs) -> httpx.Response:
    """Build auth headers, call the backend, raise on errors, and return the raw response."""
    client = get_client()
    access_token = get_access_token()
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {mint_service_jwt()}"
    if access_token:
        headers["X-MCP-Actor"] = actor_username(access_token)
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
    _raise_for_error(r)
    return r


async def call_backend_raw(method: str, path: str, **kwargs) -> httpx.Response:
    """
    Like call_backend but returns the raw httpx.Response.

    Use this for endpoints that return non-JSON content (CSV text, PNG binary, etc.).
    Auth headers and error handling are applied identically to call_backend.
    """
    return await _make_request(method, path, **kwargs)


async def call_backend(method: str, path: str, **kwargs) -> dict:
    """
    Call the FastAPI backend using the shared httpx client.

    Mints a short-lived service JWT and attaches MCP actor headers so the backend
    can attribute the activity to the correct user. Classifies error responses into
    typed MCPBackendError exceptions with actionable messages for Claude.
    """
    r = await _make_request(method, path, **kwargs)
    data = r.json() if r.content else {}
    # FastMCP v3 requires tools to return dicts; wrap list responses so they
    # are consistent with the dict-only contract.
    if isinstance(data, list):
        return {"items": data}
    return data


def _raise_for_error(r: httpx.Response) -> None:
    """Classify error responses into typed MCPBackendError exceptions."""
    if r.status_code == 409:
        _raise_409(r)
    if r.status_code == 403:
        raise MCPBackendError(403, "FORBIDDEN", "Your role does not permit this action.")
    if r.status_code == 422:
        raise MCPBackendError(
            422, "VALIDATION_ERROR", f"Invalid input: {r.json().get('detail')}"
        )
    if r.status_code >= 500:
        raise MCPBackendError(r.status_code, "BACKEND_ERROR", "Backend error. Try again later.")
    r.raise_for_status()


def _raise_409(r: httpx.Response) -> None:
    """Raise CONFLICT for business-logic 409s or LOCKED for edit-lock 409s."""
    body = {}
    try:
        body = r.json()
    except Exception:
        pass
    detail = body.get("detail")
    detail_dict = detail if isinstance(detail, dict) else {}
    # Business-logic 409s carry an "error" code (e.g. STORY_ALREADY_GROUPED).
    # Edit-lock 409s use a plain string or a dict with locked_by/expires_at.
    if isinstance(detail, dict) and "error" in detail:
        raise MCPBackendError(409, "CONFLICT", detail_dict.get("message", "Conflict."))
    locked_by = detail_dict.get("locked_by", "another user")
    expires_at = detail_dict.get("expires_at", "")
    retry_hint = f" Lock expires at {expires_at}." if expires_at else " Try again in a few minutes."
    raise MCPBackendError(409, "LOCKED", f"Project is being edited by {locked_by}.{retry_hint}")
