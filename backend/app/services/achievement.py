"""The achievement maths: completion dates in, points per sprint out.

Implements spec/team-achievement.md §4.5 and the arithmetic of §5.3. Like
`team_capacity.py`, everything here is a pure function over plain data — no
session, no ORM rows — so the rules every figure on the Achievement screen rests
on are unit-testable without a database. The route loads rows and builds these
dataclasses; this module decides where each point lands.

Four rules, each easy to get subtly wrong:

**Attribution is by date, inclusive at both ends.** An item completed on a
sprint's first or last day belongs to that sprint. The sprint it was *planned*
into is irrelevant here; that is Committed, and it is found by placement.

**Overlapping sprints: the earliest-starting match wins, and a point counts
once.** Ties on the start date go to the sprint met first in calendar order.

**Attribution is decided over the anchor's full calendar, never the window.**
The view shows a window of columns, but where a point *lands* must not depend on
which columns are shown: narrowing the window would otherwise move points
between columns, or into "outside the calendar". A point attributed to a sprint
outside the window is simply not shown; it is not outside the calendar.

**Null, never zero, wherever a figure is unknown.** An undated column, a project
with no done State, a velocity over no PD. Unknown and empty are different (§5.5).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

# ── inputs ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CalendarSprint:
    """One sprint of the anchor calendar. Undated sprints are allowed and match nothing."""

    sprint_id: str
    start_date: date | None
    end_date: date | None

    @property
    def dated(self) -> bool:
        return self.start_date is not None and self.end_date is not None

    def contains(self, day: date) -> bool:
        if self.start_date is None or self.end_date is None:
            return False
        return self.start_date <= day <= self.end_date


@dataclass(frozen=True)
class CompletedItem:
    """A story or bug in a done-category State, as the view lists it."""

    system_id: str
    user_id: int | None
    title: str
    item_type: str
    effort: float | None
    completed_on: date | None

    @property
    def points(self) -> float:
        # A completed item with no estimate is still an item, worth nothing
        # (§10, matching `sprint_efforts_for_pi`, which filters effort IS NULL).
        return self.effort if self.effort is not None else 0.0


@dataclass(frozen=True)
class ProjectSprint:
    """A sprint of a served project, with the effort placed in it."""

    sprint_id: str
    start_date: date | None
    end_date: date | None
    placed_effort: float


@dataclass(frozen=True)
class ProjectTotalsInput:
    """What the team row needs from one project."""

    in_pd_total: bool
    units_per_pd: float
    achieved: Sequence[float | None]


# ── outputs ──────────────────────────────────────────────────────────────────


@dataclass
class ProjectAchievement:
    """Achieved per column, the items behind it, and the §5.5 footers."""

    achieved: list[float | None]
    achieved_items: list[list[CompletedItem]]
    outside_calendar_points: float
    done_undated_count: int


@dataclass
class TeamTotals:
    achieved_pd: list[float | None]
    available_pd: list[float | None]
    realised: list[float | None]


# ── attribution ──────────────────────────────────────────────────────────────


def attribute(completed_on: date, calendar: Sequence[CalendarSprint]) -> str | None:
    """The sprint a completion belongs to, or None when it falls in no dated sprint.

    ``S.start_date <= completed_on <= S.end_date``, inclusive at both ends. Where
    several dated sprints contain the date, the earliest-starting one wins; a tie
    on the start goes to the one met first in ``calendar`` order. Undated sprints
    never match.
    """
    best: CalendarSprint | None = None
    for sprint in calendar:
        if not sprint.contains(completed_on):
            continue
        assert sprint.start_date is not None
        if best is None or (best.start_date is not None and sprint.start_date < best.start_date):
            best = sprint
    return best.sprint_id if best is not None else None


def achievement_per_column(
    columns: Sequence[CalendarSprint],
    calendar: Sequence[CalendarSprint],
    items: Iterable[CompletedItem],
) -> ProjectAchievement:
    """Achieved points per column, over done items attributed on the full calendar.

    ``columns`` are what the view shows (possibly a window); ``calendar`` is the
    anchor's whole calendar, which alone decides attribution. An undated column
    reads None and lists nothing. An item attributed to a sprint that is not a
    column is dropped silently — it is in the calendar, just not on screen. An
    item whose date falls in no dated sprint of the calendar counts towards
    ``outside_calendar_points``. An item with no date counts as done-but-undated.
    """
    position = {column.sprint_id: index for index, column in enumerate(columns)}
    achieved: list[float | None] = [0.0 if column.dated else None for column in columns]
    listed: list[list[CompletedItem]] = [[] for _ in columns]
    outside = 0.0
    undated = 0

    for item in items:
        if item.completed_on is None:
            undated += 1
            continue
        sprint_id = attribute(item.completed_on, calendar)
        if sprint_id is None:
            outside += item.points
            continue
        index = position.get(sprint_id)
        if index is None:
            continue
        current = achieved[index]
        if current is None:
            # A calendar sprint that matched must be dated, so its column is too;
            # this only guards against a caller passing inconsistent inputs.
            continue
        achieved[index] = current + item.points
        listed[index].append(item)

    for cell in listed:
        cell.sort(key=lambda i: (i.completed_on or date.min, i.user_id or 0, i.title))
    return ProjectAchievement(
        achieved=achieved,
        achieved_items=listed,
        outside_calendar_points=outside,
        done_undated_count=undated,
    )


def unmeasured(columns: Sequence[CalendarSprint], done_undated_count: int) -> ProjectAchievement:
    """The rows of a project that has no done State at all: every figure unknown."""
    return ProjectAchievement(
        achieved=[None for _ in columns],
        achieved_items=[[] for _ in columns],
        outside_calendar_points=0.0,
        done_undated_count=done_undated_count,
    )


# ── committed ────────────────────────────────────────────────────────────────


def committed_per_column(
    columns: Sequence[CalendarSprint], project_sprints: Sequence[ProjectSprint]
) -> list[float | None]:
    """Effort placed in the project's sprint on each column's exact dates.

    Found by placement, which needs the project to own a sprint with an identical
    ``[start_date, end_date]`` (§5.3). Where the column *is* one of the project's
    sprints (the anchor), that sprint alone is used; otherwise every project
    sprint on exactly those dates. None for an undated column or no match — and
    0.0, not None, for a matching sprint with nothing placed in it.
    """
    by_id = {sprint.sprint_id: sprint for sprint in project_sprints}
    committed: list[float | None] = []
    for column in columns:
        if not column.dated:
            committed.append(None)
            continue
        own = by_id.get(column.sprint_id)
        if own is not None:
            committed.append(own.placed_effort)
            continue
        matching = [
            sprint.placed_effort
            for sprint in project_sprints
            if sprint.start_date == column.start_date and sprint.end_date == column.end_date
        ]
        committed.append(sum(matching) if matching else None)
    return committed


# ── ratios ───────────────────────────────────────────────────────────────────


def ratio(numerator: float | None, denominator: float | None) -> float | None:
    """``numerator ÷ denominator``, or None when either is unknown or the divisor is not positive."""
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator


def velocity(achieved: Sequence[float | None], pd_given: Sequence[float | None]) -> list[float | None]:
    """Achieved ÷ PD given per column, in the project's unit per person-day."""
    return [ratio(a, pd) for a, pd in zip(achieved, pd_given, strict=True)]


def team_totals(
    projects: Sequence[ProjectTotalsInput], available_pd: Sequence[float | None]
) -> TeamTotals:
    """The team row: achieved PD over projects with a factor, and realised.

    A project reaches the total only when ``in_pd_total`` (not ``manual``) and
    its achieved cell is known; its points convert at ``units_per_pd``. A column
    no project contributes to — or an undated one — reads None, never 0.
    """
    achieved_pd: list[float | None] = []
    for index, available in enumerate(available_pd):
        total: float | None = None
        if available is not None:
            for project in projects:
                if not project.in_pd_total or project.units_per_pd <= 0:
                    continue
                points = project.achieved[index]
                if points is None:
                    continue
                total = (total or 0.0) + points / project.units_per_pd
        achieved_pd.append(total)
    return TeamTotals(
        achieved_pd=achieved_pd,
        available_pd=list(available_pd),
        realised=[ratio(a, pd) for a, pd in zip(achieved_pd, available_pd, strict=True)],
    )
