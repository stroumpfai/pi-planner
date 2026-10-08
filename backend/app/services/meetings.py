"""Meeting rows, and the two things every reader wants from them.

The split mirrors `absences.py` exactly: `occurrences.py` is the pure rule engine,
and everything touching an ORM row lives here. One generator therefore stands
behind both readers — the column heads' schedule sentence and the hours the
capacity maths deducts — so a fortnight the view describes is the fortnight the
number was charged for.

Two differences from absences, both from §3.5:

**A meeting occurs on a *day*, in the half it names.** An absence covers a set of
half-days; a meeting starts in one and spills into the rest of that day (§5.4
step 4). So this module asks the generator for `occurrence_days`, never
`half_days`, and carries `half` alongside as placement rather than coverage.

**A `range` meeting is not one long block.** "Workshop, Monday to Wednesday" is
three occurrences of `duration_minutes`, not one meeting of three days — which is
what §11 means by "each day in the range costs duration_minutes".

**Two rules read the sprint calendar, not the week** (ADR 0013). A `sprint`
meeting falls on a named working day of every sprint, and a weekly or interval
meeting can skip a sprint's first or last day. So every reader here takes the
team's `SprintCalendar` beside its window: the matrix, the capacity figures and
the push must all skip the same Thursday, or the column head would promise a
saving the number never made.
"""

from collections.abc import Iterator, Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pi import PI
from app.models.sprint import Sprint
from app.models.team import Meeting, TeamProject
from app.schemas.meeting import MeetingResponse
from app.services.concurrency import etag_for
from app.services.occurrences import ScheduleRule, occurrence_days
from app.services.sprint_days import (
    NO_CALENDAR,
    SkipSprintDays,
    SprintCalendar,
    SprintEdge,
    boundary_days,
    sprint_days,
)
from app.services.team_capacity import Half, MeetingLookup

_WEEKDAY_NAMES: tuple[str, ...] = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)

_ORDINALS: dict[int, str] = {2: "2nd", 3: "3rd"}


def rule_from_row(row: Meeting) -> ScheduleRule:
    """An ORM meeting as the pure generator sees it.

    `halves` is left at its default and never read: only `occurrence_days` is
    called for meetings, and the half a meeting starts in is placement, not
    coverage. Not called for a `sprint` meeting, which has no weekly shape —
    `meeting_days` routes those to the sprint calendar instead.
    """
    return ScheduleRule(
        kind=row.kind,  # type: ignore[arg-type]
        start_date=row.start_date,
        end_date=row.end_date,
        weekday=row.weekday,
        interval_weeks=row.interval_weeks,
    )


def describe(row: Meeting) -> str:
    """The schedule in words, for the column head and for an agent's confirmation.

    Written here rather than in the UI because MCP returns it too: an off-by-one
    week is invisible in a set of fields and obvious in a sentence.

    Deliberately not `occurrences.describe`, which speaks the absence vocabulary
    — "both halves", "from am to pm" — that a meeting has no shape for. A meeting
    is one placement repeated, and the sentence says so.
    """
    half = row.half
    tail = f" until {row.end_date.isoformat()}" if row.end_date else ", ongoing"
    if row.kind == "sprint":
        day = _sprint_day_phrase(row.sprint_day or "first", row.sprint_offset or 0)
        return f"{day} of every sprint {half}, from {row.start_date.isoformat()}{tail}"
    if row.kind == "range":
        last = row.end_date or row.start_date
        if last == row.start_date:
            return f"{row.start_date.isoformat()}, {half}"
        return f"{row.start_date.isoformat()} – {last.isoformat()}, {half} each day"

    day_name = _WEEKDAY_NAMES[row.weekday] if row.weekday is not None else "?"
    every = (
        f"every {_ordinal(row.interval_weeks or 2)} {day_name}"
        if row.kind == "interval"
        else f"every {day_name}"
    )
    skip = _SKIP_PHRASES.get(row.skip_sprint_days or "none", "")
    return f"{every} {half}{skip}, from {row.start_date.isoformat()}{tail}"


