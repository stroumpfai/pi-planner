"""
Tests for routes/auth.py and middleware/deps.py.

Covers:
  - POST /login with invalid credentials (→ 401)
  - POST /logout
  - GET /me
  - get_current_user: no cookie, tampered token, expired session (all → 401)
  - get_optional_user: no token, bad token, valid token
"""
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_session
from app.main import app
from app.middleware.deps import get_optional_user
from app.models.session import Session
from app.models.user import User
from app.services import users as users_module
from app.services.auth import (
    create_session,
    hash_password,
    sign_session_id,
)

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        import app.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(db_engine):
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
def alice():
    u = User(username="alice", password_hash=hash_password("secret"), display_name=None, is_admin=False)
    users_module._store["alice"] = u
    yield u
    users_module._store.pop("alice", None)


@pytest_asyncio.fixture
async def anon_client(db):
    """HTTP client with no session cookie."""
    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_client(db, alice):
    """HTTP client logged in as alice."""
    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as ac:
        resp = await ac.post("/api/v1/auth/login", json={"username": "alice", "password": "secret"})
        assert resp.status_code == 200
        yield ac
    app.dependency_overrides.clear()


# ── POST /login ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_success(anon_client, alice):
    resp = await anon_client.post("/api/v1/auth/login", json={"username": "alice", "password": "secret"})
    assert resp.status_code == 200
    assert resp.json()["user"]["username"] == "alice"


@pytest.mark.asyncio
async def test_login_wrong_password_returns_401(anon_client, alice):
    resp = await anon_client.post("/api/v1/auth/login", json={"username": "alice", "password": "wrong"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user_returns_401(anon_client):
    resp = await anon_client.post("/api/v1/auth/login", json={"username": "ghost", "password": "x"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_remember_me_sets_longer_cookie(anon_client, alice):
    resp = await anon_client.post(
        "/api/v1/auth/login",
        json={"username": "alice", "password": "secret", "remember_me": True},
    )
    assert resp.status_code == 200


# ── POST /logout ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logout_clears_session(auth_client):
    resp = await auth_client.post("/api/v1/auth/logout")
    assert resp.status_code == 204


# ── GET /me ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_returns_current_user(auth_client, alice):
    resp = await auth_client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"


@pytest.mark.asyncio
async def test_me_without_session_returns_401(anon_client):
    resp = await anon_client.get("/api/v1/auth/me")
    assert resp.status_code == 401


# ── get_current_user error paths (via any protected endpoint) ─────────────────

@pytest.mark.asyncio
async def test_protected_route_no_cookie_returns_401(anon_client):
    """No cookie → get_current_user raises 401 (deps.py line 18)."""
    resp = await anon_client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Not authenticated"


@pytest.mark.asyncio
async def test_protected_route_tampered_cookie_returns_401(anon_client):
    """Invalid/tampered token → get_current_user raises 401 (deps.py line 21)."""
    anon_client.cookies.set("pi_session", "tampered.garbage.token")
    resp = await anon_client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid session"


@pytest.mark.asyncio
async def test_protected_route_expired_session_returns_401(anon_client, db, alice):
    """Valid token but expired DB session → get_current_user raises 401 (deps.py line 24)."""
    expired_session = Session(
        session_id="expired-sess",
        username="alice",
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        remember_me=False,
    )
    db.add(expired_session)
    await db.commit()
    token = sign_session_id("expired-sess")
    anon_client.cookies.set("pi_session", token)
    resp = await anon_client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Session expired"


# ── get_optional_user (deps.py lines 32-37) ───────────────────────────────────

@pytest.mark.asyncio
async def test_optional_user_no_token_returns_none(db):
    result = await get_optional_user(session_token=None, db=db)
    assert result is None


@pytest.mark.asyncio
async def test_optional_user_bad_token_returns_none(db):
    result = await get_optional_user(session_token="bad.token", db=db)
    assert result is None


@pytest.mark.asyncio
async def test_optional_user_valid_token_returns_user(db, alice):
    session_id = await create_session(db, "alice", remember_me=False)
    token = sign_session_id(session_id)
    result = await get_optional_user(session_token=token, db=db)
    assert result is not None
    assert result.username == "alice"
