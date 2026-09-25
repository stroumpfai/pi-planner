"""The attribution engine (spec/team-achievement.md §4.5, §5.3), with no database.

Every figure on the Achievement screen comes from these functions, so the cases
that would not be noticed by eye — the inclusive ends, overlapping sprints, a
completion outside every sprint, an undated column — are pinned here one by one.
"""
from datetime import date

import pytest

from app.services.achievement import (
    CalendarSprint,
    CompletedItem,
    ProjectSprint,
    ProjectTotalsInput,
    achievement_per_column,
    attribute,
    committed_per_column,
    ratio,
    team_totals,
    unmeasured,
    velocity,
)

S1 = CalendarSprint("s1", date(2026, 4, 6), date(2026, 4, 17))
S2 = CalendarSprint("s2", date(2026, 4, 20), date(2026, 5, 1))
# A gap of a week, then the next PI.
S3 = CalendarSprint("s3", date(2026, 5, 11), date(2026, 5, 22))
UNDATED = CalendarSprint("u", None, None)
HALF_DATED = CalendarSprint("h", date(2026, 6, 1), None)
CALENDAR = [S1, S2, S3]


def item(completed_on: date | None, effort: float | None = 3.0, *, key: str = "i",
         item_type: str = "story", user_id: int | None = None) -> CompletedItem:
    return CompletedItem(
        system_id=key, user_id=user_id, title=f"Item {key}", item_type=item_type,
        effort=effort, completed_on=completed_on,
    )


# ── attribute ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("day", "expected"),
    [
        (date(2026, 4, 6), "s1"),  # first day, inclusive
        (date(2026, 4, 10), "s1"),  # inside
        (date(2026, 4, 17), "s1"),  # last day, inclusive
        (date(2026, 4, 18), None),  # the weekend between two sprints
        (date(2026, 4, 20), "s2"),
        (date(2026, 5, 1), "s2"),
    ],
)
def test_attribution_is_inclusive_at_both_ends(day: date, expected: str | None) -> None:
    assert attribute(day, CALENDAR) == expected


@pytest.mark.parametrize(
    "day",
    [date(2026, 4, 5), date(2026, 5, 6), date(2026, 5, 23), date(2027, 1, 1)],
    ids=["before the calendar", "gap between PIs", "day after the end", "long after"],
)
def test_a_completion_in_no_sprint_is_attributed_to_nothing(day: date) -> None:
    assert attribute(day, CALENDAR) is None


def test_overlapping_sprints_resolve_to_the_earliest_starting() -> None:
    early = CalendarSprint("early", date(2026, 4, 6), date(2026, 4, 20))
    late = CalendarSprint("late", date(2026, 4, 13), date(2026, 4, 24))
    # Calendar order must not matter: the later sprint listed first still loses.
    assert attribute(date(2026, 4, 15), [late, early]) == "early"
    assert attribute(date(2026, 4, 15), [early, late]) == "early"
    # Past the earlier one's end, only the later one matches.
    assert attribute(date(2026, 4, 22), [late, early]) == "late"


def test_a_tie_on_the_start_goes_to_the_first_in_calendar_order() -> None:
    a = CalendarSprint("a", date(2026, 4, 6), date(2026, 4, 17))
    b = CalendarSprint("b", date(2026, 4, 6), date(2026, 4, 24))
    assert attribute(date(2026, 4, 10), [a, b]) == "a"
    assert attribute(date(2026, 4, 10), [b, a]) == "b"


def test_undated_and_half_dated_sprints_match_nothing() -> None:
    assert attribute(date(2026, 6, 2), [UNDATED, HALF_DATED]) is None


def test_an_empty_calendar_attributes_nothing() -> None:
    assert attribute(date(2026, 4, 10), []) is None


# ── achievement_per_column ───────────────────────────────────────────────────


def test_points_land_in_the_sprint_containing_the_date() -> None:
    result = achievement_per_column(
        CALENDAR,
        CALENDAR,
        [
            item(date(2026, 4, 6), 2, key="a"),
            item(date(2026, 4, 17), 3, key="b"),
            item(date(2026, 5, 22), 5, key="c"),
        ],
    )
    assert result.achieved == [5.0, 0.0, 5.0]
    assert [[i.system_id for i in cell] for cell in result.achieved_items] == [["a", "b"], [], ["c"]]
    assert result.outside_calendar_points == 0.0
    assert result.done_undated_count == 0


