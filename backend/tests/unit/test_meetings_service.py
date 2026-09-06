"""The meeting seam the capacity engine reads (spec/teams.md §3.5, §5.4 step 4).

`team_capacity.py` decides what an occurrence *costs* — that arithmetic, clamp
included, is tested in `test_team_capacity.py` against hand-computed hours. What
is tested here is the layer that answers "how many minutes of meeting start in
this half-day, for this member": occurrence generation, attendance, and the two
places it deliberately differs from the absence lookup.

Minutes rather than hours, and unclamped, because clamping needs the member's
contract and this layer has never heard of it.
"""
from datetime import date
from types import SimpleNamespace

from app.services.meetings import build_lookup, describe, occurrences_of

WINDOW = (date(2026, 9, 1), date(2026, 9, 30))


def _meeting(**over: object) -> SimpleNamespace:
    """A meeting row as the service sees it — duck-typed, no session in sight."""
    attendees = over.pop("attendees", ["m-1"])
    row = SimpleNamespace(
        system_id="mt-1",
        team_id="t-1",
        title="Sprint planning",
        kind="range",
        start_date=date(2026, 9, 7),
        end_date=None,
        weekday=None,
        interval_weeks=None,
        half="am",
        duration_minutes=120,
        attendees=[SimpleNamespace(member_id=member_id) for member_id in attendees],
    )
    for key, value in over.items():
        setattr(row, key, value)
    return row


# ── occurrences ───────────────────────────────────────────────────────────────


def test_a_one_day_meeting_occurs_once():
    assert occurrences_of(_meeting(), *WINDOW) == [date(2026, 9, 7)]


def test_a_range_meeting_occurs_on_every_day_of_the_block():
    """Three days of workshop is three occurrences, not one long one (§11)."""
    row = _meeting(start_date=date(2026, 9, 7), end_date=date(2026, 9, 9))
    assert occurrences_of(row, *WINDOW) == [date(2026, 9, 7), date(2026, 9, 8), date(2026, 9, 9)]


def test_a_weekly_meeting_expands_only_inside_the_window():
    row = _meeting(kind="weekly", start_date=date(2020, 1, 6), weekday=0, end_date=None)
    days = occurrences_of(row, date(2026, 9, 1), date(2026, 9, 15))
    assert days == [date(2026, 9, 7), date(2026, 9, 14)]


def test_an_interval_meeting_keeps_to_its_fortnight():
    row = _meeting(kind="interval", start_date=date(2026, 9, 4), weekday=4, interval_weeks=2)
    assert occurrences_of(row, *WINDOW) == [date(2026, 9, 4), date(2026, 9, 18)]


# ── the lookup ────────────────────────────────────────────────────────────────


def test_minutes_land_in_the_half_the_meeting_starts_in():
    lookup = build_lookup([_meeting(half="pm")], *WINDOW)
    assert lookup("m-1", date(2026, 9, 7)) == {"pm": 120.0}


def test_a_day_with_no_meeting_reports_nothing():
    lookup = build_lookup([_meeting()], *WINDOW)
    assert lookup("m-1", date(2026, 9, 8)) == {}


def test_only_attendees_are_charged():
    lookup = build_lookup([_meeting(attendees=["m-1"])], *WINDOW)
    assert lookup("m-2", date(2026, 9, 7)) == {}


def test_a_meeting_nobody_attends_costs_nothing():
    """Allowed, and free: a column with an empty matrix (§11)."""
    lookup = build_lookup([_meeting(attendees=[])], *WINDOW)
    assert lookup("m-1", date(2026, 9, 7)) == {}


def test_two_meetings_in_the_same_half_sum():
    """Where absences union, meetings **sum** — two bookings really are two.

    Nothing is clamped here: the day's ceiling belongs to the engine, which is
    the only layer that knows how many hours the member has (§5.4).
    """
    lookup = build_lookup(
        [_meeting(), _meeting(system_id="mt-2", duration_minutes=60)], *WINDOW
    )
    assert lookup("m-1", date(2026, 9, 7)) == {"am": 180.0}


def test_a_long_meeting_is_reported_whole_and_clamped_elsewhere():
    lookup = build_lookup([_meeting(duration_minutes=480)], *WINDOW)
    assert lookup("m-1", date(2026, 9, 7)) == {"am": 480.0}


def test_each_day_of_a_range_costs_the_full_duration():
    row = _meeting(start_date=date(2026, 9, 7), end_date=date(2026, 9, 8))
    lookup = build_lookup([row], *WINDOW)
    assert lookup("m-1", date(2026, 9, 7)) == {"am": 120.0}
    assert lookup("m-1", date(2026, 9, 8)) == {"am": 120.0}


# ── the sentence the column head shows ────────────────────────────────────────


def test_a_one_off_names_its_day_and_half():
    assert describe(_meeting()) == "2026-09-07, am"


def test_a_block_says_it_repeats_each_day():
    row = _meeting(start_date=date(2026, 9, 7), end_date=date(2026, 9, 9))
    assert describe(row) == "2026-09-07 – 2026-09-09, am each day"


def test_a_weekly_meeting_says_it_is_ongoing_when_it_has_no_end():
    row = _meeting(kind="weekly", start_date=date(2026, 9, 1), weekday=1)
    assert describe(row) == "every Tuesday am, from 2026-09-01, ongoing"


def test_an_interval_meeting_names_the_fortnight_and_its_end():
    row = _meeting(
        kind="interval",
        start_date=date(2026, 9, 4),
        weekday=4,
        interval_weeks=2,
        half="pm",
        end_date=date(2026, 12, 18),
    )
    assert describe(row) == "every 2nd Friday pm, from 2026-09-04 until 2026-12-18"
