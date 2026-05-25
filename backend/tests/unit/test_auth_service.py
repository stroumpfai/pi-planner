from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from app.models.session import Session
from app.models.user import Role
from app.services import users as users_module
from app.services.auth import (
    authenticate,
    create_session,
    delete_session,
    get_user_from_session_id,
    hash_password,
    sign_session_id,
    unsign_session_token,
    verify_password,
)

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
_SECRET = "secret"  # noqa: S105


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        import app.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def user(db):
    return await users_module.create(
        db,
        username="alice",
        password_hash=hash_password(_SECRET),
        display_name=None,
        role=Role.reader,
    )


# ── hash / verify ────────────────────────────────────────────────────────────

def test_hash_and_verify_correct():
    h = hash_password("mypassword")
    assert verify_password("mypassword", h)


def test_verify_wrong_password():
    h = hash_password("mypassword")
    assert not verify_password("wrong", h)


# ── sign / unsign ─────────────────────────────────────────────────────────────

def test_sign_unsign_roundtrip():
    token = sign_session_id("abc-123")
    assert unsign_session_token(token) == "abc-123"


def test_unsign_tampered_token_returns_none():
    assert unsign_session_token("not.a.valid.token") is None


def test_unsign_garbage_returns_none():
    assert unsign_session_token("aaaa.bbbb.cccc") is None


# ── authenticate ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_authenticate_correct_password(db, user):
    result = await authenticate(db, "alice", _SECRET)
    assert result is not None
    assert result.username == "alice"


@pytest.mark.asyncio
async def test_authenticate_wrong_password_returns_none(db, user):
    result = await authenticate(db, "alice", "wrong")
    assert result is None


@pytest.mark.asyncio
async def test_authenticate_unknown_user_returns_none(db):
    result = await authenticate(db, "nobody", _SECRET)
    assert result is None


# ── create_session / get_user_from_session_id ─────────────────────────────────

@pytest.mark.asyncio
async def test_create_session_normal_returns_valid_session(db, user):
    session_id = await create_session(db, "alice", remember_me=False)
    assert session_id
    result = await get_user_from_session_id(db, session_id)
    assert result is not None
    assert result.username == "alice"


@pytest.mark.asyncio
async def test_create_session_remember_me_returns_valid_session(db, user):
    session_id = await create_session(db, "alice", remember_me=True)
    result = await get_user_from_session_id(db, session_id)
    assert result is not None


@pytest.mark.asyncio
async def test_get_user_from_expired_session_returns_none(db, user):
    session = Session(
        session_id="expired-id",
        username="alice",
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        remember_me=False,
    )
    db.add(session)
    await db.commit()
    assert await get_user_from_session_id(db, "expired-id") is None


@pytest.mark.asyncio
async def test_get_user_from_unknown_session_returns_none(db):
    assert await get_user_from_session_id(db, "no-such-id") is None


@pytest.mark.asyncio
async def test_get_user_from_session_unknown_username_returns_none(db):
    """Session exists in DB but username does not exist in users table."""
    session = Session(
        session_id="valid-session",
        username="ghost",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        remember_me=False,
    )
    db.add(session)
    await db.commit()
    assert await get_user_from_session_id(db, "valid-session") is None


# ── delete_session ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_session_removes_access(db, user):
    session_id = await create_session(db, "alice", remember_me=False)
    assert await get_user_from_session_id(db, session_id) is not None
    await delete_session(db, session_id)
    assert await get_user_from_session_id(db, session_id) is None


@pytest.mark.asyncio
async def test_delete_nonexistent_session_does_not_raise(db):
    await delete_session(db, "ghost-session")  # must not raise
