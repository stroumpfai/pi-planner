"""Integration tests for edit lock routes (Phase 2.4)."""
import pytest
from datetime import datetime, timezone, timedelta
from app.models.edit_lock import EditLock
from app.services.auth import hash_password
from app.models.user import User


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Lock Project"})).json()


@pytest.fixture
async def second_client(db):
    """A second authenticated client representing a different user."""
    from httpx import ASGITransport, AsyncClient
    from app.main import app
    from app.database import get_session

    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session

    db.add(User(username="otheruser", password_hash=hash_password("password"), is_admin=False))
    await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/auth/login", json={"username": "otheruser", "password": "password"})
        assert resp.status_code == 200
        yield ac


# ── Get lock status ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_edit_lock_no_lock(client, project):
    resp = await client.get(f"/api/v1/projects/{project['system_id']}/edit-lock")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_locked"] is False
    assert data["locked_by_username"] is None


# ── Acquire ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_acquire_lock_fresh(client, project):
    pid = project["system_id"]
    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_locked"] is True
    assert data["locked_by_username"] == "testuser"
    assert data["expires_at"] is not None


@pytest.mark.asyncio
async def test_acquire_lock_status_reflects_locked(client, project):
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    resp = await client.get(f"/api/v1/projects/{pid}/edit-lock")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_locked"] is True
    assert data["locked_by_username"] == "testuser"


@pytest.mark.asyncio
async def test_acquire_own_lock_again(client, project):
    """Re-acquiring your own active lock succeeds and refreshes the expiry."""
    pid = project["system_id"]
    first = (await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")).json()
    second = (await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")).json()
    assert second["is_locked"] is True
    assert second["locked_by_username"] == "testuser"
    # Second acquire should renew expiry (≥ first)
    first_exp = datetime.fromisoformat(first["expires_at"])
    second_exp = datetime.fromisoformat(second["expires_at"])
    assert second_exp >= first_exp


@pytest.mark.asyncio
async def test_acquire_lock_held_by_other_user_409(client, project, second_client):
    pid = project["system_id"]
    # Other user acquires lock first
    resp = await second_client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    assert resp.status_code == 200

    # Our user tries to acquire — should get 409
    resp2 = await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_acquire_expired_lock_succeeds(client, db, project):
    """Can acquire a lock that was held by another user but has expired."""
    pid = project["system_id"]
    # Manually insert an expired lock for otheruser
    expired = datetime.now(timezone.utc) - timedelta(minutes=5)
    lock = EditLock(
        project_id=pid,
        locked_by_username="otheruser",
        locked_at=expired,
        expires_at=expired,
    )
    db.add(lock)
    await db.commit()

    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    assert resp.status_code == 200
    assert resp.json()["locked_by_username"] == "testuser"


# ── Release ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_release_own_lock(client, project):
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/release")
    assert resp.status_code == 204

    status_resp = (await client.get(f"/api/v1/projects/{pid}/edit-lock")).json()
    assert status_resp["is_locked"] is False


@pytest.mark.asyncio
async def test_release_no_lock_is_silent(client, project):
    """Releasing when there's no lock is a no-op (204)."""
    pid = project["system_id"]
    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/release")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_release_other_users_lock_is_noop(client, project, second_client):
    """Releasing another user's lock does nothing."""
    pid = project["system_id"]
    await second_client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    # testuser tries to release otheruser's lock
    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/release")
    assert resp.status_code == 204
    # Lock should still be active
    status_resp = (await client.get(f"/api/v1/projects/{pid}/edit-lock")).json()
    assert status_resp["is_locked"] is True


# ── Keepalive ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_keepalive_extends_expiry(client, project):
    pid = project["system_id"]
    first = (await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")).json()
    keepalive = (await client.post(f"/api/v1/projects/{pid}/edit-lock/keepalive")).json()
    assert keepalive["is_locked"] is True
    first_exp = datetime.fromisoformat(first["expires_at"])
    keepalive_exp = datetime.fromisoformat(keepalive["expires_at"])
    assert keepalive_exp >= first_exp


@pytest.mark.asyncio
async def test_keepalive_without_lock_403(client, project):
    pid = project["system_id"]
    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/keepalive")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_keepalive_other_users_lock_403(client, project, second_client):
    pid = project["system_id"]
    await second_client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/keepalive")
    assert resp.status_code == 403
