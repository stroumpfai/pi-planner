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
from typing import Any

from icalendar import Calendar, Event
from pydantic import ValidationError

from app.models.holiday import HolidayCalendar, HolidayEntry
from app.schemas.holiday import HolidayEntryFields, IcsSkipped

START_HALF_PROP = "X-PIPLANNER-START-HALF"
END_HALF_PROP = "X-PIPLANNER-END-HALF"
_NOON = time(12, 0)
_LABEL_MAX = 100
_SUPPORTED_RRULE_PARTS = {"FREQ", "BYMONTH", "BYMONTHDAY", "COUNT", "UNTIL", "INTERVAL"}


@dataclass
class ParsedIcs:
    entries: list[HolidayEntryFields] = field(default_factory=list)
    skipped: list[IcsSkipped] = field(default_factory=list)
    truncated_labels: int = 0


def _as_date(value: date | datetime) -> date:
    return value.date() if isinstance(value, datetime) else value


def _span(event: Event) -> tuple[date, str, date, str] | None:
    """An event's first day, opening half, last day and closing half."""
    start_prop = event.get("DTSTART")
    if start_prop is None:
        return None
    start: date | datetime = start_prop.dt
    end_prop = event.get("DTEND")
    end: date | datetime | None = end_prop.dt if end_prop is not None else None
    if end is None and event.get("DURATION") is not None:
        end = start + event.get("DURATION").dt

    if not isinstance(start, datetime):
        # All-day: DTEND is exclusive, and may be missing for a one-day event.
        last = (_as_date(end) - timedelta(days=1)) if end is not None else start
        return start, "am", max(last, start), "pm"

    start_half = "am" if start.time() < _NOON else "pm"
    if end is None or not isinstance(end, datetime):
        return start.date(), start_half, start.date(), "pm" if start_half == "pm" else "am"
    last_day = end.date()
    end_half = "am" if end.time() <= _NOON else "pm"
    if end.time() == time(0, 0) and last_day > start.date():
        # Ending at midnight closes the previous day, in full.
        last_day -= timedelta(days=1)
        end_half = "pm"
    if last_day < start.date():
        last_day = start.date()
    return start.date(), start_half, last_day, end_half


def _halves_override(event: Event, start_half: str, end_half: str) -> tuple[str, str]:
    """An event this app exported says its halves outright; they win over clock times."""
    explicit_start = str(event.get(START_HALF_PROP, "")).lower()
    explicit_end = str(event.get(END_HALF_PROP, "")).lower()
    return (
        explicit_start if explicit_start in ("am", "pm") else start_half,
        explicit_end if explicit_end in ("am", "pm") else end_half,
    )


def _label(event: Event, parsed: ParsedIcs) -> str:
    summary = " ".join(str(event.get("SUMMARY", "")).split()) or "Public holiday"
    if len(summary) > _LABEL_MAX:
        parsed.truncated_labels += 1
        summary = summary[:_LABEL_MAX].rstrip()
    return summary


def _rule_parts(event: Event) -> dict[str, list[Any]] | None:
    rule = event.get("RRULE")
    if rule is None:
        return None
    return {str(key).upper(): list(value) for key, value in rule.items()}


def _excluded_dates(event: Event) -> set[date]:
    raw = event.get("EXDATE")
    if raw is None:
        return set()
    props = raw if isinstance(raw, list) else [raw]
    excluded: set[date] = set()
    for prop in props:
        for item in prop.dts:
            excluded.add(_as_date(item.dt))
    return excluded


def _yearly_starts(
    first: date, parts: dict[str, list[Any]], years: range
) -> list[date] | str:
    """Occurrence start dates of a yearly rule inside ``years``, or why it can't be read."""
    unsupported = set(parts) - _SUPPORTED_RRULE_PARTS
    if unsupported:
        return f"recurring rule uses {', '.join(sorted(unsupported))}, which is not supported"
    interval = int(parts.get("INTERVAL", [1])[0])
    if interval != 1:
        return "recurring rule repeats every few years, which is not supported"
    months = [int(m) for m in parts.get("BYMONTH", [])] or [first.month]
    month_days = [int(d) for d in parts.get("BYMONTHDAY", [])] or [first.day]
    if len(months) != 1 or len(month_days) != 1:
        return "recurring rule names several days a year, which is not supported"
    count = int(parts["COUNT"][0]) if "COUNT" in parts else None
    until_raw = parts.get("UNTIL", [None])[0]
    until = _as_date(until_raw) if until_raw is not None else None

    starts: list[date] = []
    occurrence = 0
    year = first.year
    while year <= years.stop - 1:
        try:
            day = date(year, months[0], month_days[0])
        except ValueError:
            year += 1
            continue  # 29 February, or 31 April: no occurrence that year
        if day >= first:
            occurrence += 1
            if count is not None and occurrence > count:
                break
            if until is not None and day > until:
                break
            if year in years:
                starts.append(day)
        year += 1
    return starts


def parse_ics(
    content: bytes, *, from_year: int | None = None, to_year: int | None = None
) -> ParsedIcs:
    """Holiday entries from an iCalendar file. Raises ``ValueError`` on a file it can't read."""
    try:
        calendar = Calendar.from_ical(content)
    except Exception as err:  # the parser raises several types for one meaning
        raise ValueError(f"This is not a readable iCalendar file: {err}") from err
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
        span = _span(event)
        if span is None:
            parsed.skipped.append(IcsSkipped(summary=summary, reason="the event has no start date"))
            continue
        start, start_half, last, end_half = span
        start_half, end_half = _halves_override(event, start_half, end_half)
        label = _label(event, parsed)

        starts: list[date] = [start]
        parts = _rule_parts(event)
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
            expanded = _yearly_starts(start, parts, years)
            if isinstance(expanded, str):
                parsed.skipped.append(IcsSkipped(summary=summary, reason=expanded))
                continue
            excluded = _excluded_dates(event)
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
