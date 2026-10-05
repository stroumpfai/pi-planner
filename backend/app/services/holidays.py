"""Holiday calendar rows, and what a team sees of them (spec/public-holidays.md).

The split mirrors `absences.py`: `occurrences.py` is the pure rule engine, and
everything touching an ORM row lives here. An entry is a `range` and nothing else,
so it is expanded by the same `half_days` generator as a range absence — a holiday
the strip draws is a holiday the capacity figure removed.
"""

from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holiday import HolidayCalendar, HolidayEntry, HolidayException, TeamHolidayCalendar
from app.models.team import Team, TeamMember
from app.schemas.holiday import HolidayEntryFields, HolidayEntryResponse
from app.services.concurrency import etag_for
from app.services.events import broadcaster, team_channel
from app.services.occurrences import ScheduleRule, half_days
from app.services.team_capacity import HALVES, AbsenceLookup, Half, no_absences

#: The app-wide channel the Calendars page listens on (§9.2). Calendars belong to
#: no team, so a team channel cannot carry their edits to the page itself.
CALENDARS_CHANNEL = "holiday-calendars"
HOLIDAYS_CHANGED = "holidays:changed"

EntryKey = tuple[str, date, str, date, str]


# ── names and identity ───────────────────────────────────────────────────────


async def calendar_by_name(
    db: AsyncSession, name: str, *, exclude_id: str | None = None
) -> HolidayCalendar | None:
    """The calendar with this name, compared case-insensitively (§3.1)."""
    query = select(HolidayCalendar).where(func.lower(HolidayCalendar.name) == name.strip().lower())
    if exclude_id is not None:
        query = query.where(HolidayCalendar.system_id != exclude_id)
    return (await db.execute(query)).scalars().first()


def entry_key(
    label: str, start_date: date, start_half: str, end_date: date, end_half: str
) -> EntryKey:
    """What makes two entries "the same holiday": dates, halves and label, case aside."""
    return (" ".join(label.split()).lower(), start_date, start_half, end_date, end_half)


def key_of(entry: HolidayEntry) -> EntryKey:
    return entry_key(entry.label, entry.start_date, entry.start_half, entry.end_date, entry.end_half)


def key_of_fields(fields: HolidayEntryFields) -> EntryKey:
    return entry_key(fields.label, fields.start_date, fields.start_half, fields.last_day, fields.end_half)


def apply_fields(entry: HolidayEntry, fields: HolidayEntryFields) -> None:
    entry.label = fields.label
    entry.start_date = fields.start_date
    entry.start_half = fields.start_half
    entry.end_date = fields.last_day
    entry.end_half = fields.end_half


# ── expansion ────────────────────────────────────────────────────────────────


def entry_rule(entry: HolidayEntry) -> ScheduleRule:
    return ScheduleRule(
        kind="range",
        start_date=entry.start_date,
        end_date=entry.end_date,
        start_half=entry.start_half,  # type: ignore[arg-type]
        end_half=entry.end_half,  # type: ignore[arg-type]
    )


def entry_half_days(
    entry: HolidayEntry, window_start: date | None = None, window_end: date | None = None
) -> Iterator[tuple[date, Half]]:
    return half_days(
        entry_rule(entry), window_start or entry.start_date, window_end or entry.end_date
    )


def entry_days(
    entry: HolidayEntry, window_start: date | None = None, window_end: date | None = None
) -> list[tuple[date, list[Half]]]:
    """The days an entry touches, each with its halves in order — the grid's shape."""
    per_day: dict[date, set[Half]] = defaultdict(set)
    for day, half in entry_half_days(entry, window_start, window_end):
        per_day[day].add(half)
    return [(day, [h for h in HALVES if h in per_day[day]]) for day in sorted(per_day)]


# ── a team's effective holidays ──────────────────────────────────────────────


