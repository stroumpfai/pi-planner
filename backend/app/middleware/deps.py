from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.user import User
from app.services.auth import SESSION_COOKIE, get_user_from_session_id, unsign_session_token


async def get_current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: AsyncSession = Depends(get_session),
) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    session_id = unsign_session_token(session_token)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    user = await get_user_from_session_id(db, session_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return user


async def get_optional_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: AsyncSession = Depends(get_session),
) -> User | None:
    if not session_token:
        return None
    session_id = unsign_session_token(session_token)
    if not session_id:
        return None
    return await get_user_from_session_id(db, session_id)
