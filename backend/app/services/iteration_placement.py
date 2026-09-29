"""Placing imported items on the PI board from their Azure DevOps Iteration Path.

A cell is matched against the ``iteration_path`` set on PIs and sprints — never
parsed for PI names, which differ from ADO's paths and which sprints do not have.
Only an exact match (after normalising) places anything; the rules are in
docs/csv-import-logic.md and docs/adr/0007.

Every function here writes through the session and leaves committing to the
caller, so the import's dry run rolls all of it back with everything else.
"""

import re
from typing import NamedTuple
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.services.continuation import lineage_members
from app.services.pbi_delete import detach_pbi_from_group

NEEDS_SWIMLANE = "Needs Swimlane"

_SEPARATORS = re.compile(r"[\\/]+")


def normalise_iteration_path(raw: str | None) -> str:
    """The comparable form of a path: ``planner\\pi 08`` for ``Planner / PI  08/``."""
    if not raw:
        return ""
    segments = (" ".join(s.split()) for s in _SEPARATORS.split(raw))
    return "\\".join(s for s in segments if s).casefold()


def sprint_label(sprint_index: int | None) -> str:
    return "no sprint" if sprint_index is None else f"Sprint {sprint_index + 1}"


class IterationTarget(NamedTuple):
    pi: PI
    sprint_index: int | None
    """None when the path names the PI itself rather than one of its sprints."""


class IterationIndex:
    def __init__(self, targets: dict[str, IterationTarget]) -> None:
        self._targets = targets

    def resolve(self, raw: str | None) -> IterationTarget | None:
        key = normalise_iteration_path(raw)
        return self._targets.get(key) if key else None

    @property
    def empty(self) -> bool:
        return not self._targets


async def load_iteration_index(db: AsyncSession, project_id: str) -> IterationIndex:
    pis = (await db.execute(select(PI).where(PI.project_id == project_id))).scalars().all()
    by_id = {pi.system_id: pi for pi in pis}
    targets: dict[str, IterationTarget] = {}
    for pi in pis:
        key = normalise_iteration_path(pi.iteration_path)
        if key:
            targets[key] = IterationTarget(pi, None)
    if by_id:
        sprints = (await db.execute(
            select(Sprint).where(Sprint.pi_id.in_(by_id), Sprint.iteration_path.is_not(None))
        )).scalars().all()
        for sprint in sprints:
            key = normalise_iteration_path(sprint.iteration_path)
            if key:
                targets[key] = IterationTarget(by_id[sprint.pi_id], sprint.sprint_index)
    return IterationIndex(targets)


async def iteration_path_taken(
    db: AsyncSession,
    project_id: str,
    path: str,
    *,
    exclude_pi_id: str | None = None,
    exclude_sprint_id: str | None = None,
) -> bool:
    """Whether another PI or sprint of the project already has this path.

    Uniqueness spans both kinds: a cell matching two places would identify neither.
    """
    key = normalise_iteration_path(path)
    if not key:
        return False
    pi_rows = (await db.execute(
        select(PI.system_id, PI.iteration_path).where(PI.project_id == project_id)
    )).all()
    if any(
        sid != exclude_pi_id and normalise_iteration_path(p) == key for sid, p in pi_rows
    ):
        return True
    sprint_paths = (await db.execute(
        select(Sprint.iteration_path).where(
            Sprint.pi_id.in_([sid for sid, _ in pi_rows]),
            Sprint.iteration_path.is_not(None),
            Sprint.system_id != (exclude_sprint_id or ""),
        )
    )).scalars().all()
    return any(normalise_iteration_path(p) == key for p in sprint_paths)


class Outcome(NamedTuple):
    action: str | None
    """"placed", "skipped", or None when the item is already where the path says."""
    detail: str | None = None


_UNCHANGED = Outcome(None)


def _placed(detail: str) -> Outcome:
    return Outcome("placed", detail)


def _skipped(detail: str) -> Outcome:
    return Outcome("skipped", detail)


async def _landing_swimline(db: AsyncSession, pi: PI, preferred_name: str | None) -> Swimline:
    """The swimlane a feature placed in ``pi`` lands in.

    The lane of the same name when there is one — swimlanes are usually teams, and
    the same teams recur PI after PI — else the PI's Needs Swimlane lane, created
    on first use. Found by name, so renaming it is how a planner claims it: the
    next import makes a fresh one.
    """
    for name in (preferred_name, NEEDS_SWIMLANE):
        if name is None:
            continue
        lane = (await db.execute(
            select(Swimline).where(Swimline.pi_id == pi.system_id, Swimline.name == name)
        )).scalar_one_or_none()
        if lane is not None:
            return lane

    last = (await db.execute(
        select(func.max(Swimline.order_index)).where(Swimline.pi_id == pi.system_id)
    )).scalar_one_or_none()
    lane = Swimline(
        system_id=str(uuid4()), pi_id=pi.system_id, name=NEEDS_SWIMLANE,
        order_index=(last or 0) + 1,
    )
    db.add(lane)
    await db.flush()
    return lane


