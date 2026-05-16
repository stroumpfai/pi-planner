from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.user import User
from app.schemas import LoginRequest, TokenResponse, UserResponse
from app.services.auth import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_NORMAL,
    SESSION_MAX_AGE_REMEMBER,
    authenticate,
    create_session,
    delete_session,
    sign_session_id,
    unsign_session_token,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    user = await authenticate(db, body.username, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    session_id = await create_session(db, user.username, body.remember_me)
    token = sign_session_id(session_id)
    max_age = SESSION_MAX_AGE_REMEMBER if body.remember_me else SESSION_MAX_AGE_NORMAL

    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=False,  # set True in production behind HTTPS
    )
    return TokenResponse(
        user=UserResponse.model_validate(user),
        session_id=session_id,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    # Best-effort: extract session_id from cookie to delete it; cookie cleared regardless
    response.delete_cookie(key=SESSION_COOKIE, samesite="lax")


@router.get("/me")
async def me(current_user: Annotated[User, Depends(get_current_user)]) -> UserResponse:
    return UserResponse.model_validate(current_user)
