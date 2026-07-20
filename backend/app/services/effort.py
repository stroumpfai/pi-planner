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


async def sprint_swimline_efforts(
    db: AsyncSession, pi_id: str
) -> dict[tuple[int, str], float]:
    """Return {(sprint_index, swimline_id): effort} for all placed PBIs in the PI.

    The 2-D grid backing the capacity-vs-load heatmap: effort summed per
    (sprint, swimlane) cell. Mirrors ``sprint_efforts_for_pi`` but groups by both
    axes.
    """
    result = await db.execute(
        select(
            Group.sprint_index,
            Group.swimline_id,
            func.coalesce(func.sum(PBI.effort), 0).label("effort"),
        )
        .join(PBI, PBI.group_id == Group.system_id)
        .join(Swimline, Group.swimline_id == Swimline.system_id)
        .where(Swimline.pi_id == pi_id, PBI.effort.is_not(None))
        .group_by(Group.sprint_index, Group.swimline_id)
    )
    return {
        (row.sprint_index, row.swimline_id): float(row.effort)
        for row in result.all()
        if row.sprint_index is not None
    }


async def sprint_swimline_item_counts(
    db: AsyncSession, pi_id: str
) -> dict[tuple[int, str], tuple[int, int]]:
    """Return {(sprint_index, swimline_id): (pbi_count, bug_count)} for placed items.

    The 2-D grid backing the backlog-composition export: counts of story-type
    ("PBI") and bug-type items placed in each (sprint, swimlane) cell. Unlike the
    effort aggregations, items are counted regardless of whether they carry an
    estimate.
    """
    result = await db.execute(
        select(
            Group.sprint_index,
            Group.swimline_id,
            PBI.item_type,
            func.count().label("n"),
        )
        .join(PBI, PBI.group_id == Group.system_id)
        .join(Swimline, Group.swimline_id == Swimline.system_id)
        .where(Swimline.pi_id == pi_id)
        .group_by(Group.sprint_index, Group.swimline_id, PBI.item_type)
    )
    counts: dict[tuple[int, str], tuple[int, int]] = {}
    for row in result.all():
        if row.sprint_index is None:
            continue
        key = (row.sprint_index, row.swimline_id)
        pbi, bug = counts.get(key, (0, 0))
        if row.item_type == "bug":
            counts[key] = (pbi, bug + int(row.n))
        else:
            counts[key] = (pbi + int(row.n), bug)
    return counts


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
    return float(effort_result.scalar_one() or 0), int(capacity_result.scalar_one() or 0)


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


def sprint_utilization(effort: float, capacity: int) -> tuple[float, str]:
    """Classify a sprint's load against its capacity.

    Returns (ratio, status) where status is one of:
      "no_capacity" — capacity is 0/unset
      "over"        — load exceeds capacity (ratio > 1.0)
      "warn"        — load is at/above 85% of capacity
      "ok"          — load is comfortably within capacity

    Single source of truth for the capacity thresholds shared by the PNG export
    and the reports so their colour/severity classification stays identical.
    """
    if capacity <= 0:
        return (0.0, "no_capacity")
    ratio = effort / capacity
    if ratio > 1.0:
        return (ratio, "over")
    if ratio >= 0.85:
        return (ratio, "warn")
    return (ratio, "ok")
