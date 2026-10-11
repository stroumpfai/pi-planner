"""Days of a sprint, named by their place in it (ADR 0013)."""
from datetime import date

from app.services.sprint_days import boundary_days, sprint_day

# Thursday 2026-09-03 to Sunday 2026-09-13: stored ending on a weekend.
SPAN = (date(2026, 9, 3), date(2026, 9, 13))


def test_the_first_and_last_day_are_working_days():
    """A sprint ending on a Sunday ends, for a meeting, on the Friday."""
    assert sprint_day(SPAN, "first") == date(2026, 9, 3)
    assert sprint_day(SPAN, "last") == date(2026, 9, 11)


def test_offsets_count_working_days_and_skip_the_weekend():
    assert sprint_day(SPAN, "first", 2) == date(2026, 9, 7)  # Thu, Fri, then Monday
    assert sprint_day(SPAN, "last", 1) == date(2026, 9, 10)


def test_an_offset_past_the_sprint_has_no_day():
    """Seven working days; the eighth would belong to the next sprint."""
    assert sprint_day(SPAN, "first", 6) == date(2026, 9, 11)
    assert sprint_day(SPAN, "first", 7) is None


def test_boundary_days_per_skip_mode():
    calendar = (SPAN, (date(2026, 9, 14), date(2026, 9, 25)))
    assert boundary_days(calendar, "none") == frozenset()
    assert boundary_days(calendar, "first") == {date(2026, 9, 3), date(2026, 9, 14)}
    assert boundary_days(calendar, "last") == {date(2026, 9, 11), date(2026, 9, 25)}
    assert boundary_days(calendar, "both") == {
        date(2026, 9, 3), date(2026, 9, 14), date(2026, 9, 11), date(2026, 9, 25),
    }
