"""Who a project's capacity comes from, and how much of each of them it gets.

spec/teams.md §6.3, ADR 0009 (scopes) and ADR 0010 (shares in days, and per
member).

An assignment counts either **the whole team** (``all_members``, the default) or
**only the members listed** in ``team_project_members``. That is how one team
models a few people who work only on project X while everyone else covers the
rest: X counts {those people} at 100%, every other project counts {everyone
else} at its share.

Each counted member then gives the project a **share**: the assignment's own, or
one of their own from their ``team_project_members`` row. A share is a
percentage or **days a week** — "Anna, 2 days a week on X" — and days are a
fraction of the member's own contract, taken per pattern version by the engine
(:func:`app.services.team_capacity.shared_person_days`).

Every consumer asks through :func:`share_for` — the Capacity view's project rows,
the push and its preview, staleness, and the per-member load that drives the
over-allocation warning — so they cannot disagree about whose PD a project gets.

SQLite runs here without ``PRAGMA foreign_keys``, so the join rows have to be
deleted by hand wherever a member or an assignment goes: :func:`forget_members`
and :func:`forget_assignments` are those two places.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import TeamMember, TeamProject, TeamProjectMember
from app.schemas.team import MemberLoad, MemberShare
from app.services.team_capacity import (
    Member,
    MemberCapacity,
    Share,
    pattern_version_from_row,
    resolve_version,
    shared_person_days,
)


@dataclass(frozen=True)
class Scope:
    """Who an assignment counts, and which of them have a share of their own.

    ``member_ids`` is every listed member of a scoped assignment — the ones it
    counts. On one counting everyone it is empty, and members appear only in
    ``overrides``.
    """

    all_members: bool
    member_ids: frozenset[str]
    overrides: Mapping[str, Share] = field(default_factory=dict)

    def counts_for(self, member_id: str) -> bool:
        return self.all_members or member_id in self.member_ids


EVERYONE = Scope(all_members=True, member_ids=frozenset())


def assignment_share(assignment: TeamProject) -> Share:
    """The assignment's own share: days a week when entered that way (§6.3.2)."""
    if assignment.share_days is not None:
        return Share(days=assignment.share_days)
    return Share(pct=assignment.share_pct)


def share_for(assignment: TeamProject, scope: Scope, member_id: str) -> Share | None:
    """What part of *member_id* the project gets, or None when it does not count them."""
    if not scope.counts_for(member_id):
        return None
    return scope.overrides.get(member_id) or assignment_share(assignment)


def is_uniform_pct(assignment: TeamProject, scope: Scope) -> bool:
    """True when every counted member gives the same percentage.

    Then the project's PD is the counted members' PD × share, the arithmetic
    there was before shares could vary — kept as the path for that case so its
    numbers do not move by a float's last digit.
    """
    return assignment.share_days is None and not scope.overrides


def project_person_days(
    assignment: TeamProject,
    scope: Scope,
    members: Sequence[Member],
    capacities: Mapping[str, MemberCapacity],
    normal_day_hours: float,
) -> float:
    """The PD a project gets over one window: Σ of each counted member's share.

    *capacities* holds that window's figures by member id. Members who count
    towards no capacity at all (§3.2) give nothing, whatever their share.
    """
    total = 0.0
    for member in members:
        if not member.counts_towards_capacity:
            continue
        share = share_for(assignment, scope, member.member_id)
        capacity = capacities.get(member.member_id)
        if share is None or capacity is None:
            continue
        total += shared_person_days(member, capacity, share, normal_day_hours)
    return total


async def load_scopes(
    db: AsyncSession, assignments: Iterable[TeamProject]
) -> dict[str, Scope]:
    """Each assignment's scope, keyed by its ``system_id``, in one query."""
    rows = list(assignments)
    listed: dict[str, set[str]] = {a.system_id: set() for a in rows}
    overrides: dict[str, dict[str, Share]] = {a.system_id: {} for a in rows}
    if rows:
        result = await db.execute(
            select(TeamProjectMember).where(TeamProjectMember.team_project_id.in_(list(listed)))
        )
        for row in result.scalars().all():
            listed[row.team_project_id].add(row.member_id)
            if row.share_days is not None:
                overrides[row.team_project_id][row.member_id] = Share(days=row.share_days)
            elif row.share_pct is not None:
                overrides[row.team_project_id][row.member_id] = Share(pct=row.share_pct)
    return {
        a.system_id: Scope(
            all_members=a.all_members,
            member_ids=frozenset() if a.all_members else frozenset(listed[a.system_id]),
            overrides=overrides[a.system_id],
        )
        for a in rows
    }


async def load_scope(db: AsyncSession, assignment: TeamProject) -> Scope:
    return (await load_scopes(db, [assignment]))[assignment.system_id]


def member_shares_response(scope: Scope, member_order: Sequence[str]) -> list[MemberShare]:
    """The overrides as the API returns them, in the team's display order."""
    return [
        MemberShare(
            member_id=member_id,
            share_pct=scope.overrides[member_id].pct,
            share_days=scope.overrides[member_id].days,
        )
        for member_id in member_order
        if member_id in scope.overrides
    ]


