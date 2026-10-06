"""Reading iCalendar files: the parts that do not care what an event means.

Holiday calendars (public-holidays.md §7.1) and member absences (teams.md
§7.4.1) both import ``.ics`` files, and they disagree only about what a VEVENT
*becomes*. Everything else lives here, once: turning an event's start and end
into days and halves, reading its recurrence rule, and expanding the yearly
subset both importers accept.

**Dates as written.** An event's date is taken in the zone it was written in,
never converted: inventing a zone would only move a day off to the
neighbouring one (the CSV importer's reasoning, team-achievement.md §4.3).

**Halves from clock times.** An all-day event covers whole days, with an
exclusive ``DTEND`` turned into an inclusive last day. A timed event opens in
the morning when it starts before noon and closes in the morning when it ends
at or before noon — which is how Outlook stores "Christmas Eve afternoon". An
event this app exported carries its halves explicitly, so a round trip is exact.
"""

from datetime import date, datetime, time, timedelta
from typing import Any

from icalendar import Calendar, Event

START_HALF_PROP = "X-PIPLANNER-START-HALF"
END_HALF_PROP = "X-PIPLANNER-END-HALF"
NOON = time(12, 0)
LABEL_MAX = 100
#: An Outlook export of a busy year is a few hundred kilobytes; anything far
#: larger is not a calendar someone means to import, and is read whole.
MAX_ICS_BYTES = 2 * 1024 * 1024
_YEARLY_RULE_PARTS = {"FREQ", "BYMONTH", "BYMONTHDAY", "COUNT", "UNTIL", "INTERVAL"}


def read_calendar(content: bytes) -> Calendar:
    """The parsed file. Raises ``ValueError`` on a file it can't read."""
    try:
        return Calendar.from_ical(content)
    except Exception as err:  # the parser raises several types for one meaning
        raise ValueError(f"This is not a readable iCalendar file: {err}") from err


def as_date(value: date | datetime) -> date:
    return value.date() if isinstance(value, datetime) else value


def is_all_day(event: Event) -> bool:
    start_prop = event.get("DTSTART")
    return start_prop is not None and not isinstance(start_prop.dt, datetime)


def span(event: Event) -> tuple[date, str, date, str] | None:
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
        last = (as_date(end) - timedelta(days=1)) if end is not None else start
        return start, "am", max(last, start), "pm"

    start_half = "am" if start.time() < NOON else "pm"
    if end is None or not isinstance(end, datetime):
        return start.date(), start_half, start.date(), "pm" if start_half == "pm" else "am"
    last_day = end.date()
    end_half = "am" if end.time() <= NOON else "pm"
    if end.time() == time(0, 0) and last_day > start.date():
        # Ending at midnight closes the previous day, in full.
        last_day -= timedelta(days=1)
        end_half = "pm"
    if last_day < start.date():
        last_day = start.date()
    return start.date(), start_half, last_day, end_half


def halves_override(event: Event, start_half: str, end_half: str) -> tuple[str, str]:
    """An event this app exported says its halves outright; they win over clock times."""
    explicit_start = str(event.get(START_HALF_PROP, "")).lower()
    explicit_end = str(event.get(END_HALF_PROP, "")).lower()
    return (
        explicit_start if explicit_start in ("am", "pm") else start_half,
        explicit_end if explicit_end in ("am", "pm") else end_half,
    )


def clean_label(raw: Any, fallback: str) -> tuple[str, bool]:
    """``SUMMARY`` as a label: whitespace collapsed, cut to 100 chars. Says if it was cut."""
    summary = " ".join(str(raw or "").split()) or fallback
    if len(summary) > LABEL_MAX:
        return summary[:LABEL_MAX].rstrip(), True
    return summary, False


def rule_parts(event: Event) -> dict[str, list[Any]] | None:
    rule = event.get("RRULE")
    if rule is None:
        return None
    return {str(key).upper(): list(value) for key, value in rule.items()}


def excluded_dates(event: Event) -> set[date]:
    raw = event.get("EXDATE")
    if raw is None:
        return set()
    props = raw if isinstance(raw, list) else [raw]
    excluded: set[date] = set()
    for prop in props:
        for item in prop.dts:
            excluded.add(as_date(item.dt))
    return excluded


def yearly_starts(
    first: date, parts: dict[str, list[Any]], years: range
) -> list[date] | str:
    """Occurrence start dates of a yearly rule inside ``years``, or why it can't be read."""
    unsupported = set(parts) - _YEARLY_RULE_PARTS
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
    until = as_date(until_raw) if until_raw is not None else None

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
