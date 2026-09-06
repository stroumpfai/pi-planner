"""Absence rows, and the two things every reader wants from them.

The split mirrors `team_capacity.py` / `team_capacity_report.py`: `occurrences.py`
is the pure rule engine, and everything that touches an ORM row lives here. That
is what keeps one generator behind both readers — the grid's cells and the
capacity figures are expanded by the same code, so a fortnight the view draws is
a fortnight the number deducted.

`halves` is stored as a comma-joined string because SQLite has no set type and
the alternative — a fourteenth boolean pair, or a child table for at most two
values — buys nothing. It is parsed in exactly one place, below.
"""

from collections.abc import Iterable, Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Absence
from app.schemas.absence import AbsenceOccurrence, AbsenceResponse
from app.services.concurrency import etag_for
from app.services.occurrences import ScheduleRule, describe, half_days
from app.services.team_capacity import HALVES, AbsenceLookup, Half


def parse_halves(stored: str | None) -> tuple[Half, ...]:
    """``"am,pm"`` → ``("am", "pm")``. Empty or absent means both.

    Defaulting to both rather than to none matters: a row whose halves were never
    written is a whole-day absence, and reading it as no halves at all would
    silently give back capacity nobody has.
    """
    if not stored:
        return HALVES
    wanted = [part.strip() for part in stored.split(",")]
    return tuple(half for half in HALVES if half in wanted) or HALVES


def format_halves(halves: Iterable[str] | None) -> str | None:
    if halves is None:
        return None
    ordered = [half for half in HALVES if half in set(halves)]
    return ",".join(ordered) if ordered else None


def rule_from_row(row: Absence) -> ScheduleRule:
    """An ORM absence as the pure generator sees it."""
    return ScheduleRule(
        kind=row.kind,  # type: ignore[arg-type]
        start_date=row.start_date,
        end_date=row.end_date,
        start_half=row.start_half or "am",  # type: ignore[arg-type]
        end_half=row.end_half or "pm",  # type: ignore[arg-type]
        weekday=row.weekday,
        halves=parse_halves(row.halves),
        interval_weeks=row.interval_weeks,
    )


def occurrences_of(row: Absence, window_start: date, window_end: date) -> list[AbsenceOccurrence]:
    """The days this absence touches in a window, one entry per day.

    Grouped per day rather than per half-day because the grid draws a day as one
    cell in two parts, and a half-day absence fills literally half of it (§7.4).
    """
    per_day: dict[date, list[Half]] = {}
    for day, half in half_days(rule_from_row(row), window_start, window_end):
        per_day.setdefault(day, []).append(half)
    return [
        AbsenceOccurrence(date=day, halves=[h for h in HALVES if h in per_day[day]])
        for day in sorted(per_day)
    ]


def response_for(
    row: Absence, window_start: date | None = None, window_end: date | None = None
) -> AbsenceResponse:
    occurrences = (
        occurrences_of(row, window_start, window_end)
        if window_start is not None and window_end is not None
        else []
    )
    # Built field by field rather than validated from the row: `halves` is a
    # comma-joined string in the column and a list on the wire, and letting
    # `model_validate` see the row would make the schema carry the storage shape.
    return AbsenceResponse(
        system_id=row.system_id,
        team_id=row.team_id,
        member_id=row.member_id,
        label=row.label,
        kind=row.kind,
        start_date=row.start_date,
        end_date=row.end_date,
        start_half=row.start_half or "am",
        end_half=row.end_half or "pm",
        weekday=row.weekday,
        halves=list(parse_halves(row.halves)) if row.halves else None,
        interval_weeks=row.interval_weeks,
        summary=describe(rule_from_row(row)),
        occurrences=occurrences,
        created_at=row.created_at,
        modified_at=row.modified_at,
        etag=etag_for(row.modified_at),
    )


async def load_absences(db: AsyncSession, team_id: str) -> list[Absence]:
    """Every absence rule the team holds, oldest anchor first.

    Not windowed. The rules are few — thousands of *occurrences* collapse into
    tens of rows — and windowing the query would still have to expand every
    open-ended recurrence to know whether it reaches the window.
    """
    result = await db.execute(
        select(Absence)
        .where(Absence.team_id == team_id)
        .order_by(Absence.start_date.asc(), Absence.created_at.asc())
    )
    return list(result.scalars().all())


def build_lookup(
    absences: Sequence[Absence], window_start: date, window_end: date
) -> AbsenceLookup:
    """The engine's absence seam, filled from stored rules (§5.4 step 2).

    Expanded into a set once for the whole window, which is what makes overlaps
    a **union rather than a sum**: two absences on the same afternoon are one
    entry in the set and cost one half-day. Nothing here warns about an absence
    on a half-day the member does not work — it simply never matches a contracted
    slot, which is exactly the "allowed, and has no effect" rule (§3.4).
    """
    covered: set[tuple[str, date, Half]] = set()
    for row in absences:
        for day, half in half_days(rule_from_row(row), window_start, window_end):
            covered.add((row.member_id, day, half))

    def absent(member_id: str, day: date, half: Half) -> bool:
        return (member_id, day, half) in covered

    return absent
