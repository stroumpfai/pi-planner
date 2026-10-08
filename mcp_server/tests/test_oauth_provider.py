"""Tests for oauth_provider.py: TokenStore and PiPlannerOAuthProvider."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from mcp.server.auth.provider import AuthorizationCode, AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull
from pydantic import AnyUrl

from fastmcp.server.auth import AccessToken, MultiAuth

from mcp_server.auth import APIKeyAuthProvider
from mcp_server.oauth_provider import PiPlannerOAuthProvider, TokenStore

_BASE_URL = "http://localhost:8010"
_REDIRECT_URI = "https://claude.ai/callback"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def key_still_active():
    """Every grant's API key checks out as alice's admin key unless a test says
    otherwise — load_access_token and exchange_refresh_token re-check it with the
    backend, and no test here should reach a real one. Tests re-patch to vary it."""
    with patch(
        "mcp_server.oauth_provider.check_api_key_id",
        new=AsyncMock(return_value=("kid_abc", "alice", "admin")),
    ) as check:
        yield check


def _make_client(client_id: str = "test-client") -> OAuthClientInformationFull:
    return OAuthClientInformationFull(
        client_id=client_id,
        client_name="Test Client",
        redirect_uris=[AnyUrl(_REDIRECT_URI)],
    )


def _make_params(
    state: str = "s123",
    scopes: list[str] | None = None,
    code_challenge: str = "challenge_abc",
) -> AuthorizationParams:
    return AuthorizationParams(
        state=state,
        scopes=scopes or ["admin"],
        code_challenge=code_challenge,
        redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True,
    )


def _make_provider(tmp_path: Path, ttl: int = 3600) -> PiPlannerOAuthProvider:
    return PiPlannerOAuthProvider(
        base_url=_BASE_URL,
        token_storage_path=str(tmp_path / "tokens.json"),
        token_ttl=ttl,
    )


def _make_token(value: str = "tok_abc", username: str = "alice", role: str = "admin") -> AccessToken:
    return AccessToken(
        token=value,
        client_id=username,
        scopes=[role],
        claims={"key_id": "kid_abc", "role": role},
        expires_at=int(time.time()) + 3600,
    )


# ---------------------------------------------------------------------------
# TokenStore tests
# ---------------------------------------------------------------------------


async def test_token_store_save_and_get(tmp_path):
    store = TokenStore(str(tmp_path / "tokens.json"))
    token = _make_token()
    await store.save_token(token)
    result = store.get_token(token.token)
    assert result is not None
    assert result.client_id == "alice"
    assert result.claims == {"key_id": "kid_abc", "role": "admin"}


def test_token_store_get_returns_none_for_unknown(tmp_path):
    store = TokenStore(str(tmp_path / "tokens.json"))
    assert store.get_token("nonexistent") is None


def test_token_store_expired_token_returns_none(tmp_path):
    from mcp_server.oauth_provider import _token_key

    store = TokenStore(str(tmp_path / "tokens.json"))
    # Write an already-expired entry directly to internal dict (keyed by hash)
    store._tokens[_token_key("tok_expired")] = {
        "client_id": "alice",
        "scopes": ["admin"],
        "claims": {},
        "expires_at": time.time() - 1,
    }
    assert store.get_token("tok_expired") is None


async def test_token_store_never_persists_raw_tokens(tmp_path):
    path = tmp_path / "tokens.json"
    store = TokenStore(str(path))
    token = _make_token()
    await store.save_token(token)
    on_disk = path.read_text()
    assert token.token not in on_disk
    assert store.get_token(token.token) is not None


def test_token_store_migrates_v1_plaintext_file(tmp_path):
    """A pre-hashing store file (raw-token keys) is migrated and rewritten hashed."""
    path = tmp_path / "tokens.json"
    v1_data = {
        "access_tokens": {
            "tok_raw_secret": {
                "token": "tok_raw_secret",
                "client_id": "alice",
                "scopes": ["editor"],
                "claims": {"username": "alice"},
                "expires_at": int(time.time()) + 3600,
            }
        },
        "refresh_tokens": {},
        "auth_codes": {},
        "clients": {},
    }
    path.write_text(json.dumps(v1_data))

    store = TokenStore(str(path))
    result = store.get_token("tok_raw_secret")
    assert result is not None
    assert result.client_id == "alice"
    # The rewritten file must no longer contain the raw token.
    assert "tok_raw_secret" not in path.read_text()


def test_token_store_expired_tokens_excluded_on_load(tmp_path):
    path = tmp_path / "tokens.json"
    expired_data = {
        "tok_old": {
            "token": "tok_old",
            "client_id": "alice",
            "scopes": ["admin"],
            "claims": {},
            "expires_at": time.time() - 100,
        }
    }
    path.write_text(json.dumps(expired_data))

    store = TokenStore(str(path))
    assert store.get_token("tok_old") is None


async def test_token_store_persists_across_reload(tmp_path):
    path = tmp_path / "tokens.json"
    store1 = TokenStore(str(path))
    token = _make_token()
    await store1.save_token(token)

    store2 = TokenStore(str(path))
    result = store2.get_token(token.token)
    assert result is not None
    assert result.client_id == token.client_id


async def test_token_store_delete(tmp_path):
    store = TokenStore(str(tmp_path / "tokens.json"))
    token = _make_token()
    await store.save_token(token)
    await store.delete_token(token.token)
    assert store.get_token(token.token) is None


async def test_token_store_delete_nonexistent_is_noop(tmp_path):
    store = TokenStore(str(tmp_path / "tokens.json"))
    await store.delete_token("does_not_exist")  # must not raise


def test_token_store_corrupted_file_starts_fresh(tmp_path):
    path = tmp_path / "tokens.json"
    path.write_text("not valid json {{{{")
    store = TokenStore(str(path))
    assert store.get_token("anything") is None


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — RFC 8414 metadata
# ---------------------------------------------------------------------------


async def test_metadata_advertises_refresh_token(tmp_path):
    """/.well-known/oauth-authorization-server must list refresh_token (RFC 8414 §2)."""
    import httpx
    from starlette.applications import Starlette

    provider = _make_provider(tmp_path)
    routes = provider.get_routes()
    app = Starlette(routes=routes)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/.well-known/oauth-authorization-server")

    assert r.status_code == 200
    data = r.json()
    grant_types = data.get("grant_types_supported", [])
    assert "refresh_token" in grant_types
    assert "authorization_code" in grant_types


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — client registration
# ---------------------------------------------------------------------------


async def test_register_and_get_client(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)
    result = await provider.get_client("test-client")
    assert result is not None
    assert result.client_id == "test-client"


async def test_get_unknown_client_returns_none(tmp_path):
    provider = _make_provider(tmp_path)
    assert await provider.get_client("ghost") is None


# ---------------------------------------------------------------------------
# Scope defaulting — clients that register/arrive without a scope must still
# be able to request scope=editor at /authorize, or the SDK's validate_scope()
# rejects the request with invalid_scope and the consent popup never appears.
# ---------------------------------------------------------------------------


async def test_dcr_client_without_scope_gets_default_scope(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    assert client.scope is None  # client registered without a scope

    await provider.register_client(client)
    result = await provider.get_client("test-client")

    assert result is not None
    assert result.scope == "admin editor"
    # The whole point: a scope=editor authorize request must now validate.
    assert result.validate_scope("editor") == ["editor"]
    assert result.validate_scope("admin editor") == ["admin", "editor"]


async def test_dcr_client_keeps_explicit_scope(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    client.scope = "editor"

    await provider.register_client(client)
    result = await provider.get_client("test-client")

    assert result is not None
    assert result.scope == "editor"


async def test_previously_stored_scopeless_client_normalized_on_read(tmp_path):
    """A client persisted before this fix (scope=None) must still work on reconnect."""
    provider = _make_provider(tmp_path)
    # Persist directly, bypassing register_client, to simulate an old registration.
    await provider._store.save_client(_make_client("legacy-client"))

    result = await provider.get_client("legacy-client")

    assert result is not None
    assert result.scope == "admin editor"


async def test_cimd_client_gets_default_scope(tmp_path):
    """CIMD-resolved clients (Claude.ai's URL client-ids) carry no scope of their own."""
    provider = _make_provider(tmp_path)
    client_id = "https://claude.ai/.well-known/oauth-client"

    fake_doc = type(
        "Doc",
        (),
        {
            "client_name": "Claude",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "client_uri": None,
            "logo_uri": None,
        },
    )()

    with patch.object(
        provider._cimd_fetcher, "is_cimd_client_id", return_value=True
    ), patch.object(
        provider._cimd_fetcher, "fetch", AsyncMock(return_value=fake_doc)
    ):
        result = await provider.get_client(client_id)

    assert result is not None
    assert result.scope == "admin editor"
    assert result.validate_scope("editor") == ["editor"]


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — authorize() creates pending session
# ---------------------------------------------------------------------------


async def test_authorize_returns_consent_redirect(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)
    params = _make_params(state="xyz")

    redirect_url = await provider.authorize(client, params)

    assert redirect_url.startswith(f"{_BASE_URL}/authorize/consent?nonce=")
    nonce = redirect_url.split("nonce=")[1]
    assert nonce in provider._pending


async def test_authorize_pending_stores_params_and_client(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)
    params = _make_params(state="abc")

    redirect_url = await provider.authorize(client, params)
    nonce = redirect_url.split("nonce=")[1]
    pending = provider._pending[nonce]

    assert pending.client.client_id == "test-client"
    assert pending.params.state == "abc"
    assert pending.expires_at > time.time()


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — exchange_authorization_code()
# ---------------------------------------------------------------------------


async def test_exchange_code_creates_token_with_claims(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)

    code = "test_code_abc"
    auth_code = AuthorizationCode(
        code=code,
        client_id="test-client",
        redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True,
        scopes=["admin"],
        expires_at=time.time() + 300,
        code_challenge="challenge",
    )
    await provider._store.save_auth_code(code, auth_code, ("kid_abc", "alice", "admin"))

    token_response = await provider.exchange_authorization_code(client, auth_code)

    assert token_response.access_token
    assert token_response.token_type == "Bearer"
    assert token_response.expires_in == 3600

    stored = provider._store.get_token(token_response.access_token)
    assert stored is not None
    # client_id identifies the calling OAuth client; the acting PI Planner
    # user travels as claims["username"] (read via auth.actor_username()).
    assert stored.client_id == "test-client"
    assert stored.claims["key_id"] == "kid_abc"
    assert stored.claims["username"] == "alice"
    assert stored.claims["role"] == "admin"


async def test_exchange_code_also_issues_refresh_token(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)

    code = "test_code_refresh"
    auth_code = AuthorizationCode(
        code=code,
        client_id="test-client",
        redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True,
        scopes=["admin"],
        expires_at=time.time() + 300,
        code_challenge="challenge",
    )
    await provider._store.save_auth_code(code, auth_code, ("kid_abc", "alice", "admin"))

    token_response = await provider.exchange_authorization_code(client, auth_code)

    assert token_response.refresh_token

    # Refresh and access tokens both carry the OAuth client's client_id — the
    # SDK matches refresh_token.client_id against the authenticated client_id
    # on every refresh exchange. The acting PI Planner user travels as claims.
    stored_refresh = provider._store.get_refresh_token(token_response.refresh_token)
    assert stored_refresh is not None
    assert stored_refresh.client_id == "test-client"
    assert stored_refresh.scopes == ["admin", "editor"]

    claims = provider._store.get_refresh_token_claims(token_response.refresh_token)
    granted_at = claims.pop("granted_at")
    assert claims == {"key_id": "kid_abc", "username": "alice", "role": "admin"}
    assert abs(granted_at - time.time()) < 5


async def test_exchange_code_token_persisted_to_store(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)

    code = "test_code_persist"
    auth_code = AuthorizationCode(
        code=code,
        client_id="test-client",
        redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True,
        scopes=["editor"],
        expires_at=time.time() + 300,
        code_challenge="challenge",
    )
    await provider._store.save_auth_code(code, auth_code, ("kid_xyz", "bob", "editor"))

    token_response = await provider.exchange_authorization_code(client, auth_code)

    # Reload store from disk — token should survive
    store2 = TokenStore(str(tmp_path / "tokens.json"))
    assert store2.get_token(token_response.access_token) is not None


async def test_exchange_code_refresh_token_persisted_to_store(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)

    code = "test_code_refresh_persist"
    auth_code = AuthorizationCode(
        code=code,
        client_id="test-client",
        redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True,
        scopes=["editor"],
        expires_at=time.time() + 300,
        code_challenge="challenge",
    )
    await provider._store.save_auth_code(code, auth_code, ("kid_xyz", "bob", "editor"))

    token_response = await provider.exchange_authorization_code(client, auth_code)

    # Reload store from disk — refresh token and its claims should survive
    store2 = TokenStore(str(tmp_path / "tokens.json"))
    assert store2.get_refresh_token(token_response.refresh_token) is not None
    claims = store2.get_refresh_token_claims(token_response.refresh_token)
    assert "granted_at" in claims
    assert {k: v for k, v in claims.items() if k != "granted_at"} == {
        "key_id": "kid_xyz", "username": "bob", "role": "editor"
    }


async def test_exchange_code_twice_raises_invalid_grant(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)

    code = "one_time_code"
    auth_code = AuthorizationCode(
        code=code,
        client_id="test-client",
        redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True,
        scopes=["admin"],
        expires_at=time.time() + 300,
        code_challenge="challenge",
    )
    await provider._store.save_auth_code(code, auth_code, ("kid_abc", "alice", "admin"))

    await provider.exchange_authorization_code(client, auth_code)

    from mcp.server.auth.provider import TokenError

    with pytest.raises(TokenError) as exc_info:
        await provider.exchange_authorization_code(client, auth_code)
    assert exc_info.value.error == "invalid_grant"


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — load_access_token
# ---------------------------------------------------------------------------


async def test_load_access_token_found(tmp_path):
    provider = _make_provider(tmp_path)
    token = _make_token("tok_found", "alice")
    await provider._store.save_token(token)

    result = await provider.load_access_token("tok_found")
    assert result is not None
    assert result.client_id == "alice"


async def test_load_access_token_not_found(tmp_path):
    provider = _make_provider(tmp_path)
    assert await provider.load_access_token("tok_ghost") is None


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — revoke_token
# ---------------------------------------------------------------------------


async def test_revoke_token_removes_from_store(tmp_path):
    provider = _make_provider(tmp_path)
    token = _make_token()
    await provider._store.save_token(token)

    await provider.revoke_token(token)
    assert provider._store.get_token(token.token) is None


async def test_revoke_refresh_token_removes_from_store(tmp_path):
    from mcp.server.auth.provider import RefreshToken

    provider = _make_provider(tmp_path)
    token = RefreshToken(token="rt_revoke", client_id="test-client", scopes=["editor"])
    await provider._store.save_refresh_token(token, claims={"key_id": "k", "username": "alice", "role": "editor"})

    await provider.revoke_token(token)
    assert provider._store.get_refresh_token(token.token) is None


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — load_refresh_token
# ---------------------------------------------------------------------------


async def test_load_refresh_token_returns_stored_token(tmp_path):
    from mcp.server.auth.provider import RefreshToken

    provider = _make_provider(tmp_path)
    client = _make_client()
    stored = RefreshToken(token="rt_stored", client_id="test-client", scopes=["editor"])
    await provider._store.save_refresh_token(
        stored, claims={"key_id": "kid_abc", "username": "alice", "role": "editor"}
    )

    result = await provider.load_refresh_token(client, "rt_stored")
    assert result is not None
    assert result.client_id == "test-client"
    assert result.scopes == ["editor"]


async def test_load_refresh_token_returns_none_for_unknown(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    result = await provider.load_refresh_token(client, "any_rt")
    assert result is None


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — exchange_refresh_token() rotation
# ---------------------------------------------------------------------------


async def _seed_refresh_token(
    provider: PiPlannerOAuthProvider,
    token_value: str = "rt_seed",
    client_id: str = "test-client",
    scopes: list[str] | None = None,
    claims: dict | None = None,
):
    from mcp.server.auth.provider import RefreshToken

    scopes = scopes if scopes is not None else ["admin", "editor"]
    claims = claims if claims is not None else {"key_id": "kid_abc", "username": "alice", "role": "admin"}
    refresh_token = RefreshToken(token=token_value, client_id=client_id, scopes=scopes)
    await provider._store.save_refresh_token(refresh_token, claims=claims)
    return refresh_token


async def test_exchange_refresh_token_rotates_tokens(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    refresh_token = await _seed_refresh_token(provider)

    token_response = await provider.exchange_refresh_token(client, refresh_token, ["admin", "editor"])

    assert token_response.access_token
    assert token_response.refresh_token
    assert token_response.refresh_token != refresh_token.token

    # Old refresh token is single-use — gone after rotation.
    assert provider._store.get_refresh_token(refresh_token.token) is None

    # New refresh token persisted with the same claims and OAuth client_id.
    new_refresh = provider._store.get_refresh_token(token_response.refresh_token)
    assert new_refresh is not None
    assert new_refresh.client_id == "test-client"
    # The seeded grant predates granted_at, so its clock starts at this refresh.
    new_claims = provider._store.get_refresh_token_claims(token_response.refresh_token)
    assert abs(new_claims.pop("granted_at") - time.time()) < 5
    assert new_claims == {"key_id": "kid_abc", "username": "alice", "role": "admin"}

    # New access token follows the same client_id=OAuth-client convention as
    # exchange_authorization_code; the acting user travels as claims["username"]
    # (downstream code reads it via auth.actor_username() for activity logging).
    new_access = provider._store.get_token(token_response.access_token)
    assert new_access is not None
    assert new_access.client_id == "test-client"
    assert new_access.claims == {"key_id": "kid_abc", "username": "alice", "role": "admin"}


async def test_exchange_refresh_token_narrows_scope(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    refresh_token = await _seed_refresh_token(provider, scopes=["admin", "editor"])

    token_response = await provider.exchange_refresh_token(client, refresh_token, ["editor"])

    assert token_response.scope == "editor"
    new_access = provider._store.get_token(token_response.access_token)
    assert new_access.scopes == ["editor"]

    # The rotated refresh token keeps the original (broader) scope ceiling.
    new_refresh = provider._store.get_refresh_token(token_response.refresh_token)
    assert new_refresh.scopes == ["admin", "editor"]


async def test_exchange_refresh_token_missing_claims_raises_invalid_grant(tmp_path):
    from mcp.server.auth.provider import TokenError

    provider = _make_provider(tmp_path)
    client = _make_client()
    refresh_token = await _seed_refresh_token(provider, token_value="rt_corrupt", claims={})

    with pytest.raises(TokenError) as exc_info:
        await provider.exchange_refresh_token(client, refresh_token, ["admin", "editor"])
    assert exc_info.value.error == "invalid_grant"


# ---------------------------------------------------------------------------
# Revoked API keys end the grants issued from them (audit finding #2)
# ---------------------------------------------------------------------------


async def _seed_grant(provider: PiPlannerOAuthProvider, key_id: str, suffix: str) -> tuple[str, str]:
    """An access token and a refresh token from one consent with *key_id*."""
    claims = {"key_id": key_id, "username": "alice", "role": "admin"}
    access = AccessToken(
        token=f"at_{suffix}", client_id="test-client", scopes=["admin", "editor"],
        claims=claims, expires_at=int(time.time()) + 3600,
    )
    await provider._store.save_token(access)
    await _seed_refresh_token(provider, token_value=f"rt_{suffix}", claims={**claims, "granted_at": int(time.time())})
    return access.token, f"rt_{suffix}"


async def test_load_access_token_rejects_and_drops_grants_once_key_revoked(tmp_path, key_still_active):
    provider = _make_provider(tmp_path)
    access, refresh = await _seed_grant(provider, "kid_revoked", "a")
    other_access, other_refresh = await _seed_grant(provider, "kid_other", "b")
    key_still_active.return_value = None  # the backend no longer knows kid_revoked

    assert await provider.load_access_token(access) is None

    key_still_active.assert_awaited_with("kid_revoked")
    # The whole grant goes, not just the token presented.
    assert provider._store.get_token(access) is None
    assert provider._store.get_refresh_token(refresh) is None
    # Other keys' grants are untouched.
    assert provider._store.get_token(other_access) is not None
    assert provider._store.get_refresh_token(other_refresh) is not None


async def test_load_access_token_rejects_key_now_owned_by_reader(tmp_path, key_still_active):
    provider = _make_provider(tmp_path)
    access, _ = await _seed_grant(provider, "kid_abc", "a")
    key_still_active.return_value = ("kid_abc", "alice", "reader")

    assert await provider.load_access_token(access) is None


async def test_load_access_token_fails_open_when_backend_down(tmp_path, key_still_active):
    """Every tool call goes through the same backend, so a token accepted during an
    outage can do nothing — and logging users out on each blip would be worse."""
    from mcp_server.auth import BackendAuthUnavailable

    provider = _make_provider(tmp_path)
    access, refresh = await _seed_grant(provider, "kid_abc", "a")
    key_still_active.side_effect = BackendAuthUnavailable("down")

    assert await provider.load_access_token(access) is not None
    assert provider._store.get_refresh_token(refresh) is not None


async def test_grants_survive_an_app_older_than_the_mcp_server(tmp_path, key_still_active, mock_backend):
    """Deploying the MCP server before the app: /admin/check doesn't exist yet and
    answers 404. Every grant must survive that, not be dropped as revoked."""
    from mcp_server.auth import check_api_key_id

    key_still_active.side_effect = check_api_key_id  # the real one, against the mocked backend
    mock_backend.post("/api/v1/api-keys/admin/check").mock(return_value=httpx.Response(404))
    provider = _make_provider(tmp_path)
    access, refresh_value = await _seed_grant(provider, "kid_abc", "a")

    assert await provider.load_access_token(access) is not None
    response = await provider.exchange_refresh_token(
        _make_client(), provider._store.get_refresh_token(refresh_value), ["admin", "editor"]
    )
    assert response.access_token


async def test_exchange_refresh_token_rejects_revoked_key(tmp_path, key_still_active):
    from mcp.server.auth.provider import TokenError

    provider = _make_provider(tmp_path)
    access, refresh_value = await _seed_grant(provider, "kid_revoked", "a")
    refresh_token = provider._store.get_refresh_token(refresh_value)
    key_still_active.return_value = None

    with pytest.raises(TokenError) as exc_info:
        await provider.exchange_refresh_token(_make_client(), refresh_token, ["admin", "editor"])
    assert exc_info.value.error == "invalid_grant"
    assert provider._store.get_token(access) is None
    assert provider._store.get_refresh_token(refresh_value) is None


async def test_exchange_refresh_token_follows_role_change(tmp_path, key_still_active):
    provider = _make_provider(tmp_path)
    refresh_token = await _seed_refresh_token(provider)  # alice, admin
    key_still_active.return_value = ("kid_abc", "alice", "editor")

    response = await provider.exchange_refresh_token(_make_client(), refresh_token, ["admin", "editor"])

    assert response.scope == "editor"
    access = provider._store.get_token(response.access_token)
    assert access.claims["role"] == "editor"
    assert provider._store.get_refresh_token_claims(response.refresh_token)["role"] == "editor"


async def test_exchange_refresh_token_keeps_grant_age_across_rotation(tmp_path):
    provider = _make_provider(tmp_path)
    granted_at = int(time.time()) - 86400
    refresh_token = await _seed_refresh_token(
        provider, claims={"key_id": "kid_abc", "username": "alice", "role": "admin", "granted_at": granted_at}
    )

    response = await provider.exchange_refresh_token(_make_client(), refresh_token, ["admin", "editor"])

    assert provider._store.get_refresh_token_claims(response.refresh_token)["granted_at"] == granted_at


async def test_exchange_refresh_token_rejects_grant_past_max_age(tmp_path, key_still_active):
    from mcp.server.auth.provider import TokenError

    provider = PiPlannerOAuthProvider(
        base_url=_BASE_URL, token_storage_path=str(tmp_path / "tokens.json"), grant_max_age=3600,
    )
    refresh_token = await _seed_refresh_token(
        provider,
        claims={"key_id": "kid_abc", "username": "alice", "role": "admin", "granted_at": int(time.time()) - 7200},
    )

    with pytest.raises(TokenError) as exc_info:
        await provider.exchange_refresh_token(_make_client(), refresh_token, ["admin", "editor"])
    assert exc_info.value.error == "invalid_grant"
    assert provider._store.get_refresh_token(refresh_token.token) is None
    # Too old is decided locally — no need to ask the backend.
    key_still_active.assert_not_awaited()


async def test_delete_grants_for_key_also_drops_unused_auth_codes(tmp_path):
    provider = _make_provider(tmp_path)
    auth_code = AuthorizationCode(
        code="code_x", client_id="test-client", redirect_uri=AnyUrl(_REDIRECT_URI),
        redirect_uri_provided_explicitly=True, scopes=["editor"],
        expires_at=time.time() + 300, code_challenge="c",
    )
    await provider._store.save_auth_code("code_x", auth_code, ("kid_revoked", "alice", "editor"))

    assert await provider._store.delete_grants_for_key("kid_revoked") == 1
    assert provider._store.get_auth_code("code_x") is None


# ---------------------------------------------------------------------------
# Consent handler HTTP tests
# ---------------------------------------------------------------------------


@pytest.fixture
def provider_with_pending(tmp_path):
    """Provider with one pre-populated pending auth session."""
    from starlette.routing import Route

    provider = _make_provider(tmp_path)
    client = _make_client(client_id="claude-app")
    params = _make_params(state="state_abc")

    import secrets

    nonce = secrets.token_urlsafe(20)
    from mcp_server.oauth_provider import _PendingAuth

    provider._pending[nonce] = _PendingAuth(
        client=client, params=params, expires_at=time.time() + 300
    )
    return provider, nonce


async def test_consent_get_renders_form(provider_with_pending):
    import httpx
    from starlette.applications import Starlette

    provider, nonce = provider_with_pending
    app = Starlette(routes=[__import__("starlette.routing", fromlist=["Route"]).Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/authorize/consent?nonce={nonce}")

    assert r.status_code == 200
    assert "PI Planner" in r.text
    assert "Test Client" in r.text  # client_name from _make_client()
    assert 'id="api_key"' in r.text


async def test_consent_get_expired_nonce_returns_400(tmp_path):
    import httpx
    from starlette.applications import Starlette
    from starlette.routing import Route

    provider = _make_provider(tmp_path)
    app = Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/authorize/consent?nonce=does_not_exist")

    assert r.status_code == 400


async def test_consent_post_valid_key_redirects_with_code(provider_with_pending, mock_backend):
    import httpx
    from starlette.applications import Starlette
    from starlette.routing import Route

    provider, nonce = provider_with_pending
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(200, json={"key_id": "kid_abc", "username": "alice", "role": "admin"})
    )

    app = Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=False,
    ) as client:
        r = await client.post(
            "/authorize/consent",
            data={"nonce": nonce, "api_key": "kid_abc.mysecret"},  # noqa: S6418
        )

    assert r.status_code == 302
    location = r.headers["location"]
    assert "code=" in location
    assert "state=state_abc" in location
    assert nonce not in provider._pending  # consumed


async def test_consent_post_invalid_key_redirects_to_form_with_error(provider_with_pending, mock_backend):
    import httpx
    from starlette.applications import Starlette
    from starlette.routing import Route

    provider, nonce = provider_with_pending
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )

    app = Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=False,
    ) as client:
        r = await client.post(
            "/authorize/consent",
            data={"nonce": nonce, "api_key": "kid_bad.wrong"},
        )

    assert r.status_code == 303
    assert "error=invalid_key" in r.headers["location"]
    assert nonce in provider._pending  # NOT consumed on failure


async def test_consent_post_reader_key_redirects_with_reader_error(provider_with_pending, mock_backend):
    import httpx
    from starlette.applications import Starlette
    from starlette.routing import Route

    provider, nonce = provider_with_pending
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(200, json={"key_id": "kid_r", "username": "carol", "role": "reader"})
    )

    app = Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=False,
    ) as client:
        r = await client.post(
            "/authorize/consent",
            data={"nonce": nonce, "api_key": "kid_r.secret"},
        )

    # Finding 12: reader rejection must redirect to client's redirect_uri with error=access_denied,
    # not back to the consent form, so the OAuth client receives a machine-readable response.
    assert r.status_code == 302
    location = r.headers["location"]
    assert location.startswith(_REDIRECT_URI)
    assert "error=access_denied" in location


