import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.api_key import APIKey
from app.models.session import Session
from app.models.user import User
from app.services import users

_signer = URLSafeTimedSerializer(settings.secret_key)

SESSION_COOKIE = "pi_session"
SESSION_MAX_AGE_NORMAL = 3600          # 1 hour
SESSION_MAX_AGE_REMEMBER = 30 * 86400  # 30 days

_COMMON_PASSWORDS: frozenset[str] = frozenset(
    line.strip().lower()
    for line in (Path(__file__).parent.parent / "data" / "common-passwords.txt")
    .read_text(encoding="utf-8")
    .splitlines()
    if len(line.strip()) >= 12
)


_APP_TERMS: frozenset[str] = frozenset({"piplanner", "pi-planner", "pi_planner", "piplan"})


def assert_password_policy(password: str, username: str) -> None:
    if username.lower() in password.lower():
        raise HTTPException(
            status_code=422,
            detail={"error": "WEAK_PASSWORD", "message": "Password must not contain the username"},
        )
    if any(term in password.lower() for term in _APP_TERMS):
        raise HTTPException(
            status_code=422,
            detail={"error": "WEAK_PASSWORD", "message": "Password must not relate to the application name"},
        )
    if password.lower() in _COMMON_PASSWORDS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "COMMON_PASSWORD",
                "message": "This password is too commonly used, please choose a more unique one",
            },
        )


_ph = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        _ph.verify(hashed, password)
        return True
    except (VerifyMismatchError, InvalidHashError):
        return False


def sign_session_id(session_id: str) -> str:
    return _signer.dumps(session_id)


def unsign_session_token(token: str) -> str | None:
    try:
        session_id: str = _signer.loads(token, max_age=SESSION_MAX_AGE_REMEMBER)
        return session_id
    except BadSignature:
        return None


async def authenticate(db: AsyncSession, username: str, password: str) -> User | None:
    user = await users.get(db, username)
    if user and verify_password(password, user.password_hash):
        return user
    return None


async def create_session(db: AsyncSession, username: str, remember_me: bool) -> str:
    session_id = str(uuid4())
    duration = timedelta(days=30) if remember_me else timedelta(hours=1)
    expires = datetime.now(timezone.utc) + duration
    db.add(Session(session_id=session_id, username=username, expires_at=expires, remember_me=remember_me))
    await db.commit()
    return session_id


async def get_user_from_session_id(db: AsyncSession, session_id: str) -> User | None:
    result = await db.execute(
        select(Session).where(
            Session.session_id == session_id,
            Session.expires_at > datetime.now(timezone.utc),
        )
    )
    db_session = result.scalar_one_or_none()
    if not db_session:
        return None
    return await users.get(db, db_session.username)


async def delete_session(db: AsyncSession, session_id: str) -> None:
    result = await db.execute(select(Session).where(Session.session_id == session_id))
    db_session = result.scalar_one_or_none()
    if db_session:
        await db.delete(db_session)
        await db.commit()


async def invalidate_all_sessions(
    db: AsyncSession, username: str, except_session_id: str | None = None
) -> None:
    stmt = delete(Session).where(Session.username == username)
    if except_session_id:
        stmt = stmt.where(Session.session_id != except_session_id)
    await db.execute(stmt)
    await db.commit()


async def create_api_key(
    db: AsyncSession,
    username: str,
    name: str,
    purpose: str | None,
    expires_in_days: int | None,
) -> tuple[str, str]:
    """Create a new API key for the given user.

    Returns (key_id, full_token). The full_token must be shown once to the user
    and is never stored — only the argon2 hash of the secret portion is kept.
    Key format: "kid_<8-char-urlsafe>.<24-char-urlsafe-secret>"
    """
    key_id = f"kid_{secrets.token_urlsafe(8)}"
    secret = secrets.token_urlsafe(24)
    full_token = f"{key_id}.{secret}"
    key_hash = _ph.hash(secret)
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    expires_at = (
        now_naive + timedelta(days=expires_in_days)
        if expires_in_days is not None
        else None
    )
    db.add(
        APIKey(
            id=key_id,
            username=username,
            key_hash=key_hash,
            name=name,
            purpose=purpose,
            created_at=now_naive,
            expires_at=expires_at,
            is_active=True,
        )
    )
    await db.commit()
    return key_id, full_token


async def verify_api_key(
    db: AsyncSession, full_token: str
) -> tuple[str, str] | None:
    """Verify an API key token.

    Returns (key_id, username) or None if invalid/expired.
    Updates last_used_at on success.
    """
    if "." not in full_token:
        return None
    key_id, secret = full_token.split(".", 1)
    api_key = await db.get(APIKey, key_id)
    if not api_key or not api_key.is_active:
        return None
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    if api_key.expires_at and api_key.expires_at < now_utc:
        return None
    try:
        _ph.verify(api_key.key_hash, secret)
    except Exception:
        return None
    api_key.last_used_at = now_utc
    await db.commit()
    return api_key.id, api_key.username


async def revoke_api_key(db: AsyncSession, key_id: str) -> bool:
    """Soft-delete an API key by setting is_active=False.

    Returns False if the key was not found.
    """
    api_key = await db.get(APIKey, key_id)
    if not api_key:
        return False
    api_key.is_active = False
    await db.commit()
    return True
