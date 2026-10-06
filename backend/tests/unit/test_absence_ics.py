"""Calendar files as absences (spec/teams.md §7.4.1)."""
from datetime import date

import pytest

from app.services.absence_ics import (
    MAX_EVENTS,
    TooManyEvents,
    match_members,
    parse_absence_ics,
)
from app.services.occurrences import ScheduleRule, occurrence_days


def _ics(*events: str) -> bytes:
    body = "\r\n".join(events)
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
        f"{body}\r\nEND:VCALENDAR\r\n"
    ).encode()


def _event(uid: str, summary: str, *lines: str) -> str:
    return "\r\n".join(["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{summary}", *lines, "END:VEVENT"])


def _only(content: bytes):
    parsed = parse_absence_ics(content, years=range(2026, 2028))
    assert parsed.skipped == []
    assert len(parsed.events) == 1
    return parsed.events[0]


def _dates(rule, first: date, last: date) -> list[date]:
    fields = rule.model_dump()
    return list(occurrence_days(ScheduleRule(
        kind=fields["kind"], start_date=fields["start_date"], end_date=fields["end_date"],
        weekday=fields["weekday"], interval_weeks=fields["interval_weeks"],
    ), first, last))


# ── single events ────────────────────────────────────────────────────────────


def test_an_all_day_event_is_a_range_ending_the_day_before_its_exclusive_dtend():
    event = _only(_ics(_event("v1", "Vacation", "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261107")))
    assert event.source_uid == "v1"
    assert event.rule.kind == "range"
    assert (event.rule.start_date, event.rule.end_date) == (date(2026, 11, 2), date(2026, 11, 6))
    assert (event.rule.start_half, event.rule.end_half) == ("am", "pm")
    assert event.rule.label == "Vacation"
    assert event.selected_by_default is True
    assert event.repeats == "single"


def test_a_timed_afternoon_is_a_half_day_range():
    event = _only(_ics(_event("d1", "Dentist", "DTSTART:20261103T133000", "DTEND:20261103T170000",
                              "X-MICROSOFT-CDO-BUSYSTATUS:OOF")))
    assert (event.rule.start_date, event.rule.start_half, event.rule.end_half) == (date(2026, 11, 3), "pm", "pm")


def test_halves_written_by_this_app_win_over_clock_times():
    event = _only(_ics(_event("h1", "Off", "DTSTART:20261103T080000", "DTEND:20261104T120000",
                              "X-PIPLANNER-START-HALF:pm", "X-PIPLANNER-END-HALF:am")))
    assert (event.rule.start_half, event.rule.end_half) == ("pm", "am")


def test_a_timed_event_is_offered_unticked_unless_it_is_out_of_office():
    parsed = parse_absence_ics(_ics(
        _event("m1", "Sprint review", "DTSTART:20261103T100000", "DTEND:20261103T110000"),
        _event("o1", "Doctor", "DTSTART:20261104T080000", "DTEND:20261104T120000",
               "X-MICROSOFT-CDO-INTENDEDSTATUS:OOF"),
        _event("a1", "Leave", "DTSTART;VALUE=DATE:20261105"),
    ))
    selected = {e.source_uid: (e.selected_by_default, e.hint) for e in parsed.events}
    assert selected["m1"] == (False, "timed event — looks like a meeting")
    assert selected["o1"] == (True, None)
    assert selected["a1"] == (True, None)


def test_a_long_title_is_cut_to_the_label_limit_and_counted():
    parsed = parse_absence_ics(_ics(_event("l1", "x" * 140, "DTSTART;VALUE=DATE:20261105")))
    assert len(parsed.events[0].rule.label or "") == 100
    assert parsed.truncated_labels == 1


def test_an_untitled_event_has_no_label():
    parsed = parse_absence_ics(_ics("BEGIN:VEVENT\r\nUID:n1\r\nDTSTART;VALUE=DATE:20261105\r\nEND:VEVENT"))
    assert parsed.events[0].rule.label is None
    assert parsed.events[0].title == "(no title)"


