from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_log import ActivityLog, ActorType


async def log_activity(
    db: AsyncSession,
    *,
    actor_type: ActorType,
    actor_username: str,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    project_id: str | None = None,
    details: dict | None = None,
    api_key_id: str | None = None,
    status: str = "success",
) -> None:
    """Write an activity log entry to the database."""
    db.add(
        ActivityLog(
            actor_type=actor_type,
            actor_username=actor_username,
            api_key_id=api_key_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            project_id=project_id,
            details=details,
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
            status=status,
        )
    )
    await db.commit()


async def get_activities(
    db: AsyncSession,
    *,
    username: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[ActivityLog]:
    """Return activity log entries, newest first.

    If *username* is provided, only return entries for that actor.
    """
    stmt = select(ActivityLog).order_by(ActivityLog.timestamp.desc())
    if username is not None:
        stmt = stmt.where(ActivityLog.actor_username == username)
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    return list(result.scalars().all())
