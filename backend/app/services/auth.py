from datetime import datetime, timedelta, timezone
from uuid import uuid4

import bcrypt
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.session import Session
from app.models.user import User
from app.services import users

_signer = URLSafeTimedSerializer(settings.secret_key)

SESSION_COOKIE = "pi_session"
SESSION_MAX_AGE_NORMAL = 3600          # 1 hour
SESSION_MAX_AGE_REMEMBER = 30 * 86400  # 30 days


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def sign_session_id(session_id: str) -> str:
    return _signer.dumps(session_id)


def unsign_session_token(token: str) -> str | None:
    try:
        return _signer.loads(token, max_age=SESSION_MAX_AGE_REMEMBER)
    except BadSignature:
        return None


def authenticate(username: str, password: str) -> User | None:
    user = users.get(username)
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
    return users.get(db_session.username)


async def delete_session(db: AsyncSession, session_id: str) -> None:
    result = await db.execute(select(Session).where(Session.session_id == session_id))
    db_session = result.scalar_one_or_none()
    if db_session:
        await db.delete(db_session)
        await db.commit()
