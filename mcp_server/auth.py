import hashlib
import logging
import time
from collections import defaultdict

import httpx

from fastmcp.server.auth import TokenVerifier
from fastmcp.server.dependencies import AccessToken, get_http_request

from mcp_server.config import settings
from mcp_server.jwt_utils import mint_service_jwt

log = logging.getLogger(__name__)


# Sliding-window rate limiter state (shared with the OAuth consent path).
_failed_auth: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 60
_RATE_LIMIT = 20

# Short-lived positive cache for API-key verification. The direct-Bearer path
# verifies the key on *every* MCP call; without this each tool call would incur
# an extra backend round-trip (plus a fresh TCP/TLS handshake and a JWT mint).
# Only successful verifications are cached, keyed by a hash of the token so the
# raw secret never sits in the map. TTL is deliberately short so revoked or
# role-changed keys stop working within a minute.
_verify_cache: dict[str, tuple[float, tuple[str, str, str]]] = {}
_VERIFY_CACHE_TTL = 60.0


class BackendAuthUnavailable(Exception):
    """The backend could not be reached (network error or 5xx) while verifying a key.

    Distinct from an *invalid* key (which yields None): callers must NOT treat this
    as an authentication failure — doing so would let a transient backend outage
    poison the rate limiter and lock out legitimate clients.
    """


def is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    recent = [t for t in _failed_auth.get(ip, []) if now - t < _RATE_WINDOW]
    # Prune the bucket so IPs that stop failing don't linger forever (memory leak).
    if recent:
        _failed_auth[ip] = recent
    else:
        _failed_auth.pop(ip, None)
    return len(recent) >= _RATE_LIMIT


def record_auth_failure(ip: str) -> None:
    _failed_auth[ip].append(time.monotonic())


def clear_auth_failures(ip: str) -> None:
    _failed_auth.pop(ip, None)


def client_ip(request) -> str:
    """Best-effort client IP for rate limiting.

    Behind a reverse proxy the socket peer is the proxy itself, so every client
    would share one bucket. When ``trust_proxy_headers`` is enabled we key on the
    leftmost X-Forwarded-For entry instead. It stays off by default because the
    header is client-spoofable when the server is directly exposed.
    """
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"


def _cache_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _cache_get(token: str) -> tuple[str, str, str] | None:
    key = _cache_key(token)
    entry = _verify_cache.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at <= time.monotonic():
        _verify_cache.pop(key, None)
        return None
    return value


def _cache_put(token: str, value: tuple[str, str, str]) -> None:
    _verify_cache[_cache_key(token)] = (time.monotonic() + _VERIFY_CACHE_TTL, value)


def clear_verify_cache() -> None:
    _verify_cache.clear()


def actor_username(token: AccessToken) -> str:
    """The PI Planner username this token acts as.

    The single, documented source of truth for X-MCP-Actor: always
    server-derived from verify_api_key(), never from client-supplied data
    such as an OAuth client_id (which AccessToken.client_id now carries).
    """
    return token.claims.get("username", "")


async def verify_api_key(raw_token: str) -> tuple[str, str, str] | None:
    """
    Verify token by calling backend POST /api/v1/api-keys/admin/verify.

    Returns (key_id, username, role) on success, None if the key is genuinely
    invalid (backend responded 4xx). Raises BackendAuthUnavailable if the backend
    could not be reached or returned 5xx — the caller must distinguish this from
    an invalid key so a backend blip does not get charged as an auth failure.

    Successful results are cached for _VERIFY_CACHE_TTL seconds.
    """
    cached = _cache_get(raw_token)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(base_url=settings.backend_url, timeout=5.0) as client:
            r = await client.post(
                "/api/v1/api-keys/admin/verify",
                json={"token": raw_token},
                headers={"Authorization": f"Bearer {mint_service_jwt()}"},
            )
    except Exception as exc:
        raise BackendAuthUnavailable(f"backend unreachable: {exc}") from exc

    if r.status_code == 200:
        try:
            data = r.json()
            result = (data["key_id"], data["username"], data["role"])
        except (KeyError, ValueError):
            log.warning("api_key_verify malformed 200 response")
            return None
        _cache_put(raw_token, result)
        return result

    if r.status_code >= 500:
        raise BackendAuthUnavailable(f"backend returned {r.status_code}")

    # 401/403/etc. — the key is genuinely invalid.
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
            ip = client_ip(request)
        except RuntimeError:
            ip = "unknown"

        if is_rate_limited(ip):
            return None

        try:
            result = await verify_api_key(token)
        except BackendAuthUnavailable as exc:
            # Transient backend problem — reject this request but do NOT record a
            # failure, or a backend outage would rate-limit legitimate clients.
            log.warning("api_key_verify backend unavailable: %s", exc)
            return None

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
            client_id=key_id,
            scopes=scopes,
            claims={"key_id": key_id, "username": username, "role": role},
        )
