"""Middleware that writes ActivityLog entries for MCP server requests.

After each write request (POST/PATCH/PUT/DELETE) that carries a valid
service JWT + X-MCP-Actor + X-MCP-Key-Id header pair, a background entry
is appended to the activity_logs table. The JWT is validated here to prevent
arbitrary callers from forging activity log entries via header spoofing.
"""

from collections.abc import Awaitable, Callable

import jwt as pyjwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.activity_log import ActorType
from app.services import activity as activity_service

_WRITE_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})
_BEARER_PREFIX = "Bearer "


def _has_valid_service_jwt(authorization: str | None) -> bool:
    if not authorization or not authorization.startswith(_BEARER_PREFIX):
        return False
    if not settings.mcp_signing_secret:
        return False
    token = authorization.removeprefix(_BEARER_PREFIX).strip()
    try:
        claims = pyjwt.decode(
            token,
            settings.mcp_signing_secret,
            algorithms=["HS256"],
            options={"require": ["exp"]},
        )
        return claims.get("iss") == "mcp-server" and claims.get("sub") == "service"
    except pyjwt.PyJWTError:
        return False


class MCPActivityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)

        actor = request.headers.get("X-MCP-Actor")
        key_id = request.headers.get("X-MCP-Key-Id")

        if (
            actor
            and key_id
            and request.method in _WRITE_METHODS
            and _has_valid_service_jwt(request.headers.get("authorization"))
        ):
            status_str = "success" if response.status_code < 400 else "error"
            action = f"{request.method.lower()}:{request.url.path}"
            # Use a fresh session so we never block or corrupt the request session.
            # Try with the key_id FK first; fall back to NULL if the key no longer
            # exists (revoked between request and log write) so the entry is never lost.
            try:
                async with AsyncSessionLocal() as db:
                    try:
                        await activity_service.log_activity(
                            db,
                            actor_type=ActorType.mcp_bot,
                            actor_username=actor,
                            api_key_id=key_id,
                            action=action,
                            status=status_str,
                        )
                    except Exception:
                        await db.rollback()
                        await activity_service.log_activity(
                            db,
                            actor_type=ActorType.mcp_bot,
                            actor_username=actor,
                            api_key_id=None,
                            action=action,
                            status=status_str,
                        )
            except Exception:  # pragma: no cover — never let logging break a response
                pass

        return response