# ---------------------------------------------------------------------------
# Full OAuth flow — authorize → consent → code exchange → refresh rotation
# ---------------------------------------------------------------------------


async def test_full_oauth_flow_with_refresh(tmp_path, mock_backend):
    """Drive authorize → consent → code exchange → refresh exchange end to end.

    This is the regression test for the AccessToken vs. RefreshToken client_id
    semantics mismatch: a registered OAuth client_id ("claude-app") that
    differs from the PI Planner username ("alice") would surface as
    invalid_grant on refresh if RefreshToken.client_id were set incorrectly.
    """
    provider = _make_provider(tmp_path)
    client = _make_client(client_id="claude-app")
    await provider.register_client(client)

    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(200, json={"key_id": "kid_abc", "username": "alice", "role": "admin"})
    )

    # 1. authorize() stashes a pending session and redirects to consent.
    params = _make_params(state="full_flow")
    redirect_url = await provider.authorize(client, params)
    nonce = redirect_url.split("nonce=")[1]

    # 2. Submit the consent form — issues an auth code, redirected with ?code=.
    from starlette.applications import Starlette
    from starlette.routing import Route

    app = Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", follow_redirects=False
    ) as http_client:
        r = await http_client.post("/authorize/consent", data={"nonce": nonce, "api_key": "kid_abc.secret"})
    assert r.status_code == 302
    code = r.headers["location"].split("code=")[1].split("&")[0]

    auth_code = await provider.load_authorization_code(client, code)
    assert auth_code is not None

    # 3. Exchange the code — first access + refresh token pair.
    first = await provider.exchange_authorization_code(client, auth_code)
    assert first.access_token and first.refresh_token

    refresh_token = await provider.load_refresh_token(client, first.refresh_token)
    assert refresh_token is not None
    assert refresh_token.client_id == "claude-app"

    # 4. Exchange the refresh token — rotation issues a new pair and the old
    #    refresh token is invalidated, but the still-valid access token lives on.
    second = await provider.exchange_refresh_token(client, refresh_token, refresh_token.scopes)
    assert second.access_token != first.access_token
    assert second.refresh_token != first.refresh_token

    assert await provider.load_access_token(first.access_token) is not None
    assert await provider.load_access_token(second.access_token) is not None
    assert await provider.load_refresh_token(client, first.refresh_token) is None
    assert await provider.load_refresh_token(client, second.refresh_token) is not None


