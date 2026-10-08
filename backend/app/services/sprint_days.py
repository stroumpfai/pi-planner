"""Days of a sprint, named by their place in it (ADR 0013).

Two meeting rules read the team's sprint calendar rather than the week: a
`sprint` meeting falls on a named day of every sprint ("the last day — review
and retro"), and a weekly or interval meeting can **skip** a sprint's first or
last day ("refinement every Thursday, except when the sprint changes"). Both
need the same answer to "which day is the first day of this sprint?", so it is
written once, here.

Pure functions over plain dates, like `occurrences.py` — the calendar is loaded
by `meetings.py`, and nothing here knows a sprint is a row.

**A sprint day is a working day, Monday to Friday.** A sprint stored as
Thursday–Sunday ends, for a meeting, on the Friday: nobody holds the review on
a Sunday, and a rule that landed there would cost nothing and be silently
wrong. Offsets count working days for the same reason — "the day before the
last day" of a sprint ending on a Monday is the Friday before it, not Sunday.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from datetime import date, timedelta
from typing import Literal

SprintEdge = Literal["first", "last"]
SkipSprintDays = Literal["none", "first", "last", "both"]

#: One dated sprint, inclusive at both ends.
SprintSpan = tuple[date, date]

#: The team's dated sprints, from its anchor project (spec/teams.md §7.0.1).
#: Empty for a team with no project, or with no dated sprint — and then no
#: sprint meeting occurs and no recurrence skips anything.
SprintCalendar = tuple[SprintSpan, ...]

NO_CALENDAR: SprintCalendar = ()

#: How far in from the edge a `sprint` meeting can sit: the tenth working day,
#: which is the whole of a two-week sprint.
MAX_SPRINT_OFFSET = 9


def _working_days(span: SprintSpan) -> list[date]:
    start, end = span
    days: list[date] = []
    day = start
    while day <= end:
        if day.weekday() < 5:
            days.append(day)
        day += timedelta(days=1)
    return days


def sprint_day(span: SprintSpan, edge: SprintEdge, offset: int = 0) -> date | None:
    """The working day ``offset`` days in from ``edge`` of one sprint.

    ``("first", 0)`` is the sprint's first working day, ``("first", 1)`` the one
    after; ``("last", 0)`` its last working day, ``("last", 1)`` the one before.
    None when the sprint is too short to have that day — a three-day sprint has
    no "fifth day", and inventing one outside it would charge the next sprint.
    """
    days = _working_days(span)
    if offset < 0 or offset >= len(days):
        return None
    return days[offset] if edge == "first" else days[-1 - offset]


def sprint_days(calendar: Iterable[SprintSpan], edge: SprintEdge, offset: int = 0) -> Iterator[date]:
    """That day of every sprint in the calendar, in calendar order."""
    for span in calendar:
        day = sprint_day(span, edge, offset)
        if day is not None:
            yield day


def boundary_days(calendar: Iterable[SprintSpan], skip: SkipSprintDays) -> frozenset[date]:
    """The days a recurrence skipping ``skip`` must not land on.

    "both" is the sprint change as a team lives it when sprints run Thursday to
    Wednesday: the old sprint's last day *and* the new one's first.
    """
    if skip == "none":
        return frozenset()
    spans = list(calendar)
    edges: tuple[SprintEdge, ...] = ("first", "last") if skip == "both" else (skip,)
    return frozenset(day for edge in edges for day in sprint_days(spans, edge))
