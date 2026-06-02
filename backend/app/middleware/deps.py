from datetime import timedelta
from typing import Annotated

import jwt as pyjwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models.user import Role, User
from app.services.auth import (
    SESSION_COOKIE,
    get_user_from_session_id,
    unsign_session_token,
)
from app.services import users as users_service

_BEARER_PREFIX = "Bearer "


def _extract_bearer(authorization: str | None) -> str | None:
    """Return the token string if *authorization* is a Bearer header, else None."""
    if authorization and authorization.startswith(_BEARER_PREFIX):
        return authorization.removeprefix(_BEARER_PREFIX).strip()
    return None


def _decode_service_jwt(token: str) -> dict | None:
    """Decode and validate a service JWT. Returns claims dict or None on failure.

    Caller must ensure mcp_signing_secret is configured before calling.
    """
    try:
        claims = pyjwt.decode(
            token,
            settings.mcp_signing_secret,
            algorithms=["HS256"],
            options={"require": ["exp"]},
            leeway=timedelta(seconds=30),
        )
    except pyjwt.PyJWTError:
        return None
    if claims.get("iss") == "mcp-server" and claims.get("sub") == "service":
        return claims
    return None


async def _resolve_mcp_user(
    request: Request, db: AsyncSession
) -> User | None:
    """Try to authenticate via service JWT + X-MCP-Actor header.

    Returns the actor User on success, raises HTTPException when a Bearer
    token is present (service auth was intended) but fails for any reason,
    or None when no Bearer token is present at all.
    """
    token = _extract_bearer(request.headers.get("authorization"))
    if token is None:
        return None
    # Bearer token presented — intent is service JWT auth; any failure is a hard error
    if not settings.mcp_signing_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MCP signing secret not configured",
        )
    claims = _decode_service_jwt(token)
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired service JWT",
        )
    actor = request.headers.get("X-MCP-Actor")
    if not actor:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-MCP-Actor header required with service JWT",
        )
    user = await users_service.get(db, actor)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="MCP actor user not found",
        )
    return user


async def get_current_user(
    request: Request,
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: AsyncSession = Depends(get_session),
) -> User:
    # Path 1: service JWT (MCP server calling on behalf of a human user)
    mcp_user = await _resolve_mcp_user(request, db)
    if mcp_user is not None:
        return mcp_user

    # Path 2: session cookie (existing logic)
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    session_id = unsign_session_token(session_token)
    if not session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session"
        )
    user = await get_user_from_session_id(db, session_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired"
        )
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


def require_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return current_user


def require_editor_or_above(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    if current_user.role == Role.reader:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Readers cannot perform this action",
        )
    return current_user


def require_service_jwt(
    authorization: str | None = Header(default=None),
) -> None:
    """Validate a short-lived HS256 service JWT from the MCP server.

    Raises HTTP 401/503 on failure. Returns None on success (just validates).
    Used exclusively on POST /api/v1/api-keys/admin/verify.
    """
    token = _extract_bearer(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Service JWT required",
        )
    if not settings.mcp_signing_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MCP signing secret not configured",
        )
    claims = _decode_service_jwt(token)
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired service JWT",
        )
