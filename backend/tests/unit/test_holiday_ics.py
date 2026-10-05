"""Reading and writing holiday calendars as iCalendar (spec/public-holidays.md §7.1, §7.2)."""
from datetime import date, datetime, timezone

import pytest

from app.models.holiday import HolidayCalendar, HolidayEntry
from app.services.holiday_ics import export_ics, parse_ics


def _ics(*events: str) -> bytes:
    body = "\r\n".join(events)
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
        f"{body}\r\nEND:VCALENDAR\r\n"
    ).encode()


def _event(summary: str, *lines: str) -> str:
    return "\r\n".join(["BEGIN:VEVENT", f"UID:{summary}@test", f"SUMMARY:{summary}", *lines, "END:VEVENT"])


def _fields(entry):
    return (entry.label, entry.start_date, entry.start_half, entry.last_day, entry.end_half)


def test_an_all_day_event_ends_the_day_before_its_exclusive_dtend():
    parsed = parse_ics(_ics(_event(
        "Easter", "DTSTART;VALUE=DATE:20260403", "DTEND;VALUE=DATE:20260407",
    )))
    assert [_fields(e) for e in parsed.entries] == [
        ("Easter", date(2026, 4, 3), "am", date(2026, 4, 6), "pm"),
    ]


def test_an_all_day_event_without_dtend_is_one_day():
    parsed = parse_ics(_ics(_event("National day", "DTSTART;VALUE=DATE:20260801")))
    assert _fields(parsed.entries[0]) == ("National day", date(2026, 8, 1), "am", date(2026, 8, 1), "pm")


def test_a_timed_afternoon_becomes_a_half_day():
    parsed = parse_ics(_ics(_event(
        "Christmas Eve", "DTSTART:20261224T120000", "DTEND:20261225T000000",
    )))
    assert _fields(parsed.entries[0]) == ("Christmas Eve", date(2026, 12, 24), "pm", date(2026, 12, 24), "pm")


def test_a_timed_morning_becomes_a_half_day():
    parsed = parse_ics(_ics(_event("Morning", "DTSTART:20261231T080000", "DTEND:20261231T120000")))
    assert _fields(parsed.entries[0])[2:] == ("am", date(2026, 12, 31), "am")


def test_a_yearly_rule_is_expanded_over_the_requested_years():
    parsed = parse_ics(_ics(_event(
        "Christmas", "DTSTART;VALUE=DATE:20201225", "RRULE:FREQ=YEARLY",
    )), from_year=2026, to_year=2027)
    assert [e.start_date for e in parsed.entries] == [date(2026, 12, 25), date(2027, 12, 25)]


def test_a_yearly_rule_honours_count_until_and_exdate():
    parsed = parse_ics(_ics(
        _event("Counted", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=YEARLY;COUNT=1"),
        _event("Until", "DTSTART;VALUE=DATE:20260501", "RRULE:FREQ=YEARLY;UNTIL=20261231"),
        _event("Excluded", "DTSTART;VALUE=DATE:20260801", "RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20270801"),
    ), from_year=2026, to_year=2027)
    assert sorted((e.label, e.start_date.year) for e in parsed.entries) == [
        ("Counted", 2026), ("Excluded", 2026), ("Until", 2026),
    ]


def test_other_recurrences_are_skipped_with_a_reason():
    parsed = parse_ics(_ics(
        _event("Stand-up", "DTSTART:20260105T090000", "DTEND:20260105T091500", "RRULE:FREQ=WEEKLY"),
        _event("Easter", "DTSTART;VALUE=DATE:20260405", "RRULE:FREQ=YEARLY;BYDAY=SU"),
    ))
    assert parsed.entries == []
    assert [s.summary for s in parsed.skipped] == ["Stand-up", "Easter"]
    assert "yearly" in parsed.skipped[0].reason
    assert "BYDAY" in parsed.skipped[1].reason


def test_a_long_summary_is_truncated_and_counted():
    parsed = parse_ics(_ics(_event("x" * 150, "DTSTART;VALUE=DATE:20260101")))
    assert len(parsed.entries[0].label) == 100
    assert parsed.truncated_labels == 1


def test_an_unreadable_file_is_refused():
    with pytest.raises(ValueError):
        parse_ics(b"this is not a calendar")


def _entry(label: str, start: date, end: date, start_half: str = "am", end_half: str = "pm") -> HolidayEntry:
    stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return HolidayEntry(
        system_id=f"id-{label}", calendar_id="c", label=label, start_date=start, end_date=end,
        start_half=start_half, end_half=end_half, created_at=stamp, modified_at=stamp,
    )


def test_export_round_trips_whole_and_half_days_exactly():
    calendar = HolidayCalendar(system_id="c", name="Switzerland", description=None)
    entries = [
        _entry("Easter", date(2026, 4, 3), date(2026, 4, 6)),
        _entry("Christmas Eve", date(2026, 12, 24), date(2026, 12, 24), start_half="pm"),
        _entry("Morning", date(2026, 12, 31), date(2026, 12, 31), end_half="am"),
    ]
    content = export_ics(calendar, entries)
    assert b"X-WR-CALNAME:Switzerland" in content
    assert b"UID:id-Easter@piplanner" in content

    back = parse_ics(content)
    assert [_fields(e) for e in back.entries] == [
        ("Easter", date(2026, 4, 3), "am", date(2026, 4, 6), "pm"),
        ("Christmas Eve", date(2026, 12, 24), "pm", date(2026, 12, 24), "pm"),
        ("Morning", date(2026, 12, 31), "am", date(2026, 12, 31), "am"),
    ]