async def _unplace_feature_stories(db: AsyncSession, feature: Feature) -> int:
    """Drop every group of ``feature``; returns how many stories leave a sprint.

    Mirrors moving a feature to the backlog. A sprint index names a column of one
    PI, so carrying groups into another PI would put stories in whichever sprint
    happens to share the number.
    """
    group_ids = list((await db.execute(
        select(Group.system_id).where(Group.feature_system_id == feature.system_id)
    )).scalars().all())
    if not group_ids:
        return 0
    moved = int((await db.execute(
        select(func.count()).select_from(PBI).where(PBI.group_id.in_(group_ids))
    )).scalar_one())
    await db.execute(
        update(PBI).where(PBI.group_id.in_(group_ids)).values(group_id=None, swimlane_id=None)
    )
    for gid in group_ids:
        group = await db.get(Group, gid)
        if group is not None:
            await db.delete(group)
    return moved


async def place_feature(db: AsyncSession, feature: Feature, target: IterationTarget) -> Outcome:
    pi = target.pi
    members = await lineage_members(db, feature)
    if len(members) > 1:
        if any(m.location == "pi" and m.pi_id == pi.system_id for m in members):
            return _UNCHANGED
        return _skipped(f"split across PIs, not moved to {pi.name} — a split is a board decision")

    on_board = feature.location == "pi" and feature.pi_id is not None
    if on_board and feature.pi_id == pi.system_id:
        return _UNCHANGED
    if pi.state == "closed":
        return _skipped(f"{pi.name} is closed")

    current_pi = await db.get(PI, feature.pi_id) if on_board and feature.pi_id else None
    if current_pi is not None and current_pi.state == "closed":
        return _skipped(f"stays in {current_pi.name}, which is closed")

    preferred: str | None = None
    unplaced = 0
    if current_pi is not None:
        current_lane = await db.get(Swimline, feature.swimlane_id) if feature.swimlane_id else None
        preferred = current_lane.name if current_lane else None
        unplaced = await _unplace_feature_stories(db, feature)

    lane = await _landing_swimline(db, pi, preferred)
    feature.location = "pi"
    feature.pi_id = pi.system_id
    feature.swimlane_id = lane.system_id

    where = f"{pi.name} · {lane.name}"
    detail = f"{current_pi.name} → {where}" if current_pi is not None else f"→ {where}"
    if unplaced:
        detail += (
            f"; {unplaced} {'story leaves its sprint' if unplaced == 1 else 'stories leave their sprints'}"
        )
    return _placed(detail)


async def place_story(db: AsyncSession, pbi: PBI, target: IterationTarget) -> Outcome:
    """Put ``pbi`` in the sprint its path names, within its feature's PI.

    A story follows its feature and never moves it. Stories in a named group stay
    put: the group is a planning decision the file knows nothing about.
    """
    pi = target.pi
    feature = await db.get(Feature, pbi.parent_feature_system_id)
    if feature is None or feature.location != "pi" or feature.pi_id is None:
        return _skipped(f"not placed in {pi.name} — its feature is in the backlog")
    if feature.pi_id != pi.system_id:
        feature_pi = await db.get(PI, feature.pi_id)
        name = feature_pi.name if feature_pi else "another PI"
        return _skipped(f"not placed in {pi.name} — its feature is in {name}")
    if feature.swimlane_id is None:
        return _skipped("its feature has no swimlane")

    group = await db.get(Group, pbi.group_id) if pbi.group_id else None
    current = group.sprint_index if group is not None else None
    if group is not None and current == target.sprint_index:
        return _UNCHANGED
    if group is None and target.sprint_index is None:
        return _UNCHANGED
    if pi.state == "closed":
        return _skipped(f"{pi.name} is closed")
    if group is not None and not group.is_implicit:
        return _skipped(
            f'stays in group "{group.name}" ({sprint_label(current)}) — named groups are left alone'
        )

    if target.sprint_index is None:
        await detach_pbi_from_group(db, pbi)
        pbi.swimlane_id = None
        return _placed(f"out of {sprint_label(current)}")

    if group is not None:
        group.sprint_index = target.sprint_index
        return _placed(f"{sprint_label(current)} → {sprint_label(target.sprint_index)}")

    new_group = Group(
        system_id=str(uuid4()),
        swimline_id=feature.swimlane_id,
        feature_system_id=feature.system_id,
        name=pbi.title,
        sprint_index=target.sprint_index,
        is_implicit=True,
        story_system_id=pbi.system_id,
    )
    db.add(new_group)
    await db.flush()
    pbi.group_id = new_group.system_id
    pbi.swimlane_id = feature.swimlane_id
    return _placed(f"→ {sprint_label(target.sprint_index)}")
