"""The schedule rule, expanded (spec/teams.md §3.4).

Hand-counted dates, deliberately: the generator's job is to say which Fridays
"every second Friday" means, and a test that recomputes the rule to check it
would agree with any bug the rule has.
"""
from datetime import date

import pytest

from app.services.occurrences import ScheduleRule, describe, half_days, occurrence_days


def days(rule: ScheduleRule, start: str, end: str) -> list[str]:
    return [d.isoformat() for d in occurrence_days(rule, date.fromisoformat(start), date.fromisoformat(end))]


def halves(rule: ScheduleRule, start: str, end: str) -> list[tuple[str, str]]:
    return [
        (d.isoformat(), h)
        for d, h in half_days(rule, date.fromisoformat(start), date.fromisoformat(end))
    ]


# ── range ─────────────────────────────────────────────────────────────────────


def test_one_day_range_covers_both_halves():
    rule = ScheduleRule(kind="range", start_date=date(2026, 12, 25))
    assert halves(rule, "2026-12-01", "2026-12-31") == [("2026-12-25", "am"), ("2026-12-25", "pm")]


def test_one_day_morning_only():
    """"Just Tuesday morning" is a one-day range ending at noon (§3.4)."""
    rule = ScheduleRule(kind="range", start_date=date(2026, 9, 14), end_half="am")
    assert halves(rule, "2026-09-01", "2026-09-30") == [("2026-09-14", "am")]


def test_one_day_afternoon_only():
    rule = ScheduleRule(kind="range", start_date=date(2026, 9, 14), start_half="pm")
    assert halves(rule, "2026-09-01", "2026-09-30") == [("2026-09-14", "pm")]


def test_range_is_partial_only_at_its_ends():
    """Friday afternoon to Monday morning: three days, four half-days."""
    rule = ScheduleRule(
        kind="range",
        start_date=date(2026, 9, 11),
        end_date=date(2026, 9, 14),
        start_half="pm",
        end_half="am",
    )
    assert halves(rule, "2026-09-01", "2026-09-30") == [
        ("2026-09-11", "pm"),
        ("2026-09-12", "am"),
        ("2026-09-12", "pm"),
        ("2026-09-13", "am"),
        ("2026-09-13", "pm"),
        ("2026-09-14", "am"),
    ]


def test_range_clips_to_the_window():
    rule = ScheduleRule(kind="range", start_date=date(2026, 7, 20), end_date=date(2026, 7, 31))
    assert days(rule, "2026-07-25", "2026-07-27") == ["2026-07-25", "2026-07-26", "2026-07-27"]


def test_range_outside_the_window_yields_nothing():
    rule = ScheduleRule(kind="range", start_date=date(2026, 7, 20), end_date=date(2026, 7, 31))
    assert days(rule, "2026-09-01", "2026-09-30") == []


# ── weekly ────────────────────────────────────────────────────────────────────


def test_weekly_hits_every_matching_weekday():
    rule = ScheduleRule(kind="weekly", start_date=date(2026, 3, 1), weekday=2, halves=("pm",))
    assert days(rule, "2026-03-01", "2026-03-31") == [
        "2026-03-04", "2026-03-11", "2026-03-18", "2026-03-25",
    ]


def test_weekly_anchors_on_the_first_matching_day_on_or_after_start():
    """1 March 2026 is a Sunday; the first Wednesday after it is the 4th."""
    rule = ScheduleRule(kind="weekly", start_date=date(2026, 3, 1), weekday=2, halves=("pm",))
    assert days(rule, "2026-01-01", "2026-03-10")[0] == "2026-03-04"


def test_weekly_respects_an_end_date():
    rule = ScheduleRule(
        kind="weekly",
        start_date=date(2026, 3, 1),
        end_date=date(2026, 3, 18),
        weekday=2,
        halves=("pm",),
    )
    assert days(rule, "2026-01-01", "2026-12-31") == ["2026-03-04", "2026-03-11", "2026-03-18"]