_SKIP_PHRASES: dict[str, str] = {
    "first": ", except a sprint's first day",
    "last": ", except a sprint's last day",
    "both": ", except at the sprint change",
}

_DAY_ORDINALS: dict[int, str] = {1: "1st", 2: "2nd", 3: "3rd"}


def _ordinal(weeks: int) -> str:
    return _ORDINALS.get(weeks, f"{weeks}th")


def _sprint_day_phrase(edge: str, offset: int) -> str:
    """"last day", "2nd day", "2nd-last day" — the position, as people say it."""
    if offset == 0:
        return f"{edge} day"
    nth = _DAY_ORDINALS.get(offset + 1, f"{offset + 1}th")
    return f"{nth} day" if edge == "first" else f"{nth}-last day"


def _is_recurring(row: Meeting) -> bool:
    return row.kind in ("weekly", "interval")


def _skip_of(row: Meeting) -> SkipSprintDays:
    value = row.skip_sprint_days or "none"
    if not _is_recurring(row) or value not in ("first", "last", "both"):
        return "none"
    return value  # type: ignore[return-value]


def _rule_days(
    row: Meeting, calendar: SprintCalendar, window_start: date, window_end: date
) -> Iterator[date]:
    """Every day the rule itself names inside the window, before any skip."""
    if row.kind != "sprint":
        yield from occurrence_days(rule_from_row(row), window_start, window_end)
        return
    # A sprint meeting runs from `start_date` and, like any recurrence, may stop
    # at `end_date` — both are bounds here, never an anchor.
    first = max(window_start, row.start_date)
    last = window_end if row.end_date is None else min(window_end, row.end_date)
    edge: SprintEdge = "last" if row.sprint_day == "last" else "first"
    for day in sprint_days(calendar, edge, row.sprint_offset or 0):
        if first <= day <= last:
            yield day


def split_occurrences(
    row: Meeting, calendar: SprintCalendar, window_start: date, window_end: date
) -> tuple[list[date], list[date]]:
    """The days this meeting occurs on inside a window, and the days it skipped.

    Dates alone, without the half: `half` belongs to the meeting and is the same
    for every occurrence, so repeating it per date would be noise the client then
    has to trust matches the row it came with.
    """
    if window_end < window_start:
        return [], []
    skipped_days = boundary_days(calendar, _skip_of(row))
    held: list[date] = []
    skipped: list[date] = []
    for day in _rule_days(row, calendar, window_start, window_end):
        (skipped if day in skipped_days else held).append(day)
    return held, skipped


def occurrences_of(
    row: Meeting, calendar: SprintCalendar, window_start: date, window_end: date
) -> list[date]:
    """The days this meeting occurs on inside a window — the ones it costs."""
    return split_occurrences(row, calendar, window_start, window_end)[0]


def attendee_ids(row: Meeting) -> list[str]:
    """Attendees in the team's member order, so a matrix row lines up with a cell.

    Falls back to the join rows' own order when the members are not loaded, which
    is what happens on the response built straight after a write.
    """
    return [attendee.member_id for attendee in row.attendees]


def response_for(
    row: Meeting,
    calendar: SprintCalendar,
    window_start: date | None = None,
    window_end: date | None = None,
) -> MeetingResponse:
    """The wire shape, with occurrences expanded when a window is given.

    ``calendar`` is required rather than defaulted: a forgotten one would quietly
    drop every sprint meeting's occurrences and un-skip every skipped Thursday.
    Callers with no window pass `NO_CALENDAR`, where nothing is expanded anyway.
    """
    occurrences: list[date] = []
    skipped: list[date] = []
    if window_start is not None and window_end is not None:
        occurrences, skipped = split_occurrences(row, calendar, window_start, window_end)
    # Built field by field rather than validated from the row: attendance is a
    # join table in the column and a list of ids on the wire, and letting
    # `model_validate` see the row would make the schema carry the storage shape.
    return MeetingResponse(
        system_id=row.system_id,
        team_id=row.team_id,
        title=row.title,
        kind=row.kind,
        start_date=row.start_date,
        end_date=row.end_date,
        weekday=row.weekday,
        interval_weeks=row.interval_weeks,
        sprint_day=row.sprint_day,
        sprint_offset=row.sprint_offset,
        skip_sprint_days=row.skip_sprint_days or "none",
        half=row.half,
        duration_minutes=row.duration_minutes,
        order_index=row.order_index,
        member_ids=attendee_ids(row),
        summary=describe(row),
        occurrences=occurrences,
        skipped=skipped,
        created_at=row.created_at,
        modified_at=row.modified_at,
        etag=etag_for(row.modified_at),
    )


