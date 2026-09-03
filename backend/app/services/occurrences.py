"""The schedule rule, expanded into the half-days it actually covers.

One rule shape describes when an absence applies and when a meeting occurs
(spec/teams.md §3.4), so this module is written for both: step 5 reads it for
absences, step 6 will read the same generator for meetings, and the two can then
never disagree about which Friday "every second Friday" means.

Pure functions over plain data, like `team_capacity.py` — no ORM row reaches
here, so the generation rules are unit-testable against hand-counted dates.

Three decisions the maths depends on:

**Occurrences are anchored on `start_date`, never on ISO week parity.** The first
occurrence is the first matching weekday on or after `start_date`; the rest fall
every `interval_weeks` weeks from it. Parity looks equivalent and breaks at the
year boundary, where week 52 can be followed by week 1 and two "even" weeks land
back to back. An anchor has no such seam — and it is also the only way two
members can be on *opposite* fortnights.

**Recurring rules may be open-ended.** "Every Wednesday afternoon, until further
notice" is a real contract, and it needs no sentinel end date: occurrences are
only ever generated inside a bounded window, so an unbounded rule is finite the
moment anybody asks about it.

**Generation is windowed, not filtered.** A rule that started in 2019 and runs
forever produces exactly the occurrences inside the asked-for window, because the
first one in the window is computed arithmetically rather than by walking there
from the anchor.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.services.team_capacity import HALVES, Half

Kind = Literal["range", "weekly", "interval"]

#: The three schedule shapes (§3.4). `interval` is its own kind rather than a
#: number on `weekly` so the common case has nothing to fill in.
KINDS: tuple[Kind, ...] = ("range", "weekly", "interval")

RECURRING: tuple[Kind, ...] = ("weekly", "interval")


@dataclass(frozen=True)
class ScheduleRule:
    """When something applies, in the one shape absences and meetings share.

    ``start_date`` means different things per kind and both are deliberate: for a
    ``range`` it is the first day, and for a recurring rule it is the **anchor**
    that decides which alternate weeks are hit. The UI labels the second one
    "First occurrence" for exactly that reason (§3.4).
    """

    kind: Kind
    start_date: date
    end_date: date | None = None
    # range only — which half the block opens and closes on.
    start_half: Half = "am"
    end_half: Half = "pm"
    # weekly / interval only.
    weekday: int | None = None
    halves: tuple[Half, ...] = HALVES
    interval_weeks: int | None = None

    @property
    def step_days(self) -> int:
        """Days between occurrences. ``weekly`` is ``interval`` with N = 1 (§3.4)."""
        return 7 * (self.interval_weeks or 1) if self.kind == "interval" else 7


def _range_days(rule: ScheduleRule, window_start: date, window_end: date) -> Iterator[date]:
    last = rule.end_date or rule.start_date
    day = max(rule.start_date, window_start)
    stop = min(last, window_end)
    while day <= stop:
        yield day
        day += timedelta(days=1)


def _recurring_days(rule: ScheduleRule, window_start: date, window_end: date) -> Iterator[date]:
    """Occurrence dates of a weekly or interval rule inside the window.

    The first occurrence *in the window* is found arithmetically rather than by
    walking forward from the anchor: a daily stand-up anchored in 2019 must not
    cost 2 000 iterations to answer a question about next month.
    """
    if rule.weekday is None:
        return
    # The anchor: first matching weekday on or after start_date.
    offset = (rule.weekday - rule.start_date.weekday()) % 7
    first = rule.start_date + timedelta(days=offset)

    stop = window_end if rule.end_date is None else min(window_end, rule.end_date)
    step = rule.step_days

    day = first
    if window_start > first:
        # Whole steps to skip, rounded up — landing on or after the window's start.
        skipped = -(-(window_start - first).days // step)
        day = first + timedelta(days=skipped * step)

    while day <= stop:
        yield day
        day += timedelta(days=step)


def occurrence_days(rule: ScheduleRule, window_start: date, window_end: date) -> Iterator[date]:
    """Every day this rule touches inside ``[window_start, window_end]``.

    A ``range`` touches every day of the block; a recurring rule touches its
    occurrence dates. Meetings (step 6) read this directly — they occur *on* a
    day, in the half they name.
    """
    if window_end < window_start:
        return
    if rule.kind == "range":
        yield from _range_days(rule, window_start, window_end)
    else:
        yield from _recurring_days(rule, window_start, window_end)


def half_days(
    rule: ScheduleRule, window_start: date, window_end: date
) -> Iterator[tuple[date, Half]]:
    """Every ``(day, half)`` this rule covers inside the window.

    A ``range`` runs from ``start_half`` on its first day to ``end_half`` on its
    last, inclusive, and is whole days in between — which is what makes "off from
    Friday afternoon until Monday morning" one entry rather than three. A
    recurring rule covers the halves it names, on every occurrence.
    """
    if rule.kind != "range":
        for day in occurrence_days(rule, window_start, window_end):
            for half in rule.halves:
                yield day, half
        return

    last = rule.end_date or rule.start_date
    for day in occurrence_days(rule, window_start, window_end):
        # Only the two ends are partial. A block opening at noon skips its first
        # morning; one closing at noon skips its last afternoon; a one-day range
        # can do both, which is how "just Tuesday morning" is stored.
        if day == rule.start_date and rule.start_half == "pm":
            yield day, "pm"
            continue
        if day == last and rule.end_half == "am":
            yield day, "am"
            continue
        yield from ((day, half) for half in HALVES)


def describe(rule: ScheduleRule) -> str:
    """The rule in words, for a summary line and for an agent's confirmation.

    Written here rather than in the UI because MCP returns it too: an off-by-one
    week is invisible in a set of fields and obvious in a sentence.
    """
    if rule.kind == "range":
        last = rule.end_date or rule.start_date
        halves = _halves_phrase(rule)
        if last == rule.start_date:
            return f"{rule.start_date.isoformat()}, {halves}"
        return f"{rule.start_date.isoformat()} – {last.isoformat()}, {halves}"

    day_name = _WEEKDAY_NAMES[rule.weekday] if rule.weekday is not None else "?"
    halves = ", ".join(rule.halves)
    every = (
        f"every {_ordinal(rule.interval_weeks or 2)} {day_name}"
        if rule.kind == "interval"
        else f"every {day_name}"
    )
    tail = f" until {rule.end_date.isoformat()}" if rule.end_date else ", ongoing"
    return f"{every} {halves}, from {rule.start_date.isoformat()}{tail}"


_WEEKDAY_NAMES: tuple[str, ...] = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)

_ORDINALS: dict[int, str] = {2: "2nd", 3: "3rd"}


def _ordinal(weeks: int) -> str:
    return _ORDINALS.get(weeks, f"{weeks}th")


def _halves_phrase(rule: ScheduleRule) -> str:
    last = rule.end_date or rule.start_date
    if rule.start_date == last:
        if rule.start_half == "am" and rule.end_half == "pm":
            return "both halves"
        return f"{rule.start_half} only"
    return f"from {rule.start_half} to {rule.end_half}"
