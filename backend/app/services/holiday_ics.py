"""Reading and writing iCalendar files for holiday calendars (public-holidays.md §7.1, §7.2).

The file format is the `icalendar` package's job; what a VEVENT *means* as a
holiday is ours. Three rules carry the weight:

**Dates as written.** A holiday is a date. An event's date is taken in the zone it
was written in, never converted: inventing a zone would only move a holiday to
the neighbouring day (the CSV importer's reasoning, team-achievement.md §4.3).

**Halves from clock times.** An all-day event covers whole days, with an exclusive
``DTEND`` turned into an inclusive last day. A timed event opens in the morning
when it starts before noon and closes in the morning when it ends at or before
noon — which is how Outlook stores "Christmas Eve afternoon". An event this app
exported carries its halves explicitly, so a round trip is exact.

**Yearly rules are expanded, never stored.** Entries are dated (§3.2). A
``FREQ=YEARLY`` rule becomes one entry per year inside the requested years; any
other recurrence is skipped and said so, rather than guessed at.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from icalendar import Calendar, Event
from pydantic import ValidationError

from app.models.holiday import HolidayCalendar, HolidayEntry
from app.schemas.common import IcsSkipped
from app.schemas.holiday import HolidayEntryFields
from app.services.ics import (
    END_HALF_PROP,
    START_HALF_PROP,
    clean_label,
    excluded_dates,
    halves_override,
    read_calendar,
    rule_parts,
    span,
    yearly_starts,
)


@dataclass
class ParsedIcs:
    entries: list[HolidayEntryFields] = field(default_factory=list)
    skipped: list[IcsSkipped] = field(default_factory=list)
    truncated_labels: int = 0


def parse_ics(
    content: bytes, *, from_year: int | None = None, to_year: int | None = None
) -> ParsedIcs:
    """Holiday entries from an iCalendar file. Raises ``ValueError`` on a file it can't read."""
    calendar = read_calendar(content)
    this_year = datetime.now(timezone.utc).year
    first_year = from_year if from_year is not None else this_year
    last_year = to_year if to_year is not None else first_year + 1
    if last_year < first_year:
        raise ValueError("to_year cannot fall before from_year")
    years = range(first_year, last_year + 1)

    parsed = ParsedIcs()
    for component in calendar.walk():
        name = component.name
        if name in ("VTODO", "VJOURNAL"):
            parsed.skipped.append(IcsSkipped(
                summary=str(component.get("SUMMARY", "")) or name,
                reason=f"a {name} is not an event",
            ))
            continue
        if name != "VEVENT":
            continue
        event: Event = component  # type: ignore[assignment]
        summary = str(event.get("SUMMARY", "")) or "(no title)"
        event_span = span(event)
        if event_span is None:
            parsed.skipped.append(IcsSkipped(summary=summary, reason="the event has no start date"))
            continue
        start, start_half, last, end_half = event_span
        start_half, end_half = halves_override(event, start_half, end_half)
        label, truncated = clean_label(event.get("SUMMARY"), "Public holiday")
        if truncated:
            parsed.truncated_labels += 1

        starts: list[date] = [start]
        parts = rule_parts(event)
        if parts is not None:
            if event.get("RDATE") is not None:
                parsed.skipped.append(IcsSkipped(summary=summary, reason="extra dates (RDATE) are not supported"))
                continue
            freq = str(parts.get("FREQ", [""])[0]).upper()
            if freq != "YEARLY":
                parsed.skipped.append(IcsSkipped(
                    summary=summary, reason=f"repeats {freq.lower() or 'on a rule'}; only yearly holidays are read",
                ))
                continue
            expanded = yearly_starts(start, parts, years)
            if isinstance(expanded, str):
                parsed.skipped.append(IcsSkipped(summary=summary, reason=expanded))
                continue
            excluded = excluded_dates(event)
            starts = [s for s in expanded if s not in excluded]

        length = last - start
        for occurrence_start in starts:
            try:
                parsed.entries.append(HolidayEntryFields(
                    label=label,
                    start_date=occurrence_start,
                    start_half=start_half,
                    end_date=occurrence_start + length,
                    end_half=end_half,
                ))
            except ValidationError as err:
                parsed.skipped.append(IcsSkipped(summary=summary, reason=err.errors()[0]["msg"]))
    return parsed


def export_ics(calendar: HolidayCalendar, entries: Sequence[HolidayEntry]) -> bytes:
    """One VCALENDAR, one VEVENT per entry (§7.2).

    Whole days are all-day events, so Outlook and Google show them as holidays.
    An entry opening or closing on a half day is a timed event — 08:00–12:00 for a
    morning, 13:00–17:00 for an afternoon — carrying its halves explicitly for an
    exact re-import. UIDs are stable, so re-importing into Outlook updates events
    rather than duplicating them. Exceptions are team data and never leave.
    """
    cal = Calendar()
    cal.add("PRODID", "-//PI Planner//Holiday calendars//EN")
    cal.add("VERSION", "2.0")
    cal.add("X-WR-CALNAME", calendar.name)
    if calendar.description:
        cal.add("X-WR-CALDESC", calendar.description)
    stamp = datetime.now(timezone.utc)
    for entry in entries:
        event = Event()
        event.add("UID", f"{entry.system_id}@piplanner")
        event.add("DTSTAMP", stamp)
        event.add("SUMMARY", entry.label)
        if entry.start_half == "am" and entry.end_half == "pm":
            event.add("DTSTART", entry.start_date)
            event.add("DTEND", entry.end_date + timedelta(days=1))
        else:
            opens = time(8, 0) if entry.start_half == "am" else time(13, 0)
            closes = time(12, 0) if entry.end_half == "am" else time(17, 0)
            event.add("DTSTART", datetime.combine(entry.start_date, opens))
            event.add("DTEND", datetime.combine(entry.end_date, closes))
            event.add(START_HALF_PROP, entry.start_half)
            event.add(END_HALF_PROP, entry.end_half)
        event.add("TRANSP", "TRANSPARENT")
        event.add("X-MICROSOFT-CDO-BUSYSTATUS", "OOF")
        cal.add_component(event)
    return bytes(cal.to_ical())
