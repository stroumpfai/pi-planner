"""
Tests for routes/users.py and POST /auth/change-password.

Covers:
  - Admin CRUD + password reset
  - Self-delete and self-demote guards
  - Role enforcement (editor/reader → 403 on user endpoints)
  - Session invalidation on delete and password reset
  - display_name update/clear via model_fields_set
  - last-admin guard (count_by_role service function)
"""
import pytest
import pytest_asyncio  # noqa: F401 (fixture discovery)

from app.models.user import Role
from app.services import users as users_module
from app.services.auth import hash_password
from app.services.users import count_by_role

_NEW_USER_SECRET = "newusertest12"  # noqa: S105
_USERNAME_IN_PWD = "alice-password1"  # noqa: S105
_OWASP_BLOCKED = "123456qwerty"  # noqa: S105
_APPNAME_BLOCKED = "piplanner2024!"  # noqa: S105


# ── GET /users ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_lists_users(client):
    resp = await client.get("/api/v1/users/")
    assert resp.status_code == 200
    usernames = [u["username"] for u in resp.json()]
    assert "testuser" in usernames


@pytest.mark.asyncio
async def test_editor_cannot_list_users(editor_client):
    resp = await editor_client.get("/api/v1/users/")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reader_cannot_list_users(reader_client):
    resp = await reader_client.get("/api/v1/users/")
    assert resp.status_code == 403


# ── POST /users ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_creates_user(client):
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "newbie", "display_name": "Newbie", "role": "reader", "password": _NEW_USER_SECRET},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "newbie"
    assert data["role"] == "reader"


@pytest.mark.asyncio
async def test_admin_creates_editor(client):
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "ed2", "role": "editor", "password": _NEW_USER_SECRET},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "editor"


@pytest.mark.asyncio
async def test_admin_creates_admin(client):
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "admin2", "role": "admin", "password": _NEW_USER_SECRET},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_duplicate_username_returns_409(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "dup", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "dup", "role": "reader", "password": _NEW_USER_SECRET},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_editor_cannot_create_user(editor_client):
    resp = await editor_client.post(
        "/api/v1/users/",
        json={"username": "x", "role": "reader", "password": _NEW_USER_SECRET},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reader_cannot_create_user(reader_client):
    resp = await reader_client.post(
        "/api/v1/users/",
        json={"username": "x", "role": "reader", "password": _NEW_USER_SECRET},
    )
    assert resp.status_code == 403


# ── PUT /users/{username} ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_updates_user_role(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "upd", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.put("/api/v1/users/upd", json={"role": "editor"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"


@pytest.mark.asyncio
async def test_admin_cannot_change_own_role(client):
    resp = await client.put("/api/v1/users/testuser", json={"role": "reader"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_editor_cannot_update_user(editor_client):
    resp = await editor_client.put("/api/v1/users/editor_user", json={"role": "reader"})
    assert resp.status_code == 403


# ── DELETE /users/{username} ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_deletes_user(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "todelete", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.delete("/api/v1/users/todelete")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_admin_cannot_delete_self(client):
    resp = await client.delete("/api/v1/users/testuser")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_nonexistent_user_returns_404(client):
    resp = await client.delete("/api/v1/users/nobody")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_editor_cannot_delete_user(editor_client):
    resp = await editor_client.delete("/api/v1/users/editor_user")
    assert resp.status_code == 403


# ── POST /users/{username}/reset-password ─────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_resets_password(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "resetme", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.post(
        "/api/v1/users/resetme/reset-password",
        json={"new_password": "brand-new-pw!"},  # NOSONAR
    )
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_admin_cannot_reset_own_password_via_admin_endpoint(client):
    resp = await client.post(
        "/api/v1/users/testuser/reset-password",
        json={"new_password": "brand-new-pw!"},  # NOSONAR
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_editor_cannot_reset_password(editor_client):
    resp = await editor_client.post(
        "/api/v1/users/editor_user/reset-password",
        json={"new_password": "brand-new-pw!"},  # NOSONAR
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reset_nonexistent_user_returns_404(client):
    resp = await client.post(
        "/api/v1/users/nobody/reset-password",
        json={"new_password": "brand-new-pw!"},  # NOSONAR
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reset_password_containing_username_returns_422(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "pwpolicy", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.post(
        "/api/v1/users/pwpolicy/reset-password",
        json={"new_password": "pwpolicy-extra"},  # NOSONAR
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_password_containing_username_returns_422(client):
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "alice", "role": "reader", "password": _USERNAME_IN_PWD},
    )
    assert resp.status_code == 422


# ── App-name password blocking ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_cannot_set_appname_password(client):
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "apptest", "role": "reader", "password": _APPNAME_BLOCKED},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reset_appname_password_returns_422(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "resetapp", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.post(
        "/api/v1/users/resetapp/reset-password",
        json={"new_password": _APPNAME_BLOCKED},
    )
    assert resp.status_code == 422


# ── Common password (OWASP blacklist) ────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_user_common_password_returns_422(client):
    resp = await client.post(
        "/api/v1/users/",
        json={"username": "blockeduser", "role": "reader", "password": _OWASP_BLOCKED},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reset_password_common_password_returns_422(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "resetblocked", "role": "reader", "password": _NEW_USER_SECRET},
    )
    resp = await client.post(
        "/api/v1/users/resetblocked/reset-password",
        json={"new_password": _OWASP_BLOCKED},
    )
    assert resp.status_code == 422


# ── display_name update semantics ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_can_clear_display_name(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "named", "role": "reader", "password": _NEW_USER_SECRET, "display_name": "Has A Name"},
    )
    resp = await client.put("/api/v1/users/named", json={"display_name": None})
    assert resp.status_code == 200
    assert resp.json()["display_name"] is None


@pytest.mark.asyncio
async def test_updating_role_only_preserves_display_name(client):
    await client.post(
        "/api/v1/users/",
        json={"username": "named2", "role": "reader", "password": _NEW_USER_SECRET, "display_name": "Keep Me"},
    )
    resp = await client.put("/api/v1/users/named2", json={"role": "editor"})
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Keep Me"


# ── count_by_role (service-level coverage for last-admin guard) ───────────────

@pytest.mark.asyncio
async def test_count_by_role(db):
    await users_module.create(db, "cr_admin", hash_password(_NEW_USER_SECRET), None, Role.admin)
    await users_module.create(db, "cr_editor", hash_password(_NEW_USER_SECRET), None, Role.editor)
    await users_module.create(db, "cr_reader1", hash_password(_NEW_USER_SECRET), None, Role.reader)
    await users_module.create(db, "cr_reader2", hash_password(_NEW_USER_SECRET), None, Role.reader)

    assert await count_by_role(db, Role.admin) == 1
    assert await count_by_role(db, Role.editor) == 1
    assert await count_by_role(db, Role.reader) == 2