# ---------------------------------------------------------------------------
# MultiAuth integration
# ---------------------------------------------------------------------------


async def test_multi_auth_oauth_token_resolves_first(tmp_path):
    """OAuth-issued token is resolved by PiPlannerOAuthProvider (first verifier tried)."""
    provider = _make_provider(tmp_path)
    api_key_auth = APIKeyAuthProvider()
    multi = MultiAuth(server=provider, verifiers=[api_key_auth])

    token = _make_token("oauth_tok_xyz", "alice", "editor")
    await provider._store.save_token(token)

    result = await multi.verify_token("oauth_tok_xyz")
    assert result is not None
    assert result.client_id == "alice"
    assert result.claims["role"] == "editor"


async def test_multi_auth_direct_api_key_resolves_via_verifier(tmp_path, mock_backend):
    """Raw API key is resolved by APIKeyAuthProvider when not in OAuth store."""
    provider = _make_provider(tmp_path)
    api_key_auth = APIKeyAuthProvider()
    multi = MultiAuth(server=provider, verifiers=[api_key_auth])

    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_direct", "username": "bob", "role": "editor"}
        )
    )

    result = await multi.verify_token("kid_direct.secret")
    assert result is not None
    assert result.client_id == "kid_direct"
    assert result.claims["username"] == "bob"