def test_overlapping_sprints_count_a_point_once() -> None:
    early = CalendarSprint("early", date(2026, 4, 6), date(2026, 4, 20))
    late = CalendarSprint("late", date(2026, 4, 13), date(2026, 4, 24))
    result = achievement_per_column([early, late], [early, late], [item(date(2026, 4, 15), 8)])
    assert result.achieved == [8.0, 0.0]
    assert sum(a or 0 for a in result.achieved) == 8.0


def test_completions_outside_every_sprint_are_surfaced_not_folded() -> None:
    result = achievement_per_column(
        CALENDAR,
        CALENDAR,
        [
            item(date(2026, 4, 1), 1, key="before"),
            item(date(2026, 5, 6), 2, key="gap"),
            item(date(2026, 6, 30), 4, key="after"),
            item(date(2026, 4, 8), 8, key="in"),
        ],
    )
    assert result.achieved == [8.0, 0.0, 0.0]
    assert result.outside_calendar_points == 7.0


def test_an_undated_column_is_none_and_lists_nothing() -> None:
    columns = [S1, UNDATED, S2]
    result = achievement_per_column(columns, columns, [item(date(2026, 4, 8), 3)])
    assert result.achieved == [3.0, None, 0.0]
    assert result.achieved_items[1] == []


def test_a_dated_column_with_nothing_completed_is_zero_not_none() -> None:
    result = achievement_per_column([S1], [S1], [])
    assert result.achieved == [0.0]


def test_a_null_effort_is_worth_nothing_but_still_listed() -> None:
    result = achievement_per_column([S1], [S1], [item(date(2026, 4, 8), None, key="x")])
    assert result.achieved == [0.0]
    assert [i.system_id for i in result.achieved_items[0]] == ["x"]


def test_a_null_effort_outside_the_calendar_adds_nothing() -> None:
    result = achievement_per_column([S1], [S1], [item(date(2027, 1, 1), None)])
    assert result.outside_calendar_points == 0.0


def test_done_but_undated_items_are_counted_not_attributed() -> None:
    result = achievement_per_column(
        [S1], [S1], [item(None, 5, key="a"), item(None, None, key="b"), item(date(2026, 4, 8), 1)]
    )
    assert result.achieved == [1.0]
    assert result.done_undated_count == 2
    assert result.outside_calendar_points == 0.0


def test_the_window_hides_columns_without_moving_points() -> None:
    """Attribution uses the full calendar: a point in a hidden sprint is not 'outside'."""
    items = [item(date(2026, 4, 8), 3, key="s1"), item(date(2026, 4, 22), 5, key="s2")]
    full = achievement_per_column(CALENDAR, CALENDAR, items)
    windowed = achievement_per_column([S2], CALENDAR, items)
    assert full.achieved == [3.0, 5.0, 0.0]
    assert windowed.achieved == [5.0]
    assert windowed.outside_calendar_points == 0.0


def test_the_window_does_not_reassign_an_overlap() -> None:
    """With the earlier overlapping sprint hidden, its points stay with it, unseen."""
    early = CalendarSprint("early", date(2026, 4, 6), date(2026, 4, 20))
    late = CalendarSprint("late", date(2026, 4, 13), date(2026, 4, 24))
    result = achievement_per_column([late], [early, late], [item(date(2026, 4, 15), 8)])
    assert result.achieved == [0.0]
    assert result.outside_calendar_points == 0.0


def test_items_in_a_cell_are_listed_in_date_order() -> None:
    result = achievement_per_column(
        [S1],
        [S1],
        [
            item(date(2026, 4, 10), 1, key="late", user_id=1),
            item(date(2026, 4, 7), 1, key="early", user_id=9),
            item(date(2026, 4, 7), 1, key="early-no-id"),
        ],
    )
    assert [i.system_id for i in result.achieved_items[0]] == ["early-no-id", "early", "late"]


def test_an_attributed_sprint_whose_column_is_undated_is_ignored() -> None:
    """Inconsistent inputs — a dated calendar entry, the same id undated as a column."""
    column = CalendarSprint("s1", None, None)
    result = achievement_per_column([column], [S1], [item(date(2026, 4, 8), 3)])
    assert result.achieved == [None]
    assert result.achieved_items == [[]]


def test_unmeasured_is_none_everywhere() -> None:
    result = unmeasured([S1, UNDATED], done_undated_count=0)
    assert result.achieved == [None, None]
    assert result.achieved_items == [[], []]
    assert result.outside_calendar_points == 0.0


# ── committed ────────────────────────────────────────────────────────────────


