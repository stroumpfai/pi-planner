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
    store = TokenStore(str(tmp_path / "tokens.json"))
    # Write an already-expired entry directly to internal dict
    store._tokens["tok_expired"] = {
        "token": "tok_expired",
        "client_id": "alice",
        "scopes": ["admin"],
        "claims": {},
        "expires_at": time.time() - 1,
    }
    assert store.get_token("tok_expired") is None


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


async def test_metadata_does_not_advertise_refresh_token(tmp_path):
    """/.well-known/oauth-authorization-server must not list refresh_token (RFC 8414 §2)."""
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
    assert "refresh_token" not in grant_types
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
    assert stored.client_id == "alice"
    assert stored.claims["key_id"] == "kid_abc"
    assert stored.claims["role"] == "admin"


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


# ---------------------------------------------------------------------------
# PiPlannerOAuthProvider — no refresh token support
# ---------------------------------------------------------------------------


async def test_no_refresh_token_support(tmp_path):
    from mcp.server.auth.provider import RefreshToken, TokenError

    provider = _make_provider(tmp_path)
    client = _make_client()
    fake_refresh = RefreshToken(token="rt_abc", client_id="test-client", scopes=["admin"])

    with pytest.raises(TokenError) as exc_info:
        await provider.exchange_refresh_token(client, fake_refresh, ["admin"])
    assert exc_info.value.error == "unsupported_grant_type"


async def test_load_refresh_token_always_none(tmp_path):
    provider = _make_provider(tmp_path)
    client = _make_client()
    result = await provider.load_refresh_token(client, "any_rt")
    assert result is None


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
    assert result.client_id == "bob"


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
