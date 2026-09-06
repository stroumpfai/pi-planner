"""Loading the rows the capacity maths needs, and assembling what a view reads.

The split is deliberate and load-bearing: `team_capacity.py` is pure arithmetic
over plain data with no session in sight, and everything that touches the
database lives here. That is what lets the formula be tested against a
hand-computed fixture without fixtures, and what will let step 7's push reuse the
identical numbers rather than a second implementation of them.

**The sprint calendar comes from the team's anchor project** — the first project
assigned, which already defines the calendar every other project must align to
(§6.8). A team with no project has no calendar, and the report says so with an
empty column list rather than inventing months (§7.0.1).
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pi import PI
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.team import Team, TeamMember, TeamProject
from app.schemas.team_capacity import (
    CapacityBreakdown,
    CapacitySprint,
    MemberCapacityRow,
    ProjectCapacityRow,
    TeamCapacityResponse,
)
from app.services.absences import build_lookup, load_absences
from app.services.meetings import build_lookup as build_meeting_lookup
from app.services.meetings import load_meetings
from app.services.team_capacity import (
    AbsenceLookup,
    MeetingLookup,
    Member,
    MemberCapacity,
    compute_member_capacity,
    no_absences,
    no_meetings,
    pattern_version_from_row,
    round_half_up,
)

# A PI with no start date sorts after every dated one rather than before: an
# undated PI is unplaced, and putting it first would push the sprints people are
# actually looking at off the right-hand edge.
_UNDATED = date.max


async def load_members(db: AsyncSession, team_id: str) -> list[tuple[TeamMember, Member]]:
    """The team's members as rows *and* as the maths sees them, in display order.

    Both are returned because the report needs the name from one and the numbers
    from the other, and loading twice to keep the layers apart would cost a query
    to save an import.
    """
    result = await db.execute(
        select(TeamMember)
        .where(TeamMember.team_id == team_id)
        .options(selectinload(TeamMember.pattern_versions))
        .order_by(TeamMember.order_index.asc(), TeamMember.created_at.asc())
    )
    members = list(result.scalars().all())
    return [
        (
            row,
            Member(
                member_id=row.system_id,
                versions=tuple(
                    pattern_version_from_row(version)
                    for version in sorted(row.pattern_versions, key=lambda v: v.effective_from)
                ),
                active_from=row.active_from,
                active_to=row.active_to,
            ),
        )
        for row in members
    ]


async def load_assignments(db: AsyncSession, team_id: str) -> list[tuple[TeamProject, Project]]:
    """This team's projects, **anchor first** — the earliest assignment (§6.8)."""
    result = await db.execute(
        select(TeamProject, Project)
        .join(Project, Project.system_id == TeamProject.project_id)
        .where(TeamProject.team_id == team_id)
        .order_by(TeamProject.created_at.asc())
    )
    return [(assignment, project) for assignment, project in result.all()]


async def load_sprint_columns(
    db: AsyncSession,
    project_id: str,
    window_from: date | None = None,
    window_to: date | None = None,
) -> list[CapacitySprint]:
    """The anchor project's sprints, in time order, as the view's columns.

    An **undated sprint keeps its column** when no window is asked for: it is part
    of the calendar and reads "—", which is different from not being there. Once a
    window is given it drops out, because a sprint with no dates cannot be said to
    fall inside one.
    """
    result = await db.execute(
        select(Sprint, PI)
        .join(PI, PI.system_id == Sprint.pi_id)
        .where(PI.project_id == project_id)
    )
    rows = list(result.all())
    rows.sort(
        key=lambda pair: (
            pair[1].start_date or _UNDATED,
            pair[1].name,
            pair[0].sprint_index if pair[0].sprint_index is not None else 0,
        )
    )

    columns: list[CapacitySprint] = []
    for sprint, pi in rows:
        computable = sprint.start_date is not None and sprint.end_date is not None
        if (window_from or window_to) and not computable:
            continue
        if computable:
            assert sprint.start_date is not None and sprint.end_date is not None
            if window_to is not None and sprint.start_date > window_to:
                continue
            if window_from is not None and sprint.end_date < window_from:
                continue
        number = (sprint.sprint_index if sprint.sprint_index is not None else 0) + 1
        columns.append(
            CapacitySprint(
                sprint_id=sprint.system_id,
                pi_id=pi.system_id,
                pi_name=pi.name,
                pi_state=pi.state,
                sprint_number=number,
                label=f"{pi.name}.{number}",
                start_date=sprint.start_date,
                end_date=sprint.end_date,
                computable=computable,
                available=sprint.available,
            )
        )
    return columns


def _breakdown(capacity: MemberCapacity) -> CapacityBreakdown:
    return CapacityBreakdown(
        contracted_half_days=capacity.contracted_half_days,
        contracted_hours=capacity.contracted_hours,
        absent_half_days=capacity.absent_half_days,
        hours_after_absences=capacity.hours_after_absences,
        meeting_hours=capacity.meeting_hours,
        hours_after_meetings=capacity.hours_after_meetings,
        net_hours=capacity.net_hours,
        person_days=capacity.person_days,
        present_days=capacity.present_days,
    )