async def test_multi_auth_invalid_token_rejected_by_both(tmp_path, mock_backend):
    """Token unknown to both providers → None."""
    provider = _make_provider(tmp_path)
    api_key_auth = APIKeyAuthProvider()
    multi = MultiAuth(server=provider, verifiers=[api_key_auth])

    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )

    result = await multi.verify_token("totally_bogus_token")
    assert result is None


# ---------------------------------------------------------------------------
# Open registration: redirect allowlist, client cap, rate limit, consent framing
# (audit finding #5)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "uri, allowed",
    [
        ("https://claude.ai/api/mcp/auth_callback", True),
        ("https://www.claude.com/callback", True),  # subdomain of an allowed host
        ("https://chatgpt.com/connector_platform_oauth_redirect", True),
        ("http://localhost:33418/callback", True),  # loopback: a local client
        ("http://127.0.0.1:6274/oauth/callback", True),
        ("cursor://anysphere.cursor-retrieval/oauth/callback", True),  # app on the user's machine
        ("https://evil.example/callback", False),
        ("https://claude.ai.evil.example/callback", False),  # suffix trick
        ("https://notclaude.ai/callback", False),
        ("http://claude.ai/callback", False),  # remote must be https
    ],
)
def test_redirect_uri_allowlist(uri, allowed):
    from mcp_server.oauth_provider import _redirect_uri_allowed

    assert _redirect_uri_allowed(uri) is allowed