@dataclass
class TeamHolidays:
    """The entries of a team's enabled calendars in a window, and its members' exceptions."""

    enabled_calendar_ids: list[str] = field(default_factory=list)
    calendars: dict[str, HolidayCalendar] = field(default_factory=dict)
    entries: list[HolidayEntry] = field(default_factory=list)
    # (member_id, entry_id, day): that member works that day of that holiday.
    exceptions: set[tuple[str, str, date]] = field(default_factory=set)


async def enabled_calendar_ids(db: AsyncSession, team_id: str) -> list[str]:
    result = await db.execute(
        select(TeamHolidayCalendar.calendar_id)
        .where(TeamHolidayCalendar.team_id == team_id)
        .order_by(TeamHolidayCalendar.created_at.asc())
    )
    return list(result.scalars().all())


async def load_team_holidays(
    db: AsyncSession, team_id: str, window_start: date, window_end: date
) -> TeamHolidays:
    """Entries of the team's enabled calendars that touch the window (§4.1)."""
    holidays = TeamHolidays(enabled_calendar_ids=await enabled_calendar_ids(db, team_id))
    if not holidays.enabled_calendar_ids:
        return holidays

    calendars = (await db.execute(
        select(HolidayCalendar).where(HolidayCalendar.system_id.in_(holidays.enabled_calendar_ids))
    )).scalars().all()
    holidays.calendars = {c.system_id: c for c in calendars}
    holidays.entries = list((await db.execute(
        select(HolidayEntry)
        .where(
            HolidayEntry.calendar_id.in_(holidays.enabled_calendar_ids),
            HolidayEntry.start_date <= window_end,
            HolidayEntry.end_date >= window_start,
        )
        .order_by(HolidayEntry.start_date.asc(), HolidayEntry.label.asc())
    )).scalars().all())
    if holidays.entries:
        rows = (await db.execute(
            select(HolidayException.member_id, HolidayException.entry_id, HolidayException.day)
            .join(TeamMember, TeamMember.system_id == HolidayException.member_id)
            .where(
                TeamMember.team_id == team_id,
                HolidayException.entry_id.in_([e.system_id for e in holidays.entries]),
            )
        )).all()
        holidays.exceptions = {(r.member_id, r.entry_id, r.day) for r in rows}
    return holidays


def build_holiday_lookup(
    holidays: TeamHolidays, window_start: date, window_end: date
) -> AbsenceLookup:
    """The engine's holiday seam (§4.1).

    A half is a holiday for a member when **any** entry covering it has no
    exception for that member on that day. Two calendars on one day union, so a
    member on call for one of them is still off for the other.
    """
    if not holidays.entries:
        return no_absences
    covering: dict[tuple[date, Half], list[str]] = defaultdict(list)
    for entry in holidays.entries:
        for day, half in entry_half_days(entry, window_start, window_end):
            covering[(day, half)].append(entry.system_id)
    exceptions = holidays.exceptions

    def on_holiday(member_id: str, day: date, half: Half) -> bool:
        return any(
            (member_id, entry_id, day) not in exceptions
            for entry_id in covering.get((day, half), ())
        )

    return on_holiday


async def holiday_lookup(
    db: AsyncSession, team_id: str, window_start: date, window_end: date
) -> AbsenceLookup:
    holidays = await load_team_holidays(db, team_id, window_start, window_end)
    return build_holiday_lookup(holidays, window_start, window_end)


# ── responses ────────────────────────────────────────────────────────────────


async def exception_days_by_entry(
    db: AsyncSession, entry_ids: Sequence[str]
) -> dict[str, list[date]]:
    if not entry_ids:
        return {}
    rows = (await db.execute(
        select(HolidayException.entry_id, HolidayException.day)
        .where(HolidayException.entry_id.in_(entry_ids))
        .order_by(HolidayException.day.asc())
    )).all()
    days: dict[str, list[date]] = defaultdict(list)
    for row in rows:
        days[row.entry_id].append(row.day)
    return days