def _totalled(cells: list[CapacityBreakdown]) -> CapacityBreakdown:
    """Team totals: every step summed, so an expanded team cell traces too.

    ``team_PD`` is summed rather than recomputed from ``team_hours``. The two are
    the same number — the divisor is shared (§5.2) — and summing keeps the row
    consistent with the members above it to the last decimal.
    """
    return CapacityBreakdown(
        contracted_half_days=sum(c.contracted_half_days for c in cells),
        contracted_hours=sum(c.contracted_hours for c in cells),
        absent_half_days=sum(c.absent_half_days for c in cells),
        hours_after_absences=sum(c.hours_after_absences for c in cells),
        meeting_hours=sum(c.meeting_hours for c in cells),
        hours_after_meetings=sum(c.hours_after_meetings for c in cells),
        net_hours=sum(c.net_hours for c in cells),
        person_days=sum(c.person_days for c in cells),
        present_days=sum(c.present_days for c in cells),
    )


async def build_report(
    db: AsyncSession,
    team: Team,
    window_from: date | None = None,
    window_to: date | None = None,
) -> TeamCapacityResponse:
    """Capacity per member, per sprint, plus team and per-project rows (§7.6)."""
    assignments = await load_assignments(db, team.system_id)
    anchor = assignments[0] if assignments else None

    columns: list[CapacitySprint] = []
    if anchor is not None:
        columns = await load_sprint_columns(
            db, anchor[0].project_id, window_from=window_from, window_to=window_to
        )

    members = await load_members(db, team.system_id)

    # Absences are expanded **once**, over the span every column together covers,
    # rather than per sprint per member. The lookup is a set membership test, so
    # overlapping entries union rather than sum: two absences on the same
    # afternoon cost one half-day, never two (§3.4).
    absent: AbsenceLookup = no_absences
    # Meetings are expanded over the same span and for the same reason, but they
    # **sum** where absences union: two meetings booked at once cost two meetings,
    # and it is the engine's per-day clamp — not this lookup — that stops the total
    # exceeding the hours a member actually has (§5.4 step 4).
    booked: MeetingLookup = no_meetings
    dated = [c for c in columns if c.start_date is not None and c.end_date is not None]
    if dated:
        span_start = min(c.start_date for c in dated if c.start_date is not None)
        span_end = max(c.end_date for c in dated if c.end_date is not None)
        absent = build_lookup(await load_absences(db, team.system_id), span_start, span_end)
        booked = build_meeting_lookup(
            await load_meetings(db, team.system_id), span_start, span_end
        )

    rows: list[MemberCapacityRow] = []
    per_sprint: list[list[CapacityBreakdown]] = [[] for _ in columns]
    for row, member in members:
        cells: list[CapacityBreakdown | None] = []
        for index, column in enumerate(columns):
            if not column.computable:
                # Unknown, not empty — a zero here would read as a team that does
                # no work rather than a sprint nobody has dated (§5.3).
                cells.append(None)
                continue
            assert column.start_date is not None and column.end_date is not None
            capacity = compute_member_capacity(
                member,
                team.normal_day_hours,
                column.start_date,
                column.end_date,
                absent=absent,
                meetings=booked,
            )
            breakdown = _breakdown(capacity)
            per_sprint[index].append(breakdown)
            cells.append(breakdown)
        rows.append(MemberCapacityRow(member_id=row.system_id, name=row.name, cells=cells))

    team_cells: list[CapacityBreakdown | None] = [
        _totalled(per_sprint[index]) if column.computable else None
        for index, column in enumerate(columns)
    ]

    projects: list[ProjectCapacityRow] = []
    for assignment, project in assignments:
        share = assignment.share_pct / 100
        person_days: list[float | None] = []
        units: list[float | None] = []
        proposed: list[int | None] = []
        for cell in team_cells:
            if cell is None:
                person_days.append(None)
                units.append(None)
                proposed.append(None)
                continue
            share_pd = cell.person_days * share
            in_units = share_pd * assignment.units_per_pd
            person_days.append(share_pd)
            units.append(in_units)
            # Only a `factor` project has a number a push would write; a manual
            # one is typed by hand and nothing is meant to flow into it (§6.4).
            proposed.append(
                round_half_up(in_units) if assignment.available_source == "factor" else None
            )
        projects.append(
            ProjectCapacityRow(
                project_id=project.system_id,
                name=project.name,
                effort_unit=project.effort_unit,
                share_pct=assignment.share_pct,
                available_source=assignment.available_source,
                units_per_pd=assignment.units_per_pd,
                person_days=person_days,
                units=units,
                proposed_available=proposed,
            )
        )

    return TeamCapacityResponse(
        team_id=team.system_id,
        normal_day_hours=team.normal_day_hours,
        anchor_project_id=anchor[0].project_id if anchor else None,
        sprints=columns,
        members=rows,
        team=team_cells,
        projects=projects,
    )