def test_redirect_uri_allowlist_can_be_turned_off(monkeypatch):
    from mcp_server.config import settings
    from mcp_server.oauth_provider import _redirect_uri_allowed

    monkeypatch.setattr(settings, "oauth_allowed_redirect_hosts", "*")
    assert _redirect_uri_allowed("https://evil.example/callback")


async def test_register_rejects_redirect_to_unlisted_host(tmp_path):
    from mcp.server.auth.provider import RegistrationError

    provider = _make_provider(tmp_path)
    client = OAuthClientInformationFull(
        client_id="phish", client_name="Claude", redirect_uris=[AnyUrl("https://evil.example/cb")]
    )

    with pytest.raises(RegistrationError) as exc_info:
        await provider.register_client(client)
    assert exc_info.value.error == "invalid_redirect_uri"
    assert await provider.get_client("phish") is None


async def test_authorize_rejects_unlisted_redirect_of_a_client_stored_before_the_allowlist(tmp_path):
    provider = _make_provider(tmp_path)
    legacy = OAuthClientInformationFull(
        client_id="legacy", client_name="Old", redirect_uris=[AnyUrl("https://evil.example/cb")]
    )
    await provider._store.save_client(legacy)  # bypasses register_client, like an old store file
    params = AuthorizationParams(
        state="s", scopes=["editor"], code_challenge="c",
        redirect_uri=AnyUrl("https://evil.example/cb"), redirect_uri_provided_explicitly=True,
    )

    from mcp.server.auth.provider import AuthorizeError

    with pytest.raises(AuthorizeError) as exc_info:
        await provider.authorize(legacy, params)
    assert exc_info.value.error == "unauthorized_client"
    assert "OAUTH_ALLOWED_REDIRECT_HOSTS" in exc_info.value.error_description
    assert provider._pending == {}