async def load_meetings(db: AsyncSession, team_id: str) -> list[Meeting]:
    """Every meeting the team holds, in the team's own column order.

    Not windowed, for the reason absences are not: the rules are few — a hundred
    at most, by §9 — and windowing the query would still have to expand every
    open-ended recurrence to know whether it reaches the window.
    """
    result = await db.execute(
        select(Meeting)
        .where(Meeting.team_id == team_id)
        .options(selectinload(Meeting.attendees))
        .order_by(Meeting.order_index.asc(), Meeting.created_at.asc())
    )
    return list(result.scalars().all())


async def load_sprint_calendar(db: AsyncSession, team_id: str) -> SprintCalendar:
    """The team's dated sprints, from its **anchor project** (§7.0.1, §6.8).

    The anchor rather than whichever project is being pushed: meetings belong to
    the team, and every other project is held to the anchor's dates anyway, so
    one calendar is the only answer that cannot disagree with itself. Undated
    sprints are left out — they have no first day to name.
    """
    anchor = await db.scalar(
        select(TeamProject.project_id)
        .where(TeamProject.team_id == team_id)
        .order_by(TeamProject.created_at.asc())
        .limit(1)
    )
    if anchor is None:
        return NO_CALENDAR
    result = await db.execute(
        select(Sprint.start_date, Sprint.end_date)
        .join(PI, PI.system_id == Sprint.pi_id)
        .where(
            PI.project_id == anchor,
            Sprint.start_date.is_not(None),
            Sprint.end_date.is_not(None),
        )
        .order_by(Sprint.start_date.asc())
    )
    return tuple((start, end) for start, end in result.all() if start and end)


def build_lookup(
    meetings: Sequence[Meeting],
    calendar: SprintCalendar,
    window_start: date,
    window_end: date,
) -> MeetingLookup:
    """The engine's meeting seam, filled from stored rules (§5.4 step 4).

    Returns **minutes starting in each half** of a day, per member — never hours
    and never a clamped figure. The clamping is the engine's, because it is a
    property of the day as a whole: an occurrence consumes from the half it
    starts in, spills into the other, and stops at the hours that survived
    absences. Deciding that here would need the member's contract, which is
    exactly what this layer does not have.

    Overlapping meetings therefore **sum** where overlapping absences union: two
    meetings booked at once really do cost two meetings' worth of attention, and
    the day's clamp is what stops the total exceeding the hours available. A
    meeting that is *not held* on a day — refinement giving way to the sprint
    change — is a different thing, and is said with `skip_sprint_days`: its
    skipped dates never reach this lookup at all (ADR 0013).
    """
    per_member: dict[tuple[str, date], dict[Half, float]] = {}
    for row in meetings:
        attendees = attendee_ids(row)
        if not attendees:
            # Allowed, and free: a column with an empty matrix costs nothing (§11).
            continue
        half: Half = "am" if row.half == "am" else "pm"
        for day in occurrences_of(row, calendar, window_start, window_end):
            for member_id in attendees:
                slot = per_member.setdefault((member_id, day), {})
                slot[half] = slot.get(half, 0.0) + float(row.duration_minutes)

    def meetings_on(member_id: str, day: date) -> dict[Half, float]:
        return per_member.get((member_id, day), {})

    return meetings_on
