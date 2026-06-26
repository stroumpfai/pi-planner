from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.edit_lock import EditLock
from app.models.user import User
from app.schemas import EditLockResponse
from app.services.events import broadcaster

router = APIRouter(tags=["edit-lock"])


def _lock_response(lock: EditLock | None) -> EditLockResponse:
    if lock is None:
        return EditLockResponse(
            project_id="", locked_by_username=None, locked_at=None, expires_at=None, is_locked=False
        )
    now = datetime.now(timezone.utc)
    is_locked = bool(lock.expires_at and lock.expires_at.replace(tzinfo=timezone.utc) > now)
    return EditLockResponse(
        project_id=lock.project_id,
        locked_by_username=lock.locked_by_username if is_locked else None,
        locked_at=lock.locked_at,
        expires_at=lock.expires_at,
        is_locked=is_locked,
    )


async def _get_lock(db: AsyncSession, project_id: str) -> EditLock | None:
    result = await db.execute(select(EditLock).where(EditLock.project_id == project_id))
    return result.scalar_one_or_none()


@router.get("/api/v1/projects/{project_id}/edit-lock")
async def get_edit_lock(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> EditLockResponse:
    return _lock_response(await _get_lock(db, project_id))


@router.post("/api/v1/projects/{project_id}/edit-lock/acquire")
async def acquire_edit_lock(
    project_id: str,
    current_user: Annotated[User, Depends(require_editor_or_above)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> EditLockResponse:
    lock = await _get_lock(db, project_id)
    now = datetime.now(timezone.utc)

    if lock and lock.expires_at:
        expires = lock.expires_at.replace(tzinfo=timezone.utc)
        if expires > now and lock.locked_by_username != current_user.username:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Project already locked by {lock.locked_by_username}",
            )

    expiry = now + timedelta(minutes=settings.edit_lock_timeout_minutes)
    if lock:
        lock.locked_by_username = current_user.username
        lock.locked_at = now
        lock.expires_at = expiry
    else:
        lock = EditLock(
            project_id=project_id,
            locked_by_username=current_user.username,
            locked_at=now,
            expires_at=expiry,
        )
        db.add(lock)
    await db.commit()
    await db.refresh(lock)

    await broadcaster.broadcast(project_id, "edit-lock:acquired", {"locked_by": current_user.username})
    return _lock_response(lock)


@router.post("/api/v1/projects/{project_id}/edit-lock/release", status_code=status.HTTP_204_NO_CONTENT)
async def release_edit_lock(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    lock = await _get_lock(db, project_id)
    if lock and lock.locked_by_username == current_user.username:
        lock.expires_at = datetime.now(timezone.utc)  # expire immediately
        await db.commit()
        await broadcaster.broadcast(project_id, "edit-lock:released", {"released_by": current_user.username})


@router.post("/api/v1/projects/{project_id}/edit-lock/keepalive")
async def keepalive_edit_lock(
    project_id: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> EditLockResponse:
    lock = await _get_lock(db, project_id)
    if not lock or lock.locked_by_username != current_user.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not hold this lock")

    lock.expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.edit_lock_timeout_minutes)
    await db.commit()
    await db.refresh(lock)
    return _lock_response(lock)
