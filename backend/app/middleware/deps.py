from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import jwt as pyjwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.models.user import Role, User
from app.services import users as users_service
from app.services.auth import (
    SESSION_COOKIE,
    get_user_from_session_id,
    unsign_session_token,
)

_BEARER_PREFIX = "Bearer "


def _extract_bearer(authorization: str | None) -> str | None:
    """Return the token string if *authorization* is a Bearer header, else None."""
    if authorization and authorization.startswith(_BEARER_PREFIX):
        return authorization.removeprefix(_BEARER_PREFIX).strip()
    return None


def _decode_service_jwt(token: str) -> dict[str, Any] | None:
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
    # The MCP server bakes the actor into the signed JWT; the header must match
    # so a captured token cannot be replayed as a different user.
    if claims.get("actor") != actor:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Service JWT was not issued for this actor",
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


async def _project_of_pi(db: AsyncSession, pi_id: str | None) -> str | None:
    from app.models.pi import PI

    pi = await db.get(PI, pi_id) if pi_id else None
    return pi.project_id if pi else None


async def _project_of_swimline(db: AsyncSession, swimline_id: str | None) -> str | None:
    from app.models.swimline import Swimline

    swimline = await db.get(Swimline, swimline_id) if swimline_id else None
    return await _project_of_pi(db, swimline.pi_id) if swimline else None


async def _resolve_locked_project_id(
    db: AsyncSession, params: Mapping[str, str]
) -> str | None:
    """Map a write request's path params to the project whose lock guards it.

    Returns None when the target resource doesn't exist (yet), so the route can
    emit its own 404 instead of the lock check masking it.
    """
    from app.models.feature import Feature
    from app.models.group import Group
    from app.models.pbi import PBI
    from app.models.sprint import Sprint

    if project_id := params.get("project_id"):
        return project_id
    if feature_id := params.get("feature_id"):
        feature = await db.get(Feature, feature_id)
        return feature.project_id if feature else None
    if pbi_id := params.get("pbi_id"):
        pbi = await db.get(PBI, pbi_id)
        return pbi.project_id if pbi else None
    if group_id := params.get("group_id"):
        group = await db.get(Group, group_id)
        return await _project_of_swimline(db, group.swimline_id) if group else None
    if swimline_id := params.get("swimline_id"):
        return await _project_of_swimline(db, swimline_id)
    if pi_id := params.get("pi_id"):
        return await _project_of_pi(db, pi_id)
    if sprint_id := params.get("sprint_id"):
        sprint = await db.get(Sprint, sprint_id)
        return await _project_of_pi(db, sprint.pi_id) if sprint else None
    return None


async def require_edit_lock(
    request: Request,
    current_user: Annotated[User, Depends(require_editor_or_above)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Enforce the single-writer edit lock on content-mutating endpoints.

    The request is rejected with 409 only when a *different* user currently
    holds an unexpired lock on the target project — the concurrent-write case
    the lock exists to prevent. When no lock is held, or the caller holds it,
    the write proceeds (so a lone editor and existing non-UI clients keep
    working without an explicit acquire). Being a superset of
    require_editor_or_above, it also blocks readers.
    """
    from app.models.edit_lock import EditLock

    project_id = await _resolve_locked_project_id(db, request.path_params)
    if project_id is None:
        return current_user

    lock = (
        await db.execute(select(EditLock).where(EditLock.project_id == project_id))
    ).scalar_one_or_none()
    if lock and lock.expires_at:
        expires = lock.expires_at.replace(tzinfo=timezone.utc)
        if expires > datetime.now(timezone.utc) and lock.locked_by_username != current_user.username:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": f"Project is being edited by {lock.locked_by_username}",
                    "locked_by": lock.locked_by_username,
                    "expires_at": lock.expires_at.isoformat(),
                },
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
