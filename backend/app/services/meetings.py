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
"""

from collections.abc import Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.team import Meeting
from app.schemas.meeting import MeetingResponse
from app.services.concurrency import etag_for
from app.services.occurrences import ScheduleRule, occurrence_days
from app.services.team_capacity import Half, MeetingLookup

_WEEKDAY_NAMES: tuple[str, ...] = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)

_ORDINALS: dict[int, str] = {2: "2nd", 3: "3rd"}


def rule_from_row(row: Meeting) -> ScheduleRule:
    """An ORM meeting as the pure generator sees it.

    `halves` is left at its default and never read: only `occurrence_days` is
    called for meetings, and the half a meeting starts in is placement, not
    coverage.
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
    tail = f" until {row.end_date.isoformat()}" if row.end_date else ", ongoing"
    return f"{every} {half}, from {row.start_date.isoformat()}{tail}"


def _ordinal(weeks: int) -> str:
    return _ORDINALS.get(weeks, f"{weeks}th")


def occurrences_of(row: Meeting, window_start: date, window_end: date) -> list[date]:
    """The days this meeting occurs on inside a window.

    Dates alone, without the half: `half` belongs to the meeting and is the same
    for every occurrence, so repeating it per date would be noise the client then
    has to trust matches the row it came with.
    """
    return list(occurrence_days(rule_from_row(row), window_start, window_end))


def attendee_ids(row: Meeting) -> list[str]:
    """Attendees in the team's member order, so a matrix row lines up with a cell.

    Falls back to the join rows' own order when the members are not loaded, which
    is what happens on the response built straight after a write.
    """
    return [attendee.member_id for attendee in row.attendees]


def response_for(
    row: Meeting, window_start: date | None = None, window_end: date | None = None
) -> MeetingResponse:
    occurrences = (
        occurrences_of(row, window_start, window_end)
        if window_start is not None and window_end is not None
        else []
    )
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
        half=row.half,
        duration_minutes=row.duration_minutes,
        order_index=row.order_index,
        member_ids=attendee_ids(row),
        summary=describe(row),
        occurrences=occurrences,
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


def build_lookup(
    meetings: Sequence[Meeting], window_start: date, window_end: date
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
    the day's clamp is what stops the total exceeding the hours available.
    """
    per_member: dict[tuple[str, date], dict[Half, float]] = {}
    for row in meetings:
        attendees = attendee_ids(row)
        if not attendees:
            # Allowed, and free: a column with an empty matrix costs nothing (§11).
            continue
        half: Half = "am" if row.half == "am" else "pm"
        for day in occurrence_days(rule_from_row(row), window_start, window_end):
            for member_id in attendees:
                slot = per_member.setdefault((member_id, day), {})
                slot[half] = slot.get(half, 0.0) + float(row.duration_minutes)

    def meetings_on(member_id: str, day: date) -> dict[Half, float]:
        return per_member.get((member_id, day), {})

    return meetings_on
