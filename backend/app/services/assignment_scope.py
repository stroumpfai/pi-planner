"""Which members' capacity reaches a project (spec/teams.md §6.3, ADR 0009).

An assignment counts either **the whole team** (``all_members``, the default) or
**only the members listed** in ``team_project_members``. That is how one team
models a few people who work only on project X while everyone else covers the
rest: X counts {those people} at 100%, every other project counts {everyone
else} at its share.

Every consumer asks the same question through :func:`counts_for` — the Capacity
view's project rows, the push and its preview, staleness, and the per-member load
that drives the over-allocation warning — so they cannot disagree about who a
project's PD comes from.

SQLite runs here without ``PRAGMA foreign_keys``, so the join rows have to be
deleted by hand wherever a member or an assignment goes: :func:`forget_members`
and :func:`forget_assignments` are those two places.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import TeamMember, TeamProject, TeamProjectMember
from app.schemas.team import MemberLoad


@dataclass(frozen=True)
class Scope:
    """Who an assignment counts: everyone, or exactly ``member_ids``."""

    all_members: bool
    member_ids: frozenset[str]

    def counts_for(self, member_id: str) -> bool:
        return self.all_members or member_id in self.member_ids


EVERYONE = Scope(all_members=True, member_ids=frozenset())


async def load_scopes(
    db: AsyncSession, assignments: Iterable[TeamProject]
) -> dict[str, Scope]:
    """Each assignment's scope, keyed by its ``system_id``, in one query."""
    rows = list(assignments)
    scoped = [a.system_id for a in rows if not a.all_members]
    listed: dict[str, set[str]] = {assignment_id: set() for assignment_id in scoped}
    if scoped:
        result = await db.execute(
            select(TeamProjectMember.team_project_id, TeamProjectMember.member_id).where(
                TeamProjectMember.team_project_id.in_(scoped)
            )
        )
        for assignment_id, member_id in result.all():
            listed[assignment_id].add(member_id)
    return {
        a.system_id: EVERYONE
        if a.all_members
        else Scope(all_members=False, member_ids=frozenset(listed[a.system_id]))
        for a in rows
    }


async def load_scope(db: AsyncSession, assignment: TeamProject) -> Scope:
    return (await load_scopes(db, [assignment]))[assignment.system_id]


async def check_scope(
    db: AsyncSession, team_id: str, all_members: bool, member_ids: Sequence[str]
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
    wanted = set(member_ids)
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
) -> None:
    """Replace the assignment's scope, validated first. The caller commits."""
    await check_scope(db, assignment.team_id, all_members, member_ids)
    wanted = set(member_ids)
    assignment.all_members = all_members
    await db.execute(
        delete(TeamProjectMember).where(TeamProjectMember.team_project_id == assignment.system_id)
    )
    for member_id in sorted(wanted):
        db.add(TeamProjectMember(team_project_id=assignment.system_id, member_id=member_id))


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


def member_loads(
    members: Sequence[TeamMember],
    assignments: Sequence[TeamProject],
    scopes: dict[str, Scope],
    today: date,
) -> list[MemberLoad]:
    """Σ ``share_pct`` over the projects each member counts for, in member order.

    This is what "over-allocated" means once assignments have scopes: a team's
    shares summed is no longer anyone's load when X counts two people and the
    rest count the others. Only members whose capacity is spent anywhere are
    listed — not those tracked for absences only (§3.2), and not those whose
    membership has already ended.
    """
    loads: list[MemberLoad] = []
    for member in members:
        if not member.counts_towards_capacity:
            continue
        if member.active_to is not None and member.active_to < today:
            continue
        total = sum(
            a.share_pct for a in assignments if scopes[a.system_id].counts_for(member.system_id)
        )
        loads.append(MemberLoad(member_id=member.system_id, name=member.name, share_pct=total))
    return loads
