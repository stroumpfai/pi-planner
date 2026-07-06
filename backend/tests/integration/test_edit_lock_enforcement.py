"""Integration tests for server-side edit-lock enforcement on write endpoints.

The single-writer rule is enforced by the ``require_edit_lock`` dependency: a
content-mutating request is rejected with 409 only when a *different* user holds
an unexpired lock on the target project. When no lock is held (or the caller
holds it) the write proceeds, and readers are rejected with 403.
"""
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.database import get_session
from app.main import app
from app.models.edit_lock import EditLock
from app.models.user import Role
from app.services import users as users_module
from app.services.auth import hash_password

pytestmark = pytest.mark.asyncio

_LOGIN_URL = "/api/v1/auth/login"  # noqa: S105
_OTHER_SECRET = "otherpass"  # noqa: S105


@pytest_asyncio.fixture
async def second_client(db):
    """A second authenticated editor representing a different user."""
    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session
    await users_module.create(
        db,
        username="otheruser",
        password_hash=hash_password(_OTHER_SECRET),
        display_name=None,
        role=Role.editor,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as ac:
        resp = await ac.post(_LOGIN_URL, json={"username": "otheruser", "password": _OTHER_SECRET})
        assert resp.status_code == 200
        yield ac


@pytest_asyncio.fixture
async def planned(client):
    """A project with one feature and one PBI, created by testuser (no lock held)."""
    pid = (await client.post("/api/v1/projects/", json={"name": "Enf Project"})).json()["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login", "effort": 3, "parent_feature_system_id": feature["system_id"]},
    )).json()
    return {"project_id": pid, "feature": feature, "pbi": pbi}


async def _acquire(ac: AsyncClient, project_id: str) -> None:
    resp = await ac.post(f"/api/v1/projects/{project_id}/edit-lock/acquire")
    assert resp.status_code == 200


# ── Blocked when someone else holds the lock ────────────────────────────────────

async def test_create_blocked_when_other_holds_lock(client, planned, second_client):
    pid = planned["project_id"]
    await _acquire(second_client, pid)
    resp = await client.post(f"/api/v1/projects/{pid}/features", json={"title": "Blocked"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["locked_by"] == "otheruser"


async def test_update_feature_blocked_when_other_holds_lock(client, planned, second_client):
    pid = planned["project_id"]
    await _acquire(second_client, pid)
    resp = await client.patch(
        f"/api/v1/features/{planned['feature']['system_id']}", json={"title": "Nope"}
    )
    assert resp.status_code == 409


async def test_nested_pbi_resolves_project_lock(client, planned, second_client):
    """Updating a PBI (pbi_id path) resolves to its project and honours the lock."""
    pid = planned["project_id"]
    await _acquire(second_client, pid)
    resp = await client.patch(
        f"/api/v1/pbis/{planned['pbi']['system_id']}", json={"title": "Nope"}
    )
    assert resp.status_code == 409


async def test_delete_blocked_when_other_holds_lock(client, planned, second_client):
    pid = planned["project_id"]
    await _acquire(second_client, pid)
    resp = await client.delete(f"/api/v1/pbis/{planned['pbi']['system_id']}")
    assert resp.status_code == 409


# ── Allowed for the lock holder / when unlocked ─────────────────────────────────

async def test_lock_holder_can_write(client, planned):
    pid = planned["project_id"]
    await _acquire(client, pid)
    resp = await client.patch(
        f"/api/v1/features/{planned['feature']['system_id']}", json={"title": "Renamed"}
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"


async def test_write_allowed_when_no_lock(client, planned):
    resp = await client.patch(
        f"/api/v1/features/{planned['feature']['system_id']}", json={"title": "Free"}
    )
    assert resp.status_code == 200


async def test_expired_foreign_lock_allows_write(client, db, planned, second_client):
    pid = planned["project_id"]
    await _acquire(second_client, pid)
    # Force the lock to expire.
    lock = (
        await db.execute(select(EditLock).where(EditLock.project_id == pid))
    ).scalar_one()
    lock.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db.commit()

    resp = await client.patch(
        f"/api/v1/features/{planned['feature']['system_id']}", json={"title": "AfterExpiry"}
    )
    assert resp.status_code == 200


# ── RBAC: readers cannot write even without a lock ──────────────────────────────

async def test_reader_cannot_create_feature(client, reader_client, planned):
    pid = planned["project_id"]
    resp = await reader_client.post(f"/api/v1/projects/{pid}/features", json={"title": "No"})
    assert resp.status_code == 403


async def test_reader_cannot_update_pbi(client, reader_client, planned):
    resp = await reader_client.patch(
        f"/api/v1/pbis/{planned['pbi']['system_id']}", json={"title": "No"}
    )
    assert resp.status_code == 403
