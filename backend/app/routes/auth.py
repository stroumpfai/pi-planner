from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.user import User
from app.schemas import ChangePassword, LoginRequest, TokenResponse, UserResponse
from app.services import users as users_service
from app.services.auth import (
    SESSION_COOKIE,
    SESSION_MAX_AGE_NORMAL,
    SESSION_MAX_AGE_REMEMBER,
    assert_password_policy,
    authenticate,
    create_session,
    delete_session,
    hash_password,
    sign_session_id,
    unsign_session_token,
    verify_password,
)
from app.services.rate_limit import clear_failures, is_rate_limited, record_failure

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    rate_key = f"{ip}:{body.username.lower()}"

    if is_rate_limited(rate_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "TOO_MANY_REQUESTS", "message": "Too many failed login attempts. Try again later."},
        )

    user = await authenticate(db, body.username, body.password)
    if not user:
        record_failure(rate_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    clear_failures(rate_key)

    session_id = await create_session(db, user.username, body.remember_me)
    token = sign_session_id(session_id)
    max_age = SESSION_MAX_AGE_REMEMBER if body.remember_me else SESSION_MAX_AGE_NORMAL

    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=not settings.debug,
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
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> None:
    if session_token:
        session_id = unsign_session_token(session_token)
        if session_id:
            await delete_session(db, session_id)
    response.delete_cookie(key=SESSION_COOKIE, samesite="lax")


@router.get("/me")
async def me(current_user: Annotated[User, Depends(get_current_user)]) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePassword,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    if not verify_password(body.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "WRONG_PASSWORD", "message": "Current password is incorrect"},
        )
    assert_password_policy(body.new_password, current_user.username)
    await users_service.set_password(db, current_user.username, hash_password(body.new_password))
