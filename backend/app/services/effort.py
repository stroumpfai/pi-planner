from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.models.pbi import PBI
from app.models.sprint import Sprint
from app.models.swimline import Swimline


async def sprint_efforts_for_pi(db: AsyncSession, pi_id: str) -> dict[int, float]:
    """Return {sprint_index: effort} for all sprints in the PI."""
    result = await db.execute(
        select(
            Group.sprint_index,
            func.coalesce(func.sum(PBI.effort), 0).label("effort"),
        )
        .join(PBI, PBI.group_id == Group.system_id)
        .join(Swimline, Group.swimline_id == Swimline.system_id)
        .where(Swimline.pi_id == pi_id, PBI.effort.is_not(None))
        .group_by(Group.sprint_index)
    )
    return {
        row.sprint_index: float(row.effort)
        for row in result.all()
        if row.sprint_index is not None
    }


async def swimline_efforts(db: AsyncSession, swimline_ids: list[str]) -> dict[str, float]:
    """Return {swimline_id: effort} for the given swimlane IDs."""
    if not swimline_ids:
        return {}
    result = await db.execute(
        select(
            Group.swimline_id,
            func.coalesce(func.sum(PBI.effort), 0).label("effort"),
        )
        .join(PBI, PBI.group_id == Group.system_id)
        .where(Group.swimline_id.in_(swimline_ids), PBI.effort.is_not(None))
        .group_by(Group.swimline_id)
    )
    return {row.swimline_id: float(row.effort) for row in result.all()}


async def pi_effort_and_capacity(db: AsyncSession, pi_id: str) -> tuple[float, int]:
    """Return (total_effort, total_capacity) for a PI."""
    effort_result = await db.execute(
        select(func.coalesce(func.sum(PBI.effort), 0))
        .join(Group, PBI.group_id == Group.system_id)
        .join(Swimline, Group.swimline_id == Swimline.system_id)
        .where(Swimline.pi_id == pi_id, PBI.effort.is_not(None))
    )
    capacity_result = await db.execute(
        select(func.coalesce(func.sum(Sprint.capacity), 0))
        .where(Sprint.pi_id == pi_id)
    )
    return float(effort_result.scalar_one()), int(capacity_result.scalar_one())


async def feature_efforts(db: AsyncSession, feature_ids: list[str]) -> dict[str, float]:
    """Return {feature_system_id: effort} — sum of child PBI efforts."""
    if not feature_ids:
        return {}
    result = await db.execute(
        select(
            PBI.parent_feature_system_id,
            func.coalesce(func.sum(PBI.effort), 0).label("effort"),
        )
        .where(PBI.parent_feature_system_id.in_(feature_ids), PBI.effort.is_not(None))
        .group_by(PBI.parent_feature_system_id)
    )
    return {row.parent_feature_system_id: float(row.effort) for row in result.all()}


async def pi_capacity(db: AsyncSession, pi_id: str) -> int:
    """Return total sprint capacity for a PI."""
    result = await db.execute(
        select(func.coalesce(func.sum(Sprint.capacity), 0))
        .where(Sprint.pi_id == pi_id)
    )
    return int(result.scalar_one())
