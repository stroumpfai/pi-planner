"""Computing what a push would write, and writing it (spec/teams.md §6.6, §6.7).

Three properties this module exists to hold, each of which has a wrong-looking
alternative that would seem simpler:

**The calendar is the project's own, not the anchor's.** The Capacity *view*
counts in the anchor project's sprints (§7.0.1) because a team needs one column
set to read down. A push writes into rows that belong to the project being
pushed, so it computes over *those* dates. The two agree whenever alignment holds
(§6.8), which is exactly what alignment is enforced for — but the push must not
depend on that agreement to write the right row.

**Rounding happens here, once, half-up, per sprint.** Nothing upstream rounds and
nothing downstream re-rounds, so ``total_available`` is the sum of the stored
integers rather than the rounded sum of the floats. Across five sprints the two
can differ by up to 2.5, and the board must agree with itself.

**Staleness compares values, not an input hash.** A project is stale only if some
sprint would actually change. A fingerprint of the inputs would flag an absence
added and removed again, or a meeting moved inside its half-day — and a badge
people learn to ignore is worse than no badge.
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.edit_lock import EditLock
from app.models.pi import PI
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.team import Team, TeamProject
from app.schemas.team_push import (
    PUSHABLE_PI_STATES,
    ProjectPushResult,
    ProjectPushStatus,
    PushPreview,
    PushSprintRow,
)
from app.services.absences import build_lookup, load_absences
from app.services.meetings import build_lookup as build_meeting_lookup
from app.services.meetings import load_meetings
from app.services.team_capacity import (
    AbsenceLookup,
    MeetingLookup,
    compute_team_capacity,
    no_absences,
    no_meetings,
    round_half_up,
)
from app.services.team_capacity_report import load_members

# A PI with no start date sorts after every dated one, as it does in the Capacity
# view: an undated PI is unplaced, not early.
_UNDATED = date.max


@dataclass(frozen=True)
class PushContext:
    """The three rows a push needs before it can compute anything."""

    assignment: TeamProject
    team: Team
    project: Project

    @property
    def is_manual(self) -> bool:
        return self.assignment.available_source == "manual"


async def load_context(db: AsyncSession, project_id: str) -> PushContext | None:
    """The team serving *project_id*, or None when no team does.

    A project is served by at most one team (§6.1), so this is a lookup and not
    a list.
    """
    result = await db.execute(
        select(TeamProject, Team, Project)
        .join(Team, Team.system_id == TeamProject.team_id)
        .join(Project, Project.system_id == TeamProject.project_id)
        .where(TeamProject.project_id == project_id)
    )
    row = result.first()
    if row is None:
        return None
    assignment, team, project = row
    return PushContext(assignment=assignment, team=team, project=project)


async def _pushable_sprints(
    db: AsyncSession,
    project_id: str,
    window_from: date | None,
    window_to: date | None,
) -> list[tuple[Sprint, PI]]:
    """This project's sprints that a push may write, in time order.

    Closed PIs are filtered out in the query rather than skipped in the loop, so
    they never reach the preview either: a review table listing rows that cannot
    change would invite someone to wonder why they did not.
    """
    result = await db.execute(
        select(Sprint, PI)
        .join(PI, PI.system_id == Sprint.pi_id)
        .where(PI.project_id == project_id, PI.state.in_(PUSHABLE_PI_STATES))
    )
    rows = [
        (sprint, pi)
        for sprint, pi in result.all()
        if _inside_window(sprint, window_from, window_to)
    ]
    rows.sort(
        key=lambda pair: (
            pair[1].start_date or _UNDATED,
            pair[1].name,
            pair[0].sprint_index if pair[0].sprint_index is not None else 0,
        )
    )
    return rows


def _inside_window(sprint: Sprint, window_from: date | None, window_to: date | None) -> bool:
    """Undated sprints survive an absent window and drop out of a present one.

    A sprint with no dates is part of the calendar and reads "—"; once a window
    is asked for it cannot be said to fall inside one.
    """
    if sprint.start_date is None or sprint.end_date is None:
        return window_from is None and window_to is None
    if window_to is not None and sprint.start_date > window_to:
        return False
    if window_from is not None and sprint.end_date < window_from:
        return False
    return True


async def compute_rows(
    db: AsyncSession,
    context: PushContext,
    window_from: date | None = None,
    window_to: date | None = None,
) -> list[PushSprintRow]:
    """One review row per pushable sprint. Reads only; writes nothing.

    A `manual` project computes rows all the same — the Capacity view shows team
    PD beside a hand-typed budget as a reference (§6.4) — but every proposal is
    null, because nothing is meant to flow into it. The 409 that refuses the push
    is the route's, not this function's.
    """
    sprints = await _pushable_sprints(db, context.project.system_id, window_from, window_to)
    members = [member for _, member in await load_members(db, context.team.system_id)]

    # Absences and meetings are expanded once over the whole span the sprints
    # cover, not per sprint: the lookups are the engine's seams, and rebuilding
    # them five times would expand every open-ended recurrence five times.
    absent: AbsenceLookup = no_absences
    booked: MeetingLookup = no_meetings
    dated = [s for s, _ in sprints if s.start_date is not None and s.end_date is not None]
    if dated:
        span_start = min(s.start_date for s in dated if s.start_date is not None)
        span_end = max(s.end_date for s in dated if s.end_date is not None)
        absent = build_lookup(await load_absences(db, context.team.system_id), span_start, span_end)
        booked = build_meeting_lookup(
            await load_meetings(db, context.team.system_id), span_start, span_end
        )

    share = context.assignment.share_pct / 100
    rows: list[PushSprintRow] = []
    for sprint, pi in sprints:
        number = (sprint.sprint_index if sprint.sprint_index is not None else 0) + 1
        computable = sprint.start_date is not None and sprint.end_date is not None
        team_pd: float | None = None
        share_pd: float | None = None
        units: float | None = None
        proposed: int | None = None
        if computable and not context.is_manual:
            assert sprint.start_date is not None and sprint.end_date is not None
            capacity = compute_team_capacity(
                members,
                context.team.normal_day_hours,
                sprint.start_date,
                sprint.end_date,
                absent=absent,
                meetings=booked,
            )
            team_pd = capacity.person_days
            share_pd = team_pd * share
            units = share_pd * context.assignment.units_per_pd
            proposed = round_half_up(units)
        rows.append(
            PushSprintRow(
                sprint_id=sprint.system_id,
                pi_id=pi.system_id,
                pi_name=pi.name,
                pi_state=pi.state,
                sprint_number=number,
                label=f"{pi.name}.{number}",
                start_date=sprint.start_date,
                end_date=sprint.end_date,
                current_available=sprint.available,
                proposed_available=proposed,
                delta=None if proposed is None else proposed - sprint.available,
                team_person_days=team_pd,
                share_adjusted_person_days=share_pd,
                in_project_units=units,
                available_pushed_at=sprint.available_pushed_at,
            )
        )
    return rows


def changed(rows: list[PushSprintRow]) -> list[PushSprintRow]:
    """The rows a push would actually write — the ones whose integer moves."""
    return [row for row in rows if row.delta not in (None, 0)]


def build_preview(context: PushContext, rows: list[PushSprintRow]) -> PushPreview:
    moved = changed(rows)
    return PushPreview(
        project_id=context.project.system_id,
        project_name=context.project.name,
        effort_unit=context.project.effort_unit,
        team_id=context.team.system_id,
        team_name=context.team.name,
        share_pct=context.assignment.share_pct,
        available_source=context.assignment.available_source,
        units_per_pd=context.assignment.units_per_pd,
        sprints=rows,
        changed_count=len(moved),
        total_delta=sum(row.delta or 0 for row in moved),
    )


async def apply_rows(
    db: AsyncSession, rows: list[PushSprintRow]
) -> tuple[int, int]:
    """Write the moved rows and stamp them. Returns (sprints written, Σ delta).

    **Idempotent**: with nothing changed this writes nothing at all — not even a
    fresh ``available_pushed_at``. A timestamp that moved on a no-op push would
    make "last pushed" mean "last time somebody clicked", which is not the
    question the sprint header is answering.
    """
    moved = changed(rows)
    if not moved:
        return 0, 0
    now = datetime.now(timezone.utc)
    for row in moved:
        sprint = await db.get(Sprint, row.sprint_id)
        if sprint is None:  # pragma: no cover - deleted between preview and apply
            continue
        assert row.proposed_available is not None
        sprint.available = row.proposed_available
        sprint.available_pushed_at = now
        sprint.modified_at = now
    await db.commit()
    return len(moved), sum(row.delta or 0 for row in moved)


async def blocking_lock(
    db: AsyncSession, project_id: str, username: str
) -> EditLock | None:
    """The unexpired lock held by *someone else* on this project, if any.

    The same rule ``require_edit_lock`` applies, but returned rather than raised:
    a multi-project push reports a locked project as one failed row and carries
    on with the others (§6.7).
    """
    lock = (
        await db.execute(select(EditLock).where(EditLock.project_id == project_id))
    ).scalar_one_or_none()
    expires_at = lock.expires_at if lock is not None else None
    if lock is None or expires_at is None:
        return None
    expires = expires_at.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        return None
    if lock.locked_by_username == username:
        return None
    return lock


async def push_one(
    db: AsyncSession,
    context: PushContext,
    username: str,
    window_from: date | None = None,
    window_to: date | None = None,
) -> ProjectPushResult:
    """Push into one project, reporting rather than raising.

    Every outcome a caller can act on is a status string, because the
    multi-project push renders them side by side: one project locked, one
    unchanged and one updated is the *normal* result, not an error case.
    """
    project_id = context.project.system_id
    if context.is_manual:
        return ProjectPushResult(
            project_id=project_id,
            project_name=context.project.name,
            status="manual",
            updated_sprints=0,
            total_delta=0,
            message="Available is typed by hand for this project — nothing was written.",
        )
    lock = await blocking_lock(db, project_id, username)
    if lock is not None:
        return ProjectPushResult(
            project_id=project_id,
            project_name=context.project.name,
            status="locked",
            updated_sprints=0,
            total_delta=0,
            message=f"Locked by {lock.locked_by_username}",
            locked_by=lock.locked_by_username,
            locked_until=lock.expires_at.replace(tzinfo=timezone.utc)
            if lock.expires_at
            else None,
        )

    rows = await compute_rows(db, context, window_from=window_from, window_to=window_to)
    written, delta = await apply_rows(db, rows)
    return ProjectPushResult(
        project_id=project_id,
        project_name=context.project.name,
        status="updated" if written else "no_change",
        updated_sprints=written,
        total_delta=delta,
    )


async def status_for(db: AsyncSession, project_id: str | None = None) -> list[ProjectPushStatus]:
    """Staleness for every served project, or for one of them.

    Computed on read, which is affordable because it is a handful of sprints per
    PI, and because a stale count that lags is worse than none at all — the whole
    point of the badge is that it is true right now.
    """
    query = select(TeamProject, Team, Project).join(
        Team, Team.system_id == TeamProject.team_id
    ).join(Project, Project.system_id == TeamProject.project_id)
    if project_id is not None:
        query = query.where(TeamProject.project_id == project_id)
    result = await db.execute(query)

    statuses: list[ProjectPushStatus] = []
    for assignment, team, project in result.all():
        context = PushContext(assignment=assignment, team=team, project=project)
        rows = [] if context.is_manual else await compute_rows(db, context)
        pushed = [row.available_pushed_at for row in rows if row.available_pushed_at]
        statuses.append(
            ProjectPushStatus(
                project_id=project.system_id,
                project_name=project.name,
                team_id=team.system_id,
                team_name=team.name,
                share_pct=assignment.share_pct,
                available_source=assignment.available_source,
                stale_sprints=len(changed(rows)),
                last_pushed_at=max(pushed) if pushed else None,
            )
        )
    return statuses