def test_the_span_runs_from_the_first_to_the_last_day_touched():
    parsed = parse_absence_ics(_ics(
        _event("a", "A", "DTSTART;VALUE=DATE:20261105"),
        _event("b", "B", "DTSTART;VALUE=DATE:20261220", "DTEND;VALUE=DATE:20261224"),
    ))
    assert parsed.span == (date(2026, 11, 5), date(2026, 12, 23))


# ── weekly rules stay rules ──────────────────────────────────────────────────


def test_a_weekly_afternoon_becomes_one_weekly_rule():
    # 2026-11-04 is a Wednesday.
    event = _only(_ics(_event("w1", "Part-time", "DTSTART:20261104T130000", "DTEND:20261104T170000",
                              "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270630T000000Z")))
    assert event.rule.kind == "weekly"
    assert event.repeats == "weekly"
    assert (event.rule.weekday, event.rule.halves) == (2, ["pm"])
    assert (event.rule.start_date, event.rule.end_date) == (date(2026, 11, 4), date(2027, 6, 30))


def test_an_all_day_weekly_rule_covers_both_halves():
    event = _only(_ics(_event("w2", "Off Fridays", "DTSTART;VALUE=DATE:20261106", "RRULE:FREQ=WEEKLY")))
    assert (event.rule.weekday, event.rule.halves, event.rule.end_date) == (4, ["am", "pm"], None)


def test_every_other_week_becomes_an_interval_rule():
    event = _only(_ics(_event("i1", "Every other Friday", "DTSTART;VALUE=DATE:20261106",
                              "RRULE:FREQ=WEEKLY;INTERVAL=2")))
    assert (event.rule.kind, event.rule.interval_weeks) == ("interval", 2)
    assert _dates(event.rule, date(2026, 11, 1), date(2026, 11, 30)) == [date(2026, 11, 6), date(2026, 11, 20)]


def test_count_becomes_the_date_of_the_last_occurrence():
    event = _only(_ics(_event("c1", "Course", "DTSTART;VALUE=DATE:20261102", "RRULE:FREQ=WEEKLY;COUNT=3")))
    assert event.rule.end_date == date(2026, 11, 16)


def test_several_weekdays_become_one_rule_each_with_suffixed_uids():
    # From a Wednesday, every other week on Monday and Friday: Outlook draws Fri 6,
    # then Mon 16 and Fri 20 — the Monday of the first week is already past.
    parsed = parse_absence_ics(_ics(_event("s1", "Split", "DTSTART;VALUE=DATE:20261104",
                                           "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=3")))
    by_uid = {e.source_uid: e.rule for e in parsed.events}
    assert set(by_uid) == {"s1#MO", "s1#FR"}
    window = (date(2026, 11, 1), date(2026, 12, 31))
    drawn = sorted(_dates(by_uid["s1#MO"], *window) + _dates(by_uid["s1#FR"], *window))
    assert drawn == [date(2026, 11, 6), date(2026, 11, 16), date(2026, 11, 20)]


def test_unsupported_weekly_shapes_are_skipped_with_a_reason():
    parsed = parse_absence_ics(_ics(
        _event("x1", "Holes", "DTSTART;VALUE=DATE:20261106", "RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20261113"),
        _event("x2", "Long", "DTSTART;VALUE=DATE:20261106", "DTEND;VALUE=DATE:20261108", "RRULE:FREQ=WEEKLY"),
        _event("x3", "Daily", "DTSTART;VALUE=DATE:20261106", "RRULE:FREQ=DAILY"),
        _event("x4", "Monthly", "DTSTART;VALUE=DATE:20261106", "RRULE:FREQ=MONTHLY"),
        _event("x5", "Extra", "DTSTART;VALUE=DATE:20261106", "RRULE:FREQ=WEEKLY", "RDATE;VALUE=DATE:20261110"),
        _event("x6", "Moved", "DTSTART;VALUE=DATE:20261114", "RECURRENCE-ID;VALUE=DATE:20261113"),
        _event("x7", "Off", "DTSTART;VALUE=DATE:20261106", "STATUS:CANCELLED"),
        "BEGIN:VTODO\r\nUID:t1\r\nSUMMARY:Task\r\nEND:VTODO",
        "BEGIN:VEVENT\r\nSUMMARY:No uid\r\nDTSTART;VALUE=DATE:20261106\r\nEND:VEVENT",
    ))
    assert parsed.events == []
    reasons = {s.summary: s.reason for s in parsed.skipped}
    assert "no exceptions" in reasons["Holes"]
    assert "longer than one day" in reasons["Long"]
    assert "daily" in reasons["Daily"]
    assert "monthly" in reasons["Monthly"]
    assert "RDATE" in reasons["Extra"]
    assert "changed occurrence" in reasons["Moved"]
    assert "cancelled" in reasons["Off"]
    assert "not an event" in reasons["Task"]
    assert "UID" in reasons["No uid"]