async def check_scope(
    db: AsyncSession,
    team_id: str,
    all_members: bool,
    member_ids: Sequence[str],
    member_shares: Sequence[MemberShare] = (),
) -> None:
    """Refuse a scope before anything is written.

    Every listed id must be a member of the team — a 422 naming the strangers
    otherwise, never a silent drop: a scope that quietly lost someone would
    understate a project with nothing to say why.
    """
    if all_members and member_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "SCOPE_CONFLICT",
                "message": "Either count all members or list some — not both.",
            },
        )
    shared = [share.member_id for share in member_shares]
    if len(shared) != len(set(shared)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "DUPLICATE_MEMBER_SHARE",
                "message": "A member can have only one share of their own per project.",
            },
        )
    wanted = set(member_ids) | set(shared)
    if wanted:
        known = set(
            (
                await db.execute(
                    select(TeamMember.system_id).where(
                        TeamMember.team_id == team_id,
                        TeamMember.system_id.in_(wanted),
                    )
                )
            ).scalars().all()
        )
        strangers = sorted(wanted - known)
        if strangers:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": "UNKNOWN_MEMBER",
                    "message": "Only members of this team can count for its projects.",
                    "member_ids": strangers,
                },
            )


async def set_scope(
    db: AsyncSession,
    assignment: TeamProject,
    all_members: bool,
    member_ids: Sequence[str],
    member_shares: Sequence[MemberShare] = (),
) -> None:
    """Replace the assignment's scope and member shares, validated first.

    A member with a share of their own is listed — and so counted — even when a
    scoped assignment's ``member_ids`` leaves them out: giving someone a share
    in a project is saying they work on it. The caller commits.
    """
    await check_scope(db, assignment.team_id, all_members, member_ids, member_shares)
    overrides = {share.member_id: share for share in member_shares}
    listed = set(overrides) if all_members else set(member_ids) | set(overrides)

    assignment.all_members = all_members
    await db.execute(
        delete(TeamProjectMember).where(TeamProjectMember.team_project_id == assignment.system_id)
    )
    for member_id in sorted(listed):
        own = overrides.get(member_id)
        db.add(
            TeamProjectMember(
                team_project_id=assignment.system_id,
                member_id=member_id,
                share_pct=own.share_pct if own else None,
                share_days=own.share_days if own else None,
            )
        )


async def forget_members(db: AsyncSession, member_ids: Sequence[str]) -> None:
    """Drop deleted members from every scope.

    An assignment left with nobody listed stays scoped, and counts zero. That is
    the point of ``all_members`` being a flag (ADR 0009).
    """
    if member_ids:
        await db.execute(
            delete(TeamProjectMember).where(TeamProjectMember.member_id.in_(member_ids))
        )


async def forget_assignments(db: AsyncSession, assignment_ids: Sequence[str]) -> None:
    if assignment_ids:
        await db.execute(
            delete(TeamProjectMember).where(TeamProjectMember.team_project_id.in_(assignment_ids))
        )


def contracted_days_on(member: TeamMember, day: date) -> float:
    """The days a week *member*'s contract owes on *day*.

    Before the first version starts the first one holds, as in the engine: the
    earliest version extends backwards (§3.3). Needs ``pattern_versions`` loaded.
    """
    versions = sorted(member.pattern_versions, key=lambda v: v.effective_from)
    if not versions:
        return 0.0
    return pattern_version_from_row(resolve_version(versions, day)).contracted_days


def member_loads(
    members: Sequence[TeamMember],
    assignments: Sequence[TeamProject],
    scopes: dict[str, Scope],
    today: date,
) -> list[MemberLoad]:
    """Each member's load over the projects that count them, in member order.

    This is what "over-allocated" means once a share can be per member and in
    days (§6.3.3): Anna on X for 2 days and on Y at 60% is 2 + 3 = 5 of her 5
    days, 100%. Days convert against the contract in force *today*, so the load
    describes the week being planned now. Only members whose capacity is spent
    anywhere are listed — not those tracked for absences only (§3.2), and not
    those whose membership has already ended. ``pattern_versions`` must be loaded.
    """
    loads: list[MemberLoad] = []
    for member in members:
        if not member.counts_towards_capacity:
            continue
        if member.active_to is not None and member.active_to < today:
            continue
        contracted = contracted_days_on(member, today)
        days = _booked_days(member.system_id, contracted, assignments, scopes)
        loads.append(
            MemberLoad(
                member_id=member.system_id,
                name=member.name,
                share_pct=round(_load_pct(days, contracted), 1),
                days_per_week=round(days, 2),
                contracted_days=contracted,
            )
        )
    return loads


def _booked_days(
    member_id: str,
    contracted: float,
    assignments: Sequence[TeamProject],
    scopes: dict[str, Scope],
) -> float:
    """Σ over the projects counting the member, each share expressed in days."""
    days = 0.0
    for assignment in assignments:
        share = share_for(assignment, scopes[assignment.system_id], member_id)
        if share is None:
            continue
        days += share.days if share.days is not None else contracted * (share.pct or 0) / 100
    return days


def _load_pct(days: float, contracted: float) -> float:
    if contracted > 0:
        return days / contracted * 100
    # Nothing contracted: any booking at all is more than they have.
    return 0.0 if days == 0 else 100.0 + days * 100