async def test_authorize_endpoint_answers_unlisted_redirect_without_a_code(tmp_path):
    """End to end through the SDK handler: the browser is sent back with the
    reason and no code, and nothing is left pending."""
    from starlette.applications import Starlette

    provider = _make_provider(tmp_path)
    legacy = OAuthClientInformationFull(
        client_id="legacy", client_name="Old", redirect_uris=[AnyUrl("https://evil.example/cb")],
        token_endpoint_auth_method="none",
    )
    await provider._store.save_client(legacy)
    app = Starlette(routes=provider.get_routes())

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=_BASE_URL) as http:
        r = await http.get("/authorize", params={
            "response_type": "code", "client_id": "legacy", "redirect_uri": "https://evil.example/cb",
            "code_challenge": "c" * 43, "code_challenge_method": "S256", "state": "st",
        })

    assert r.status_code == 302
    location = r.headers["location"]
    assert "error=unauthorized_client" in location
    assert "code=" not in location
    assert provider._pending == {}


async def test_register_at_cap_drops_old_unused_registrations(tmp_path, monkeypatch):
    from mcp_server.config import settings

    monkeypatch.setattr(settings, "oauth_max_clients", 2)
    provider = _make_provider(tmp_path)
    long_ago = int(time.time()) - 2 * 86400
    for client_id in ("abandoned", "in-use"):
        c = _make_client(client_id)
        c.client_id_issued_at = long_ago
        await provider._store.save_client(c)
    await provider._store.save_token(
        AccessToken(token="at_in_use", client_id="in-use", scopes=["editor"],
                    claims={"key_id": "kid_abc"}, expires_at=int(time.time()) + 3600)
    )

    await provider.register_client(_make_client("newcomer"))

    assert await provider.get_client("abandoned") is None
    assert await provider.get_client("in-use") is not None
    assert await provider.get_client("newcomer") is not None


async def test_register_at_cap_keeps_recent_registrations_and_refuses(tmp_path, monkeypatch):
    """A registration minutes old may be a user mid-consent; it isn't pruned."""
    from mcp.server.auth.provider import RegistrationError
    from mcp_server.config import settings

    monkeypatch.setattr(settings, "oauth_max_clients", 1)
    provider = _make_provider(tmp_path)
    fresh = _make_client("fresh")
    fresh.client_id_issued_at = int(time.time())
    await provider._store.save_client(fresh)

    with pytest.raises(RegistrationError) as exc_info:
        await provider.register_client(_make_client("one-too-many"))
    assert exc_info.value.error == "invalid_client_metadata"
    assert await provider.get_client("fresh") is not None