def test_committed_uses_the_columns_own_sprint_for_the_anchor() -> None:
    sprints = [
        ProjectSprint("s1", S1.start_date, S1.end_date, 13),
        # Same dates, different PI of the same project: not this column's sprint.
        ProjectSprint("dup", S1.start_date, S1.end_date, 100),
    ]
    assert committed_per_column([S1], sprints) == [13]


def test_committed_matches_another_projects_sprint_by_identical_dates() -> None:
    sprints = [
        ProjectSprint("b1", S1.start_date, S1.end_date, 8),
        ProjectSprint("b2", S2.start_date, date(2026, 4, 30), 5),  # a day short: no match
    ]
    assert committed_per_column([S1, S2, S3], sprints) == [8, None, None]


def test_committed_is_zero_for_a_matching_sprint_with_nothing_placed() -> None:
    assert committed_per_column([S1], [ProjectSprint("b1", S1.start_date, S1.end_date, 0.0)]) == [0.0]


def test_committed_is_none_for_an_undated_column() -> None:
    assert committed_per_column([UNDATED], [ProjectSprint("u", None, None, 5)]) == [None]


def test_committed_sums_several_sprints_on_identical_dates() -> None:
    sprints = [
        ProjectSprint("b1", S1.start_date, S1.end_date, 3),
        ProjectSprint("b2", S1.start_date, S1.end_date, 4),
    ]
    assert committed_per_column([S1], sprints) == [7]


# ── velocity, totals ─────────────────────────────────────────────────────────


def test_ratio_is_none_when_unknown_or_over_nothing() -> None:
    assert ratio(10, 4) == 2.5
    assert ratio(None, 4) is None
    assert ratio(10, None) is None
    assert ratio(10, 0) is None
    assert ratio(0, 4) == 0.0


def test_velocity_is_achieved_over_pd_given() -> None:
    assert velocity([21, None, 5, 0], [16.8, 10, 0, 4]) == [pytest.approx(1.25), None, None, 0.0]


def test_team_totals_convert_points_through_the_factor() -> None:
    totals = team_totals(
        [
            ProjectTotalsInput(in_pd_total=True, units_per_pd=1.5, achieved=[21, 30]),
            ProjectTotalsInput(in_pd_total=True, units_per_pd=0.5, achieved=[4, None]),
        ],
        [20.0, 25.0],
    )
    assert totals.achieved_pd == [pytest.approx(22.0), pytest.approx(20.0)]
    assert totals.available_pd == [20.0, 25.0]
    assert totals.realised == [pytest.approx(1.1), pytest.approx(0.8)]


def test_a_manual_project_is_kept_out_of_the_pd_total() -> None:
    totals = team_totals(
        [
            ProjectTotalsInput(in_pd_total=True, units_per_pd=2.0, achieved=[10]),
            ProjectTotalsInput(in_pd_total=False, units_per_pd=1.0, achieved=[99]),
        ],
        [10.0],
    )
    assert totals.achieved_pd == [5.0]
    assert totals.realised == [0.5]


def test_no_contributing_project_means_no_total() -> None:
    totals = team_totals(
        [
            ProjectTotalsInput(in_pd_total=False, units_per_pd=1.0, achieved=[10]),
            ProjectTotalsInput(in_pd_total=True, units_per_pd=1.0, achieved=[None]),
        ],
        [10.0],
    )
    assert totals.achieved_pd == [None]
    assert totals.realised == [None]


def test_an_undated_column_has_no_team_total() -> None:
    totals = team_totals([ProjectTotalsInput(True, 1.0, [None, 3])], [None, 6.0])
    assert totals.achieved_pd == [None, 3.0]
    assert totals.realised == [None, 0.5]


def test_realised_over_zero_available_is_none() -> None:
    totals = team_totals([ProjectTotalsInput(True, 1.0, [4])], [0.0])
    assert totals.achieved_pd == [4.0]
    assert totals.realised == [None]


def test_realised_is_not_clamped_above_one() -> None:
    totals = team_totals([ProjectTotalsInput(True, 1.0, [15])], [10.0])
    assert totals.realised == [1.5]


def test_a_non_positive_factor_never_divides() -> None:
    totals = team_totals([ProjectTotalsInput(True, 0.0, [15])], [10.0])
    assert totals.achieved_pd == [None]


def test_no_projects_no_columns() -> None:
    totals = team_totals([], [])
    assert (totals.achieved_pd, totals.available_pd, totals.realised) == ([], [], [])
