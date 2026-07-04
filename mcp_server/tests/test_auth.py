import httpx
import pytest

from fastmcp.server.auth import TokenVerifier

from mcp_server.auth import (
    APIKeyAuthProvider,
    BackendAuthUnavailable,
    verify_api_key,
    is_rate_limited,
    record_auth_failure,
    _failed_auth,
    _RATE_LIMIT,
    clear_verify_cache,
)


async def test_valid_token_returns_key_id_username_role(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_abc", "username": "alice", "role": "admin"}
        )
    )
    result = await verify_api_key("kid_abc.secretpart")
    assert result == ("kid_abc", "alice", "admin")


async def test_401_from_backend_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    result = await verify_api_key("kid_bad.badsecret")
    assert result is None


async def test_expired_key_401_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, json={"detail": "API key expired"})
    )
    result = await verify_api_key("kid_old.oldsecret")
    assert result is None


async def test_revoked_key_401_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, json={"detail": "API key revoked"})
    )
    result = await verify_api_key("kid_rev.secret")
    assert result is None


async def test_backend_unreachable_raises(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    with pytest.raises(BackendAuthUnavailable):
        await verify_api_key("kid_abc.secret")


async def test_backend_500_raises(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(500, text="Server Error")
    )
    with pytest.raises(BackendAuthUnavailable):
        await verify_api_key("kid_abc.secret")


async def test_empty_token_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    result = await verify_api_key("")
    assert result is None


async def test_editor_role_returned_correctly(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_xyz", "username": "bob", "role": "editor"}
        )
    )
    result = await verify_api_key("kid_xyz.secret")
    assert result == ("kid_xyz", "bob", "editor")


def test_api_key_auth_provider_is_token_verifier():
    """APIKeyAuthProvider must be a TokenVerifier so MultiAuth can use it as a verifier."""
    provider = APIKeyAuthProvider()
    assert isinstance(provider, TokenVerifier)


# ---------------------------------------------------------------------------
# APIKeyAuthProvider.verify_token() — scope mapping
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_rate_limiter():
    _failed_auth.clear()
    yield
    _failed_auth.clear()


async def test_verify_token_admin_gets_admin_and_editor_scopes(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_a", "username": "alice", "role": "admin"}
        )
    )
    provider = APIKeyAuthProvider()
    token = await provider.verify_token("kid_a.secret")
    assert token is not None
    assert token.client_id == "kid_a"
    assert set(token.scopes) == {"admin", "editor"}
    assert token.claims == {"key_id": "kid_a", "username": "alice", "role": "admin"}


async def test_verify_token_editor_gets_editor_scope_only(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_e", "username": "bob", "role": "editor"}
        )
    )
    token = await APIKeyAuthProvider().verify_token("kid_e.secret")
    assert token is not None
    assert token.scopes == ["editor"]


async def test_verify_token_reader_gets_reader_scope(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_r", "username": "carol", "role": "reader"}
        )
    )
    token = await APIKeyAuthProvider().verify_token("kid_r.secret")
    assert token is not None
    assert token.scopes == ["reader"]


async def test_verify_token_invalid_key_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    token = await APIKeyAuthProvider().verify_token("bad.key")
    assert token is None


async def test_verify_token_success_clears_failure_history(mock_backend):
    record_auth_failure("unknown")
    record_auth_failure("unknown")

    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_a", "username": "alice", "role": "admin"}
        )
    )
    await APIKeyAuthProvider().verify_token("kid_a.secret")
    assert "unknown" not in _failed_auth


# ---------------------------------------------------------------------------
# Rate-limiter unit tests
# ---------------------------------------------------------------------------


def test_rate_limiter_not_triggered_below_threshold():
    for _ in range(_RATE_LIMIT - 1):
        record_auth_failure("peer-a")
    assert not is_rate_limited("peer-a")


def test_rate_limiter_triggered_at_threshold():
    for _ in range(_RATE_LIMIT):
        record_auth_failure("peer-b")
    assert is_rate_limited("peer-b")


async def test_verify_token_blocked_when_rate_limited(mock_backend):
    for _ in range(_RATE_LIMIT):
        record_auth_failure("unknown")

    token = await APIKeyAuthProvider().verify_token("kid_a.secret")
    assert token is None
    assert len(mock_backend.calls) == 0


# ---------------------------------------------------------------------------
# Verification cache (A2) — avoid a backend round-trip on every MCP call
# ---------------------------------------------------------------------------


async def test_verify_api_key_caches_success(mock_backend):
    route = mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_c", "username": "dave", "role": "editor"}
        )
    )
    first = await verify_api_key("kid_c.secret")
    second = await verify_api_key("kid_c.secret")
    assert first == second == ("kid_c", "dave", "editor")
    # Second call served from cache — backend hit only once.
    assert route.call_count == 1


async def test_verify_api_key_does_not_cache_invalid(mock_backend):
    route = mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    assert await verify_api_key("bad.key") is None
    assert await verify_api_key("bad.key") is None
    # Negative results are never cached — each attempt re-checks the backend.
    assert route.call_count == 2


# ---------------------------------------------------------------------------
# Backend-outage resilience (A1) — a blip must not poison the rate limiter
# ---------------------------------------------------------------------------


async def test_backend_outage_does_not_record_failure(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    token = await APIKeyAuthProvider().verify_token("kid_a.secret")
    assert token is None
    # Crucially: no failure recorded, so a backend outage can't lock out clients.
    assert "unknown" not in _failed_auth


async def test_backend_500_does_not_record_failure(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(503, text="Service Unavailable")
    )
    token = await APIKeyAuthProvider().verify_token("kid_a.secret")
    assert token is None
    assert "unknown" not in _failed_auth


async def test_invalid_key_does_record_failure(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    token = await APIKeyAuthProvider().verify_token("bad.key")
    assert token is None
    # A genuinely invalid key still counts toward the rate limiter.
    assert len(_failed_auth.get("unknown", [])) == 1


def test_rate_limiter_prunes_empty_buckets():
    clear_verify_cache()
    record_auth_failure("peer-c")
    assert "peer-c" in _failed_auth
    # Age the entry out of the window, then a check should drop the empty bucket.
    _failed_auth["peer-c"] = [_failed_auth["peer-c"][0] - _RATE_LIMIT - 120]
    assert not is_rate_limited("peer-c")
    assert "peer-c" not in _failed_auth


# ---------------------------------------------------------------------------
# Proxy-aware client IP (A3)
# ---------------------------------------------------------------------------


def _fake_request(peer: str, xff: str | None):
    from unittest.mock import MagicMock

    req = MagicMock()
    req.client.host = peer
    req.headers = {"x-forwarded-for": xff} if xff is not None else {}
    return req


def test_client_ip_ignores_xff_by_default(monkeypatch):
    from mcp_server import auth
    from mcp_server.config import settings

    monkeypatch.setattr(settings, "trust_proxy_headers", False)
    ip = auth.client_ip(_fake_request("10.0.0.1", "203.0.113.9"))
    assert ip == "10.0.0.1"


def test_client_ip_uses_xff_when_trusted(monkeypatch):
    from mcp_server import auth
    from mcp_server.config import settings

    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    ip = auth.client_ip(_fake_request("10.0.0.1", "203.0.113.9, 10.0.0.1"))
    assert ip == "203.0.113.9"