async def test_register_endpoint_rate_limited_per_ip(tmp_path):
    from starlette.applications import Starlette
    from mcp_server.oauth_provider import _REGISTRATION_LIMIT

    provider = _make_provider(tmp_path)
    app = Starlette(routes=provider.get_routes())
    body = {"redirect_uris": [_REDIRECT_URI], "client_name": "Claude", "token_endpoint_auth_method": "none"}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=_BASE_URL) as http:
        statuses = [(await http.post("/register", json=body)).status_code for _ in range(_REGISTRATION_LIMIT + 1)]

    assert statuses[:_REGISTRATION_LIMIT] == [201] * _REGISTRATION_LIMIT
    assert statuses[-1] == 429
    assert provider._store.client_count() == _REGISTRATION_LIMIT


async def test_consent_page_cannot_be_framed_or_cached(provider_with_pending):
    from starlette.applications import Starlette
    from starlette.routing import Route

    provider, nonce = provider_with_pending
    app = Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        r = await http.get(f"/authorize/consent?nonce={nonce}")

    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["referrer-policy"] == "no-referrer"


# ---------------------------------------------------------------------------
# Rejection paths: redirect_uri validation, CIMD failures, consent refusals
# ---------------------------------------------------------------------------

_CIMD_CLIENT_ID = "https://claude.ai/.well-known/oauth-client"


def _consent_app(provider: PiPlannerOAuthProvider):
    from starlette.applications import Starlette
    from starlette.routing import Route

    return Starlette(routes=[Route("/authorize/consent", provider._consent_handler, methods=["GET", "POST"])])


async def _post_consent(provider: PiPlannerOAuthProvider, data: dict) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_consent_app(provider)), base_url="http://test", follow_redirects=False
    ) as http:
        return await http.post("/authorize/consent", data=data)


def _cimd(provider: PiPlannerOAuthProvider, *, fetch: AsyncMock, redirect_ok: bool = True):
    """Make *provider* treat its client id as a CIMD URL, fetched by *fetch*."""
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch.object(provider._cimd_fetcher, "is_cimd_client_id", return_value=True))
    stack.enter_context(patch.object(provider._cimd_fetcher, "fetch", fetch))
    stack.enter_context(patch.object(provider._cimd_fetcher, "validate_redirect_uri", return_value=redirect_ok))
    return stack


async def test_authorize_rejects_allowed_host_redirect_the_client_never_registered(tmp_path):
    """An allowlisted host is not enough: the URI must be one this client registered."""
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)
    params = _make_params()
    params.redirect_uri = AnyUrl("https://claude.ai/somewhere-else")

    with pytest.raises(ValueError, match="not registered for this client"):
        await provider.authorize(client, params)
    assert provider._pending == {}


async def test_authorize_accepts_registered_redirect_with_trailing_slash(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)
    params = _make_params()
    params.redirect_uri = AnyUrl(_REDIRECT_URI + "/")

    assert "nonce=" in await provider.authorize(client, params)


async def test_authorize_drops_expired_pending_sessions(tmp_path):
    from mcp_server.oauth_provider import _PendingAuth

    provider = _make_provider(tmp_path)
    client = _make_client()
    await provider.register_client(client)
    provider._pending["stale"] = _PendingAuth(client=client, params=_make_params(), expires_at=time.time() - 1)

    await provider.authorize(client, _make_params())

    assert "stale" not in provider._pending
    assert len(provider._pending) == 1


async def test_authorize_rejects_cimd_client_whose_document_cannot_be_fetched(tmp_path):
    from fastmcp.server.auth.cimd import CIMDFetchError

    provider = _make_provider(tmp_path)
    client = _make_client(_CIMD_CLIENT_ID)

    with _cimd(provider, fetch=AsyncMock(side_effect=CIMDFetchError("timeout"))):
        with pytest.raises(ValueError, match="CIMD validation failed"):
            await provider.authorize(client, _make_params())
    assert provider._pending == {}


