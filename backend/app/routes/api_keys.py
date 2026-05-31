from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import require_admin, require_editor_or_above, require_service_jwt
from app.models.api_key import APIKey
from app.models.user import User
from app.schemas.api_keys import (
    ActivityLogResponse,
    APIKeyCreate,
    APIKeyCreateResponse,
    APIKeyResponse,
    APIKeyVerifyRequest,
    APIKeyVerifyResponse,
)
from app.services import activity as activity_service
from app.services import auth as auth_service
from app.services import users as users_service

router = APIRouter(prefix="/api/v1/api-keys", tags=["api-keys"])

_KEY_NOT_FOUND = "API key not found"


# ---------------------------------------------------------------------------
# Own-user endpoints (editor or admin)
# ---------------------------------------------------------------------------


@router.get("/my-keys")
async def list_my_keys(
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_editor_or_above)],
) -> list[APIKeyResponse]:
    result = await db.execute(
        select(APIKey).where(
            APIKey.username == current_user.username,
            APIKey.is_active == True,  # noqa: E712
        )
    )
    keys = list(result.scalars().all())
    return [APIKeyResponse.model_validate(k) for k in keys]


@router.get("/my-activities")
async def list_my_activities(
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_editor_or_above)],
) -> list[ActivityLogResponse]:
    logs = await activity_service.get_activities(db, username=current_user.username)
    return [ActivityLogResponse.model_validate(lg) for lg in logs]


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------


@router.post("/admin/keys", status_code=status.HTTP_201_CREATED)
async def create_key(
    body: APIKeyCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
) -> APIKeyCreateResponse:
    user = await users_service.get(db, body.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "USER_NOT_FOUND", "message": f"User '{body.username}' not found"},
        )
    key_id, full_token = await auth_service.create_api_key(
        db,
        username=body.username,
        name=body.name,
        purpose=body.purpose,
        expires_in_days=body.expires_in_days,
    )
    api_key = await db.get(APIKey, key_id)
    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve newly created key",
        )
    return APIKeyCreateResponse(
        id=api_key.id,
        full_token=full_token,
        username=api_key.username,
        name=api_key.name,
        created_at=api_key.created_at,
        expires_at=api_key.expires_at,
    )


@router.post("/admin/cycle/{key_id}", status_code=status.HTTP_201_CREATED)
async def cycle_key(
    key_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
) -> APIKeyCreateResponse:
    old_key = await db.get(APIKey, key_id)
    if not old_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_KEY_NOT_FOUND)

    # Capture attributes before the session state changes
    old_username = old_key.username
    old_name = old_key.name
    old_purpose = old_key.purpose

    # Determine remaining days from the old key's expiry (ceiling so sub-day
    # remainders aren't silently rounded down to zero and extended to 1 day)
    expires_in_days: int | None = None
    if old_key.expires_at is not None:
        import math
        from datetime import datetime, timezone
        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        remaining_secs = (old_key.expires_at - now_naive).total_seconds()
        expires_in_days = max(1, math.ceil(remaining_secs / 86400))

    # Create replacement FIRST — old key stays active if this fails, preventing lockout
    new_key_id, full_token = await auth_service.create_api_key(
        db,
        username=old_username,
        name=old_name,
        purpose=old_purpose,
        expires_in_days=expires_in_days,
    )

    # Revoke old key only after the new one is committed
    await auth_service.revoke_api_key(db, key_id)

    new_key = await db.get(APIKey, new_key_id)
    if new_key is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve newly created key",
        )
    return APIKeyCreateResponse(
        id=new_key.id,
        full_token=full_token,
        username=new_key.username,
        name=new_key.name,
        created_at=new_key.created_at,
        expires_at=new_key.expires_at,
    )


@router.delete("/admin/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_key(
    key_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
) -> None:
    revoked = await auth_service.revoke_api_key(db, key_id)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_KEY_NOT_FOUND)


@router.get("/admin/all-keys")
async def list_all_keys(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
) -> list[APIKeyResponse]:
    result = await db.execute(select(APIKey))
    keys = list(result.scalars().all())
    return [APIKeyResponse.model_validate(k) for k in keys]


@router.get("/admin/activities")
async def list_all_activities(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_admin)],
) -> list[ActivityLogResponse]:
    logs = await activity_service.get_activities(db)
    return [ActivityLogResponse.model_validate(lg) for lg in logs]


@router.post("/admin/verify")
async def verify_key(
    body: APIKeyVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(require_service_jwt)],
) -> APIKeyVerifyResponse:
    """Verify an API key token on behalf of the MCP server.

    Protected by a short-lived HS256 service JWT — not the normal session cookie.
    Returns the username and role associated with the key.
    """
    result = await auth_service.verify_api_key(db, body.token)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired API key",
        )
    key_id, username = result
    user = await users_service.get(db, username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User associated with this API key no longer exists",
        )
    return APIKeyVerifyResponse(username=username, role=user.role, key_id=key_id)