# ── yearly rules are expanded ────────────────────────────────────────────────


def test_a_yearly_rule_becomes_one_range_per_year_with_the_year_in_its_uid():
    parsed = parse_absence_ics(
        _ics(_event("y1", "Birthday", "DTSTART;VALUE=DATE:20200315", "RRULE:FREQ=YEARLY")),
        years=range(2026, 2028),
    )
    assert [(e.source_uid, e.rule.start_date) for e in parsed.events] == [
        ("y1#2026", date(2026, 3, 15)), ("y1#2027", date(2027, 3, 15)),
    ]
    # All-day, but yearly: a birthday far more often than leave, so offered unticked.
    assert {(e.repeats, e.selected_by_default, e.hint) for e in parsed.events} == {
        ("yearly", False, "repeats yearly — a birthday or anniversary?"),
    }
    # Yearly rows do not stretch the span: a birthday from 2020 must not open the window there.
    assert parsed.span is None


# ── the file as a whole ──────────────────────────────────────────────────────


def test_an_unreadable_file_is_refused():
    with pytest.raises(ValueError):
        parse_absence_ics(b"not a calendar")


def test_a_file_with_too_many_events_is_refused():
    events = [_event(f"e{i}", "E", "DTSTART;VALUE=DATE:20261106") for i in range(MAX_EVENTS + 1)]
    with pytest.raises(TooManyEvents):
        parse_absence_ics(_ics(*events))


# ── matching events to members ───────────────────────────────────────────────

_TEAM = [("anna", "Anna Keller"), ("ben", "Ben Ott"), ("ann", "Ann"), ("mark", "Mark Weber")]


def _event_for(summary: str, *lines: str):
    return parse_absence_ics(_ics(_event("u", summary, "DTSTART;VALUE=DATE:20261106", *lines))).events[0]


def test_attendees_decide_first_and_fan_out():
    event = _event_for(
        "Offsite",
        "ATTENDEE;CN=Anna Keller:mailto:anna@example.com",
        "ATTENDEE;CN=\"Ott, Ben\":mailto:ben@example.com",
        "ATTENDEE;CN=Stranger:mailto:x@example.com",
    )
    assert match_members(event, _TEAM) == (["anna", "ben"], "attendee")


def test_the_organizer_counts_as_a_person():
    event = _event_for("Vacation", "ORGANIZER;CN=Mark Weber:mailto:m@example.com")
    assert match_members(event, _TEAM) == (["mark"], "attendee")


def test_a_full_name_in_the_title_matches_in_either_order():
    assert match_members(_event_for("Vacation – Anna Keller"), _TEAM) == (["anna"], "title")
    assert match_members(_event_for("KELLER Anna: leave"), _TEAM) == (["anna"], "title")


def test_a_name_inside_a_longer_matched_name_is_dropped():
    # Member "Ann" is not inside "Anna" — only whole words count.
    assert match_members(_event_for("Anna Keller off"), _TEAM) == (["anna"], "title")


def test_a_first_name_alone_never_matches():
    assert match_members(_event_for("Mark the release"), _TEAM) == ([], "none")


def test_two_names_in_a_title_fan_out():
    assert match_members(_event_for("Ben Ott and Anna Keller away"), _TEAM) == (["anna", "ben"], "title")
