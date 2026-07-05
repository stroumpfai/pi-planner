"""Integration tests for the API-key admin endpoints and the MCP service-JWT
authentication path (deps._resolve_mcp_user + require_service_jwt)."""

from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest

from app.config import settings

pytestmark = pytest.mark.asyncio

_KEYS_URL = "/api/v1/api-keys"
_TEST_SECRET = "test-mcp-signing-secret-at-least-32-bytes-long"


def _service_jwt(
    secret: str = _TEST_SECRET,
    *,
    iss: str = "mcp-server",
    sub: str = "service",
    actor: str | None = None,
) -> str:
    claims: dict = {"iss": iss, "sub": sub, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}
    if actor is not None:
        claims["actor"] = actor
    return pyjwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture
def mcp_secret(monkeypatch):
    monkeypatch.setattr(settings, "mcp_signing_secret", _TEST_SECRET)
    return _TEST_SECRET


# ---------------------------------------------------------------------------
# Admin key management
# ---------------------------------------------------------------------------


async def test_create_key_returns_full_token(client):
    resp = await client.post(
        f"{_KEYS_URL}/admin/keys",
        json={"username": "testuser", "name": "CI", "purpose": "pipeline"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["username"] == "testuser"
    assert body["name"] == "CI"
    assert body["full_token"]


async def test_create_key_unknown_user_404(client):
    resp = await client.post(
        f"{_KEYS_URL}/admin/keys",
        json={"username": "ghost", "name": "CI"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "USER_NOT_FOUND"


async def test_list_all_keys(client):
    await client.post(f"{_KEYS_URL}/admin/keys", json={"username": "testuser", "name": "K1"})
    resp = await client.get(f"{_KEYS_URL}/admin/all-keys")
    assert resp.status_code == 200
    keys = resp.json()
    assert len(keys) == 1
    assert keys[0]["name"] == "K1"


async def test_my_keys_lists_only_active_own_keys(client):
    await client.post(f"{_KEYS_URL}/admin/keys", json={"username": "testuser", "name": "Mine"})
    resp = await client.get(f"{_KEYS_URL}/my-keys")
    assert resp.status_code == 200
    assert [k["name"] for k in resp.json()] == ["Mine"]


async def test_my_activities_empty(client):
    resp = await client.get(f"{_KEYS_URL}/my-activities")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_admin_activities_empty(client):
    resp = await client.get(f"{_KEYS_URL}/admin/activities")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_cycle_key_creates_replacement_and_revokes_old(client):
    created = (
        await client.post(
            f"{_KEYS_URL}/admin/keys",
            json={"username": "testuser", "name": "Rotating", "expires_in_days": 30},
        )
    ).json()

    resp = await client.post(f"{_KEYS_URL}/admin/cycle/{created['id']}")
    assert resp.status_code == 201
    new_key = resp.json()
    assert new_key["id"] != created["id"]
    assert new_key["name"] == "Rotating"

    # Only the new key remains active (my-keys filters to active keys).
    active = (await client.get(f"{_KEYS_URL}/my-keys")).json()
    assert [k["id"] for k in active] == [new_key["id"]]


async def test_cycle_missing_key_404(client):
    resp = await client.post(f"{_KEYS_URL}/admin/cycle/does-not-exist")
    assert resp.status_code == 404


async def test_revoke_key(client):
    created = (
        await client.post(f"{_KEYS_URL}/admin/keys", json={"username": "testuser", "name": "Temp"})
    ).json()
    resp = await client.delete(f"{_KEYS_URL}/admin/keys/{created['id']}")
    assert resp.status_code == 204
    assert (await client.get(f"{_KEYS_URL}/my-keys")).json() == []


async def test_revoke_missing_key_404(client):
    resp = await client.delete(f"{_KEYS_URL}/admin/keys/nope")
    assert resp.status_code == 404


async def test_create_key_forbidden_for_editor(editor_client):
    resp = await editor_client.post(
        f"{_KEYS_URL}/admin/keys", json={"username": "editor_user", "name": "X"}
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# MCP service-JWT verify endpoint (require_service_jwt)
# ---------------------------------------------------------------------------


async def test_verify_key_via_service_jwt(client, mcp_secret):
    created = (
        await client.post(f"{_KEYS_URL}/admin/keys", json={"username": "testuser", "name": "MCP"})
    ).json()

    resp = await client.post(
        f"{_KEYS_URL}/admin/verify",
        json={"token": created["full_token"]},
        headers={"Authorization": f"Bearer {_service_jwt(mcp_secret)}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "testuser"
    assert body["role"] == "admin"


async def test_verify_invalid_token_401(client, mcp_secret):
    resp = await client.post(
        f"{_KEYS_URL}/admin/verify",
        json={"token": "pk_not_a_real_token"},
        headers={"Authorization": f"Bearer {_service_jwt(mcp_secret)}"},
    )
    assert resp.status_code == 401


async def test_verify_requires_service_jwt(client):
    resp = await client.post(f"{_KEYS_URL}/admin/verify", json={"token": "x"})
    assert resp.status_code == 401


async def test_verify_rejects_wrong_secret(client, mcp_secret):
    resp = await client.post(
        f"{_KEYS_URL}/admin/verify",
        json={"token": "x"},
        headers={"Authorization": f"Bearer {_service_jwt('a-different-secret-also-32-bytes-long!!')}"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# MCP actor authentication path on a normal (read) endpoint
# ---------------------------------------------------------------------------


async def test_mcp_actor_can_authenticate_on_read(db, mcp_secret):
    """A GET request with a valid service JWT + X-MCP-Actor resolves to that user."""
    from httpx import ASGITransport, AsyncClient

    from app.database import get_session
    from app.main import app
    from app.models.user import Role
    from app.services import users as users_module
    from app.services.auth import hash_password

    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session
    await users_module.create(
        db,
        username="mcpuser",
        password_hash=hash_password("password"),
        display_name="MCP User",
        role=Role.editor,
    )
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="https://test") as ac:
            headers = {
                "Authorization": f"Bearer {_service_jwt(mcp_secret, actor='mcpuser')}",
                "X-MCP-Actor": "mcpuser",
            }
            # my-keys requires editor-or-above and returns 200 for a resolved actor.
            resp = await ac.get(f"{_KEYS_URL}/my-keys", headers=headers)
            assert resp.status_code == 200

            # Missing actor header → 400
            resp = await ac.get(
                f"{_KEYS_URL}/my-keys",
                headers={"Authorization": f"Bearer {_service_jwt(mcp_secret, actor='mcpuser')}"},
            )
            assert resp.status_code == 400

            # Unknown actor → 401
            resp = await ac.get(
                f"{_KEYS_URL}/my-keys",
                headers={
                    "Authorization": f"Bearer {_service_jwt(mcp_secret, actor='ghost')}",
                    "X-MCP-Actor": "ghost",
                },
            )
            assert resp.status_code == 401

            # Actor header not matching the signed claim → 401 (replay protection)
            resp = await ac.get(
                f"{_KEYS_URL}/my-keys",
                headers={
                    "Authorization": f"Bearer {_service_jwt(mcp_secret, actor='mcpuser')}",
                    "X-MCP-Actor": "testuser",
                },
            )
            assert resp.status_code == 401

            # JWT without any actor claim → 401 (legacy tokens are rejected)
            resp = await ac.get(
                f"{_KEYS_URL}/my-keys",
                headers={
                    "Authorization": f"Bearer {_service_jwt(mcp_secret)}",
                    "X-MCP-Actor": "mcpuser",
                },
            )
            assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()
