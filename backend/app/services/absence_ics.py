"""What a calendar file's events mean as absences (teams.md §7.4.1).

The format itself is `ics.py`'s; this module decides what an event *becomes*.
It is pure — no ORM row and no session reach here — so every mapping rule is
unit-testable against a hand-written file. Matching members and diffing against
stored rows is `absence_import.py`'s job.

Three things differ from the holiday importer, and each follows from the model:

**A weekly event stays a rule.** Absences store `weekly` and `interval` rules
(§3.4), so "every Wednesday afternoon" imports as one row, not as fifty-two.
Only the yearly subset is expanded, because absences have no yearly kind.

**A series with holes is skipped, not approximated.** Absences have no
per-occurrence exceptions (§3.4), so an ``EXDATE`` on a weekly rule, or a
``RECURRENCE-ID`` moving one occurrence, cannot be stored faithfully. The
preview says so, and the gap is entered as a range by hand.

**Every row keeps its event's ``UID``.** Re-importing an updated file updates
what it imported before (ADR 0011). A rule that becomes several rows — one per
``BYDAY`` weekday, one per year of a yearly rule — gets a suffixed key, so each
row's key is still stable from one export to the next.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from icalendar import Event
from pydantic import ValidationError

from app.schemas.absence import Half, ScheduleFields
from app.schemas.common import IcsSkipped
from app.services import ics

#: More events than this is not one person's or one team's leave, and the
#: preview would be unreadable anyway.
MAX_EVENTS = 2000

_DAY_CODES = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
_WEEKLY_RULE_PARTS = {"FREQ", "BYDAY", "INTERVAL", "COUNT", "UNTIL", "WKST"}
_OOF = "OOF"


class TooManyEvents(ValueError):
    """The file holds more events than one import may carry."""


@dataclass
class AbsenceEvent:
    """One row the file would write, before anyone is matched to it."""

    source_uid: str
    # The event's title as written, for the preview — `rule.label` is the same
    # text cut to 100 characters.
    title: str
    rule: ScheduleFields
    # ATTENDEE and ORGANIZER common names, the first way a team file names its people.
    people: list[str] = field(default_factory=list)
    selected_by_default: bool = True
    hint: str | None = None


@dataclass
class ParsedAbsenceIcs:
    events: list[AbsenceEvent] = field(default_factory=list)
    skipped: list[IcsSkipped] = field(default_factory=list)
    truncated_labels: int = 0
    # The days the file's single and weekly events reach. `None` when the file
    # holds nothing dated but yearly rules, or nothing at all.
    span: tuple[date, date] | None = None


def default_years() -> range:
    """Yearly rules expand over this year and next when no window is named."""
    this_year = datetime.now(timezone.utc).year
    return range(this_year, this_year + 2)


def _people(event: Event) -> list[str]:
    names: list[str] = []
    for prop_name in ("ATTENDEE", "ORGANIZER"):
        raw = event.get(prop_name)
        if raw is None:
            continue
        for prop in raw if isinstance(raw, list) else [raw]:
            common_name = str(getattr(prop, "params", {}).get("CN", "")).strip()
            if common_name and common_name not in names:
                names.append(common_name)
    return names


def _is_out_of_office(event: Event) -> bool:
    return any(
        str(event.get(prop, "")).upper() == _OOF
        for prop in ("X-MICROSOFT-CDO-BUSYSTATUS", "X-MICROSOFT-CDO-INTENDEDSTATUS")
    )


def _halves_of_day(start_half: str, end_half: str) -> list[Half]:
    if start_half == end_half:
        return ["am"] if start_half == "am" else ["pm"]
    return ["am", "pm"]


def _weekday_codes(parts: dict[str, list[Any]], first: date) -> list[str] | str:
    raw = [str(value).upper() for value in parts.get("BYDAY", [])]
    if not raw:
        return [_DAY_CODES[first.weekday()]]
    if any(code not in _DAY_CODES for code in raw):
        return "recurring rule names a numbered weekday, which is not supported"
    return list(dict.fromkeys(raw))


def _weekly_rules(
    first: date, parts: dict[str, list[Any]]
) -> list[tuple[int, date, date | None, int]] | str:
    """``(weekday, anchor, end_date, interval)`` per ``BYDAY`` day, or why the rule can't be read.

    RFC 5545 counts an ``INTERVAL`` from the week ``DTSTART`` falls in, while
    the occurrence engine anchors on the first matching day on or after
    ``start_date``. Anchoring each weekday inside ``DTSTART``'s own week —
    pushed a whole interval on when that day is already past — makes the two
    agree, so "every other Monday and Friday from a Wednesday" lands on the same
    fortnight as Outlook draws it.
    """
    unsupported = set(parts) - _WEEKLY_RULE_PARTS
    if unsupported:
        return f"recurring rule uses {', '.join(sorted(unsupported))}, which is not supported"
    interval = int(parts.get("INTERVAL", [1])[0])
    if interval > 52:
        return "recurring rule repeats less often than once a year, which is not supported"
    codes = _weekday_codes(parts, first)
    if isinstance(codes, str):
        return codes
    week_start_code = str(parts.get("WKST", ["MO"])[0]).upper()
    week_start_day = _DAY_CODES.index(week_start_code) if week_start_code in _DAY_CODES else 0
    week_start = first - timedelta(days=(first.weekday() - week_start_day) % 7)

    anchors: list[tuple[int, date]] = []
    for code in codes:
        weekday = _DAY_CODES.index(code)
        anchor = week_start + timedelta(days=(weekday - week_start_day) % 7)
        if anchor < first:
            anchor += timedelta(weeks=interval)
        anchors.append((weekday, anchor))

    end: date | None = None
    if "UNTIL" in parts:
        end = ics.as_date(parts["UNTIL"][0])
    elif "COUNT" in parts:
        end = _last_of_count(anchors, interval, int(parts["COUNT"][0]))
    return [(weekday, anchor, end, interval) for weekday, anchor in anchors]


def _last_of_count(anchors: list[tuple[int, date]], interval: int, count: int) -> date:
    """The date of the ``count``-th occurrence across every weekday of the rule.

    ``COUNT`` counts the series, not each day: ``BYDAY=MO,WE;COUNT=4`` is two
    Mondays and two Wednesdays. Every row ending on this date reproduces exactly
    the first ``count`` occurrences.
    """
    step = timedelta(weeks=interval)
    upcoming = sorted(anchor for _, anchor in anchors)
    last = upcoming[0]
    for _ in range(max(count, 1)):
        last = upcoming.pop(0)
        upcoming.append(last + step)
        upcoming.sort()
    return last


def _skip(parsed: ParsedAbsenceIcs, title: str, reason: str) -> None:
    parsed.skipped.append(IcsSkipped(summary=title, reason=reason))


def _widen(parsed: ParsedAbsenceIcs, first: date, last: date) -> None:
    if parsed.span is None:
        parsed.span = (first, last)
    else:
        parsed.span = (min(parsed.span[0], first), max(parsed.span[1], last))


@dataclass(frozen=True)
class _Origin:
    """What every row from one VEVENT shares, whatever rule it becomes."""

    title: str
    people: list[str]
    selected: bool
    hint: str | None


def _add(parsed: ParsedAbsenceIcs, origin: _Origin, source_uid: str, **rule: Any) -> bool:
    try:
        fields = ScheduleFields(**rule)
    except ValidationError as err:
        _skip(parsed, origin.title, str(err.errors()[0]["msg"]))
        return False
    parsed.events.append(AbsenceEvent(
        source_uid=source_uid, title=origin.title, rule=fields, people=origin.people,
        selected_by_default=origin.selected, hint=origin.hint,
    ))
    return True


def parse_absence_ics(content: bytes, *, years: range | None = None) -> ParsedAbsenceIcs:
    """Absence rows from an iCalendar file. Raises ``ValueError`` on a file it can't read.

    ``years`` is only for yearly rules, which are expanded into one range per
    year; it defaults to this year and next, as the holiday importer's does.
    """
    calendar = ics.read_calendar(content)
    expand_over = years if years is not None else default_years()
    components = [c for c in calendar.walk() if c.name in ("VEVENT", "VTODO", "VJOURNAL")]
    if sum(1 for c in components if c.name == "VEVENT") > MAX_EVENTS:
        raise TooManyEvents(f"The file holds more than {MAX_EVENTS} events.")

    parsed = ParsedAbsenceIcs()
    for component in components:
        title = " ".join(str(component.get("SUMMARY", "")).split()) or "(no title)"
        if component.name != "VEVENT":
            _skip(parsed, title, f"a {component.name} is not an event")
            continue
        event: Event = component  # type: ignore[assignment]
        uid = str(event.get("UID", "")).strip()
        if not uid:
            _skip(parsed, title, "the event has no UID, so a re-import could not recognise it")
            continue
        if str(event.get("STATUS", "")).upper() == "CANCELLED":
            _skip(parsed, title, "the event is cancelled")
            continue
        if event.get("RECURRENCE-ID") is not None:
            _skip(parsed, title, "a changed occurrence of a recurring event; enter it by hand as a range")
            continue
        event_span = ics.span(event)
        if event_span is None:
            _skip(parsed, title, "the event has no start date")
            continue
        start, start_half, last, end_half = event_span
        start_half, end_half = ics.halves_override(event, start_half, end_half)
        label, truncated = ics.clean_label(event.get("SUMMARY"), "")
        if truncated:
            parsed.truncated_labels += 1

        # A personal calendar holds meetings too. Whole days and Outlook's
        # "out of office" are leave; any other timed event is offered unticked.
        selected = ics.is_all_day(event) or _is_out_of_office(event)
        origin = _Origin(
            title=title, people=_people(event), selected=selected,
            hint=None if selected else "timed event — looks like a meeting",
        )

        parts = ics.rule_parts(event)
        if parts is None:
            if _add(parsed, origin, uid, kind="range", label=label or None, start_date=start,
                    end_date=last, start_half=start_half, end_half=end_half):
                _widen(parsed, start, last)
            continue

        if event.get("RDATE") is not None:
            _skip(parsed, title, "extra dates (RDATE) are not supported")
            continue
        freq = str(parts.get("FREQ", [""])[0]).upper()

        if freq == "YEARLY":
            expanded = ics.yearly_starts(start, parts, expand_over)
            if isinstance(expanded, str):
                _skip(parsed, title, expanded)
                continue
            excluded = ics.excluded_dates(event)
            length = last - start
            for occurrence in expanded:
                if occurrence in excluded:
                    continue
                _add(parsed, origin, f"{uid}#{occurrence.year}", kind="range", label=label or None,
                     start_date=occurrence, end_date=occurrence + length,
                     start_half=start_half, end_half=end_half)
            continue

        if freq != "WEEKLY":
            _skip(parsed, title, f"repeats {freq.lower() or 'on a rule'}; only weekly and yearly events are read")
            continue
        if last != start:
            _skip(parsed, title, "a weekly event longer than one day is not supported")
            continue
        if event.get("EXDATE") is not None:
            _skip(parsed, title, "a weekly event with skipped dates; absences have no exceptions, so end the "
                                 "series or enter the gaps by hand")
            continue
        weekly = _weekly_rules(start, parts)
        if isinstance(weekly, str):
            _skip(parsed, title, weekly)
            continue
        several = len(weekly) > 1
        for weekday, anchor, end, interval in weekly:
            source_uid = f"{uid}#{_DAY_CODES[weekday]}" if several else uid
            if end is not None and end < anchor:
                continue  # an UNTIL before this weekday's first occurrence: it never happens
            if _add(parsed, origin, source_uid, kind="weekly" if interval == 1 else "interval",
                    label=label or None, start_date=anchor, end_date=end, weekday=weekday,
                    halves=_halves_of_day(start_half, end_half),
                    interval_weeks=interval if interval > 1 else None):
                _widen(parsed, anchor, end or anchor)
    return parsed


# ── matching events to members (team mode) ───────────────────────────────────

Match = Literal["attendee", "title", "none"]
_WORD = re.compile(r"\w+", re.UNICODE)


def _words(text: str) -> list[str]:
    return [word.casefold() for word in _WORD.findall(text)]


def _same_person(written: str, member_name: str) -> bool:
    """A name as a calendar writes it against a member's — either word order.

    "Anders Michel" and "Michel Anders" arrive in groups (§8.2.7); case, spacing
    and punctuation are noise, and nothing shorter than the full name counts.
    """
    written_words, member_words = _words(written), _words(member_name)
    return bool(member_words) and written_words in (member_words, member_words[::-1])


def _spans_in(title_words: list[str], name_words: list[str]) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    width = len(name_words)
    for order in (name_words, name_words[::-1]):
        for at in range(len(title_words) - width + 1):
            if title_words[at:at + width] == order:
                found.append((at, at + width))
    return found


def match_members(
    event: AbsenceEvent, members: Sequence[tuple[str, str]]
) -> tuple[list[str], Match]:
    """The ``(system_id, name)`` members an event belongs to, and how that was decided.

    Attendees first: a calendar invitation names its people outright, and an
    event naming several team members — an offsite — is one row each, as a
    multi-member create is (§3.4). Otherwise a full member name written as whole
    words in the title ("Vacation – Anna Keller"). A name that sits inside a
    longer matched one is dropped, so a member "Anna" does not also claim the
    event naming "Anna Keller". A first name alone never matches.
    """
    by_attendee = [
        member_id for member_id, name in members
        if any(_same_person(person, name) for person in event.people)
    ]
    if by_attendee:
        return by_attendee, "attendee"

    title_words = _words(event.title)
    hits: list[tuple[tuple[int, int], str]] = []
    for member_id, name in members:
        name_words = _words(name)
        if name_words:
            hits.extend((span, member_id) for span in _spans_in(title_words, name_words))
    kept = [
        member_id for span, member_id in hits
        if not any(
            other[0] <= span[0] and span[1] <= other[1] and other != span for other, _ in hits
        )
    ]
    if kept:
        return list(dict.fromkeys(kept)), "title"
    return [], "none"