def entry_response(entry: HolidayEntry, exception_days: Iterable[date] = ()) -> HolidayEntryResponse:
    return HolidayEntryResponse(
        system_id=entry.system_id,
        calendar_id=entry.calendar_id,
        label=entry.label,
        start_date=entry.start_date,
        start_half=entry.start_half,
        end_date=entry.end_date,
        end_half=entry.end_half,
        exception_days=list(exception_days),
        created_at=entry.created_at,
        modified_at=entry.modified_at,
        etag=etag_for(entry.modified_at),
    )


async def teams_using(db: AsyncSession, calendar_ids: Sequence[str]) -> dict[str, list[Team]]:
    if not calendar_ids:
        return {}
    rows = (await db.execute(
        select(TeamHolidayCalendar.calendar_id, Team)
        .join(Team, Team.system_id == TeamHolidayCalendar.team_id)
        .where(TeamHolidayCalendar.calendar_id.in_(calendar_ids))
        .order_by(Team.name.asc())
    )).all()
    using: dict[str, list[Team]] = defaultdict(list)
    for calendar_id, team in rows:
        using[calendar_id].append(team)
    return using


# ── exceptions follow their entry's dates ────────────────────────────────────


async def drop_exceptions_outside(db: AsyncSession, entry: HolidayEntry) -> int:
    """Delete exceptions whose day the entry no longer covers (§3.5); returns how many."""
    rows = (await db.execute(
        select(HolidayException).where(HolidayException.entry_id == entry.system_id)
    )).scalars().all()
    covered = {day for day, _ in entry_days(entry)}
    dropped = 0
    for row in rows:
        if row.day not in covered:
            await db.delete(row)
            dropped += 1
    return dropped


# ── broadcasts (§9.2) ────────────────────────────────────────────────────────


async def notify_calendar_changed(
    db: AsyncSession, calendar_id: str, *, extra_team_ids: Iterable[str] = ()
) -> None:
    """Tell the Calendars page and every team that enables this calendar.

    A broadcast, never a write — the same crossing ``notify_team_achievement``
    makes. ``extra_team_ids`` covers teams that *were* using a calendar that has
    just been deleted, whose switch rows are already gone.
    """
    team_ids = set(extra_team_ids)
    team_ids.update((await db.execute(
        select(TeamHolidayCalendar.team_id).where(TeamHolidayCalendar.calendar_id == calendar_id)
    )).scalars().all())
    payload = {"calendar_id": calendar_id}
    await broadcaster.broadcast(CALENDARS_CHANNEL, HOLIDAYS_CHANGED, payload)
    for team_id in sorted(team_ids):
        await broadcaster.broadcast(team_channel(team_id), HOLIDAYS_CHANGED, payload)


async def notify_team_holidays(team_id: str, calendar_id: str | None = None) -> None:
    """A switch or exception write: only this team's views move (§9.2)."""
    payload = {"calendar_id": calendar_id}
    await broadcaster.broadcast(team_channel(team_id), HOLIDAYS_CHANGED, payload)
    if calendar_id is not None:
        # The Calendars page shows which teams use each calendar.
        await broadcaster.broadcast(CALENDARS_CHANNEL, HOLIDAYS_CHANGED, payload)


# ── rows that point at members and teams ─────────────────────────────────────
#
# SQLite runs here without foreign-key enforcement, so the schema's ON DELETE
# CASCADE is documentation, not behaviour. Whatever deletes a member, a team, an
# entry or a calendar removes the holiday rows pointing at it explicitly.


async def forget_members(db: AsyncSession, member_ids: Sequence[str]) -> None:
    if member_ids:
        await db.execute(delete(HolidayException).where(HolidayException.member_id.in_(member_ids)))


async def forget_team(db: AsyncSession, team_id: str) -> None:
    member_ids = list((await db.execute(
        select(TeamMember.system_id).where(TeamMember.team_id == team_id)
    )).scalars().all())
    await forget_members(db, member_ids)
    await db.execute(delete(TeamHolidayCalendar).where(TeamHolidayCalendar.team_id == team_id))


async def forget_entries(db: AsyncSession, entry_ids: Sequence[str]) -> None:
    if entry_ids:
        await db.execute(delete(HolidayException).where(HolidayException.entry_id.in_(entry_ids)))