async def test_authorize_rejects_redirect_the_cimd_document_does_not_list(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client(_CIMD_CLIENT_ID)

    with _cimd(provider, fetch=AsyncMock(return_value=object()), redirect_ok=False):
        with pytest.raises(ValueError, match="not permitted by CIMD document"):
            await provider.authorize(client, _make_params())
    assert provider._pending == {}


async def test_register_rejects_cimd_client_whose_document_fails_validation(tmp_path):
    from fastmcp.server.auth.cimd import CIMDValidationError
    from mcp.server.auth.provider import RegistrationError

    provider = _make_provider(tmp_path)

    with _cimd(provider, fetch=AsyncMock(side_effect=CIMDValidationError("bad doc"))):
        with pytest.raises(RegistrationError) as exc_info:
            await provider.register_client(_make_client(_CIMD_CLIENT_ID))
    assert exc_info.value.error == "invalid_client_metadata"
    assert provider._store.client_count() == 0


async def test_register_rejects_redirect_the_cimd_document_does_not_list(tmp_path):
    from mcp.server.auth.provider import RegistrationError

    provider = _make_provider(tmp_path)

    with _cimd(provider, fetch=AsyncMock(return_value=object()), redirect_ok=False):
        with pytest.raises(RegistrationError) as exc_info:
            await provider.register_client(_make_client(_CIMD_CLIENT_ID))
    assert exc_info.value.error == "invalid_redirect_uri"
    assert provider._store.client_count() == 0


async def test_register_requires_a_client_id(tmp_path):
    from mcp.server.auth.provider import RegistrationError

    provider = _make_provider(tmp_path)
    client = _make_client()
    client.client_id = None

    with pytest.raises(RegistrationError):
        await provider.register_client(client)


async def test_get_client_returns_none_when_cimd_fetch_fails(tmp_path):
    from fastmcp.server.auth.cimd import CIMDFetchError

    provider = _make_provider(tmp_path)

    with _cimd(provider, fetch=AsyncMock(side_effect=CIMDFetchError("404"))):
        assert await provider.get_client(_CIMD_CLIENT_ID) is None


async def test_load_authorization_code_refuses_another_clients_code(tmp_path):
    provider = _make_provider(tmp_path)
    code = AuthorizationCode(
        code="code_x", scopes=["editor"], expires_at=time.time() + 60, client_id="claude-app",
        code_challenge="c", redirect_uri=AnyUrl(_REDIRECT_URI), redirect_uri_provided_explicitly=True,
    )
    await provider._store.save_auth_code("code_x", code, ("kid_abc", "alice", "admin"))

    assert await provider.load_authorization_code(_make_client("intruder"), "code_x") is None
    assert await provider.load_authorization_code(_make_client("claude-app"), "code_unknown") is None
    assert await provider.load_authorization_code(_make_client("claude-app"), "code_x") is not None


async def test_token_store_drops_expired_and_unreadable_auth_codes(tmp_path):
    store = TokenStore(str(tmp_path / "tokens.json"))
    code = AuthorizationCode(
        code="c1", scopes=["editor"], expires_at=time.time() - 1, client_id="x",
        code_challenge="c", redirect_uri=AnyUrl(_REDIRECT_URI), redirect_uri_provided_explicitly=True,
    )
    await store.save_auth_code("expired", code, ("k", "u", "admin"))
    await store.save_auth_code("broken", code.model_copy(update={"expires_at": time.time() + 60}), ("k", "u", "admin"))
    from mcp_server.oauth_provider import _token_key

    store._auth_codes[_token_key("broken")]["scopes"] = "not-a-list"

    assert store.get_auth_code("expired") is None
    assert store.get_auth_code("broken") is None
    assert store._auth_codes == {}


async def test_token_store_ignores_an_unreadable_client_entry(tmp_path):
    store = TokenStore(str(tmp_path / "tokens.json"))
    store._clients["junk"] = {"redirect_uris": "not-a-list"}

    assert store.get_client("junk") is None


async def test_consent_post_expired_nonce_returns_400(tmp_path):
    provider = _make_provider(tmp_path)

    r = await _post_consent(provider, {"nonce": "gone", "api_key": "kid.secret"})

    assert r.status_code == 400
    assert r.headers["cache-control"] == "no-store"


async def test_consent_post_without_key_asks_again(provider_with_pending):
    provider, nonce = provider_with_pending

    r = await _post_consent(provider, {"nonce": nonce, "api_key": "   "})

    assert r.status_code == 303
    assert "error=missing_key" in r.headers["location"]
    assert nonce in provider._pending


async def test_consent_post_rate_limited_never_checks_the_key(provider_with_pending):
    provider, nonce = provider_with_pending
    verify = AsyncMock()

    with patch("mcp_server.oauth_provider.is_rate_limited", return_value=True), patch(
        "mcp_server.oauth_provider.verify_api_key", verify
    ):
        r = await _post_consent(provider, {"nonce": nonce, "api_key": "kid.guess"})

    assert r.status_code == 303
    assert "error=rate_limited" in r.headers["location"]
    verify.assert_not_called()
    assert nonce in provider._pending


async def test_consent_post_backend_down_does_not_count_as_a_failure(provider_with_pending):
    from mcp_server.auth import BackendAuthUnavailable

    provider, nonce = provider_with_pending
    with patch(
        "mcp_server.oauth_provider.verify_api_key", AsyncMock(side_effect=BackendAuthUnavailable())
    ), patch("mcp_server.oauth_provider.record_auth_failure") as record:
        r = await _post_consent(provider, {"nonce": nonce, "api_key": "kid.secret"})

    assert r.status_code == 303
    assert "error=backend_unavailable" in r.headers["location"]
    record.assert_not_called()
    assert nonce in provider._pending


async def test_consent_post_reader_without_redirect_uri_gets_403_page(tmp_path):
    from mcp_server.oauth_provider import _PendingAuth

    provider = _make_provider(tmp_path)
    params = _make_params()
    params.redirect_uri = None
    provider._pending["n"] = _PendingAuth(client=_make_client(), params=params, expires_at=time.time() + 300)

    with patch(
        "mcp_server.oauth_provider.verify_api_key", AsyncMock(return_value=("kid_r", "rita", "reader"))
    ):
        r = await _post_consent(provider, {"nonce": "n", "api_key": "kid_r.secret"})

    assert r.status_code == 403
    assert "Reader accounts" in r.text
    assert "n" not in provider._pending


@pytest.mark.parametrize(
    "error, shown",
    [("rate_limited", "Too many failed attempts"), ("<script>", "An error occurred")],
)
async def test_consent_get_shows_known_errors_and_escapes_unknown_ones(provider_with_pending, error, shown):
    provider, nonce = provider_with_pending

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_consent_app(provider)), base_url="http://test"
    ) as http:
        r = await http.get("/authorize/consent", params={"nonce": nonce, "error": error})

    assert shown in r.text
    assert "<script>" not in r.text


async def test_root_protected_resource_metadata_alias_names_the_mcp_endpoint(tmp_path):
    from starlette.applications import Starlette

    provider = _make_provider(tmp_path)
    provider.set_mcp_path("/mcp")
    app = Starlette(routes=provider.get_routes("/mcp"))  # as FastMCP mounts it

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=_BASE_URL) as http:
        r = await http.get("/.well-known/oauth-protected-resource")

    assert r.status_code == 200
    assert r.json()["resource"] == f"{_BASE_URL}/mcp"


# ---------------------------------------------------------------------------
# ScopeHintMiddleware — scope="…" on every 401/403 WWW-Authenticate
# ---------------------------------------------------------------------------


def _responding(status: int, headers: list[tuple[bytes, bytes]]):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": b""})

    return app


async def _www_authenticate(status: int, headers: list[tuple[bytes, bytes]]) -> list[str]:
    from mcp_server.oauth_provider import ScopeHintMiddleware

    app = ScopeHintMiddleware(_responding(status, headers), ["admin", "editor"])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
        r = await http.get("/mcp")
    return r.headers.get_list("www-authenticate")


@pytest.mark.parametrize(
    "status, headers, expected",
    [
        (401, [], ['Bearer scope="admin editor"']),
        (403, [(b"WWW-Authenticate", b'Bearer error="insufficient_scope"')],
         ['Bearer error="insufficient_scope", scope="admin editor"']),
        (401, [(b"www-authenticate", b'Bearer scope="editor"')], ['Bearer scope="editor"']),
        (200, [], []),
    ],
    ids=["added", "appended", "kept", "success-untouched"],
)
async def test_scope_hint_middleware(status, headers, expected):
    assert await _www_authenticate(status, headers) == expected


async def test_scope_hint_middleware_passes_non_http_through():
    from mcp_server.oauth_provider import ScopeHintMiddleware

    seen = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    await ScopeHintMiddleware(inner, ["editor"])({"type": "lifespan"}, AsyncMock(), AsyncMock())
    assert seen == ["lifespan"]