def test_open_ended_weekly_is_bounded_only_by_the_window():
    rule = ScheduleRule(kind="weekly", start_date=date(2020, 1, 6), weekday=0, halves=("am", "pm"))
    assert days(rule, "2026-09-01", "2026-09-30") == [
        "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28",
    ]


def test_weekly_covers_only_the_halves_it_names():
    rule = ScheduleRule(kind="weekly", start_date=date(2026, 3, 1), weekday=2, halves=("pm",))
    assert halves(rule, "2026-03-01", "2026-03-07") == [("2026-03-04", "pm")]


# ── interval ──────────────────────────────────────────────────────────────────


def test_interval_falls_every_n_weeks_from_the_anchor():
    rule = ScheduleRule(
        kind="interval", start_date=date(2026, 9, 4), weekday=4, halves=("am",), interval_weeks=2
    )
    assert days(rule, "2026-09-01", "2026-11-01") == [
        "2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30",
    ]


def test_interval_is_anchored_not_parity_bound_across_the_year_boundary():
    """Week 52 can be followed by week 1; an anchor has no such seam (§3.4)."""
    rule = ScheduleRule(
        kind="interval", start_date=date(2026, 12, 18), weekday=4, halves=("am",), interval_weeks=2
    )
    assert days(rule, "2026-12-01", "2027-02-01") == [
        "2026-12-18", "2027-01-01", "2027-01-15", "2027-01-29",
    ]


def test_two_members_can_sit_on_opposite_fortnights():
    a = ScheduleRule(
        kind="interval", start_date=date(2026, 9, 4), weekday=4, halves=("am",), interval_weeks=2
    )
    b = ScheduleRule(
        kind="interval", start_date=date(2026, 9, 11), weekday=4, halves=("am",), interval_weeks=2
    )
    assert set(days(a, "2026-09-01", "2026-10-01")).isdisjoint(days(b, "2026-09-01", "2026-10-01"))


def test_interval_skips_forward_without_walking_from_a_distant_anchor():
    rule = ScheduleRule(
        kind="interval", start_date=date(2019, 1, 4), weekday=4, halves=("am",), interval_weeks=3
    )
    # 2019-01-04 is a Friday; 134 three-week steps later is 2026-09-18, and the
    # next falls in October — so September holds exactly one.
    assert days(rule, "2026-09-01", "2026-09-30") == ["2026-09-18"]
    assert days(rule, "2026-10-01", "2026-10-31") == ["2026-10-09", "2026-10-30"]


@pytest.mark.parametrize("weeks", [2, 3, 4, 52])
def test_interval_spacing_is_exactly_n_weeks(weeks: int):
    rule = ScheduleRule(
        kind="interval",
        start_date=date(2026, 1, 5),
        weekday=0,
        halves=("am",),
        interval_weeks=weeks,
    )
    got = [date.fromisoformat(d) for d in days(rule, "2026-01-01", "2029-12-31")]
    assert all((b - a).days == weeks * 7 for a, b in zip(got, got[1:]))


# ── window edges ──────────────────────────────────────────────────────────────


def test_an_inverted_window_yields_nothing():
    rule = ScheduleRule(kind="range", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
    assert days(rule, "2026-06-01", "2026-05-01") == []


def test_a_recurrence_with_no_weekday_yields_nothing():
    """Unreachable through the schemas, and still total here rather than raising."""
    assert days(ScheduleRule(kind="weekly", start_date=date(2026, 1, 1)), "2026-01-01", "2026-12-31") == []


# ── words ─────────────────────────────────────────────────────────────────────


def test_describe_names_the_fortnight_and_says_it_is_ongoing():
    rule = ScheduleRule(
        kind="interval", start_date=date(2026, 9, 4), weekday=4, halves=("am",), interval_weeks=2
    )
    assert describe(rule) == "every 2nd Friday am, from 2026-09-04, ongoing"


def test_describe_a_one_day_range():
    assert describe(ScheduleRule(kind="range", start_date=date(2026, 12, 25))) == (
        "2026-12-25, both halves"
    )
