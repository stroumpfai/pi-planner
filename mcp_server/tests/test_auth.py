import httpx
import pytest

from fastmcp.server.auth import TokenVerifier

from mcp_server.auth import (
    APIKeyAuthProvider,
    verify_api_key,
    is_rate_limited,
    record_auth_failure,
    _failed_auth,
    _RATE_LIMIT,
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


async def test_backend_unreachable_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    result = await verify_api_key("kid_abc.secret")
    assert result is None


async def test_backend_500_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(500, text="Server Error")
    )
    result = await verify_api_key("kid_abc.secret")
    assert result is None


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
    assert token.client_id == "alice"
    assert set(token.scopes) == {"admin", "editor"}
    assert token.claims == {"key_id": "kid_a", "role": "admin"}


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
