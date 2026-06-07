import httpx
from collections import defaultdict
import time

from fastmcp.server.auth import TokenVerifier
from fastmcp.server.dependencies import AccessToken, get_http_request

from mcp_server.config import settings
from mcp_server.jwt_utils import mint_service_jwt


# Sliding-window rate limiter state (shared with server.py's ASGI middleware).
_failed_auth: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 60
_RATE_LIMIT = 20


def is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    _failed_auth[ip] = [t for t in _failed_auth[ip] if now - t < _RATE_WINDOW]
    return len(_failed_auth[ip]) >= _RATE_LIMIT


def record_auth_failure(ip: str) -> None:
    _failed_auth[ip].append(time.monotonic())


def clear_auth_failures(ip: str) -> None:
    _failed_auth.pop(ip, None)


async def verify_api_key(raw_token: str) -> tuple[str, str, str] | None:
    """
    Verify token by calling backend POST /api/v1/api-keys/admin/verify.
    Returns (key_id, username, role) or None if invalid.

    Creates a short-lived httpx client per call — this is auth-only, not a hot path.
    """
    try:
        async with httpx.AsyncClient(base_url=settings.backend_url, timeout=5.0) as client:
            r = await client.post(
                "/api/v1/api-keys/admin/verify",
                json={"token": raw_token},
                headers={"Authorization": f"Bearer {mint_service_jwt()}"},
            )
            if r.status_code == 200:
                data = r.json()
                return data["key_id"], data["username"], data["role"]
        return None
    except Exception:
        return None


class APIKeyAuthProvider(TokenVerifier):
    """FastMCP v3 native auth provider that verifies PI Planner API keys.

    Integrates with FastMCP's SSE transport correctly (no BaseHTTPMiddleware
    buffering). Records auth failures for the rate limiter.

    Scope model:
      admin  → AccessToken(scopes=["admin", "editor"])  — passes required_scopes=["editor"]
      editor → AccessToken(scopes=["editor"])            — passes required_scopes=["editor"]
      reader → AccessToken(scopes=["reader"])            — fails required_scopes=["editor"] → 403
      invalid → None                                     → 401

    required_scopes=["editor"] ensures RequireAuthMiddleware returns a proper
    403 insufficient_scope (not a generic 401) when a valid reader key is used,
    allowing MCP clients to trigger a step-up authorization flow.
    """

    def __init__(self) -> None:
        super().__init__(required_scopes=["editor"])

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            request = get_http_request()
            ip = request.client.host if request.client else "unknown"
        except RuntimeError:
            ip = "unknown"

        if is_rate_limited(ip):
            return None

        result = await verify_api_key(token)
        if result is None:
            record_auth_failure(ip)
            return None

        key_id, username, role = result

        # Clear failure history on any valid credential (admin, editor, or reader).
        clear_auth_failures(ip)

        # Admin tokens carry both scopes so required_scopes=["editor"] passes for admins too.
        scopes = ["admin", "editor"] if role == "admin" else [role]

        return AccessToken(
            token=token,
            client_id=username,
            scopes=scopes,
            claims={"key_id": key_id, "role": role},
        )
