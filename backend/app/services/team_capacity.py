"""The capacity maths: contracted half-days in, hours and person-days out.

Implements spec/teams.md §5.4. Everything here is a pure function over plain
data — no DB access, no ORM objects — so it is unit-testable against a
hand-computed fixture without fixtures or a session. Routes load rows and build
the dataclasses; this module does the arithmetic.

Three things about the model that are easy to get wrong, and expensive to
retrofit once views read them:

**A person-day is `normal_day_hours` of work, for everyone.** It is never the
member's own ``hours_per_day``. If a PD meant that person's day, a full sprint
would read "10 PD" for both an 8 h/day and a 6 h/day member — 80 h and 60 h of
work wearing the same number. Normalising makes it 10.0 and 7.5 (§5.2).

**Everything that varies over time is resolved per half-day.** ``hours_per_day``
and ``focus`` both live on the dated pattern version, so a contract change
mid-sprint needs no special case: the per-slot differences simply accumulate
inside the hours sum, and the conversion to days stays one division at the end.

**Nothing rounds here.** The whole chain is float and rounds exactly once, when a
push writes a sprint's Available (§6.4). An intermediate round would make the
displayed hours disagree with the displayed days.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Protocol, TypeVar

Half = Literal["am", "pm"]

HALVES: tuple[Half, Half] = ("am", "pm")

# Column stems for the 14 booleans on a pattern version, indexed by date.weekday().
WEEKDAY_STEMS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def other_half(half: Half) -> Half:
    return "pm" if half == "am" else "am"


# ── inputs ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PatternVersion:
    """One dated version of a member's contract.

    ``worked`` holds the (weekday, half) slots the contract owes. Intervals are
    half-open and derived: this version holds from ``effective_from`` until the
    day before the next version's, and the latest holds indefinitely — which is
    why there is no ``effective_to`` here either (§3.3).
    """

    effective_from: date
    worked: frozenset[tuple[int, Half]]
    hours_per_day: float = 8.0
    focus: float = 1.0

    def owes(self, day: date, half: Half) -> bool:
        return (day.weekday(), half) in self.worked


@dataclass(frozen=True)
class Member:
    """A member as the maths sees them: identity, validity, and dated contracts."""

    member_id: str
    # Ascending by effective_from. Never empty: a member is created with their
    # first version in the same transaction, because a versionless member computes
    # as zero capacity and reads as a bug rather than as missing data (§3.3).
    versions: tuple[PatternVersion, ...]
    active_from: date | None = None
    active_to: date | None = None
    # False for someone tracked for their absences only. Their own capacity is
    # still computed — the view shows it — but no team total includes it (§3.2).
    counts_towards_capacity: bool = True

    def is_active_on(self, day: date) -> bool:
        if self.active_from is not None and day < self.active_from:
            return False
        return not (self.active_to is not None and day > self.active_to)


def pattern_version_from_row(row: object) -> PatternVersion:
    """Adapt a ``MemberPatternVersion`` ORM row to the engine's input.

    Duck-typed on the 14 ``<day>_<half>`` attributes so the maths keeps no
    dependency on the model.
    """
    worked = {
        (index, half)
        for index, stem in enumerate(WEEKDAY_STEMS)
        for half in HALVES
        if getattr(row, f"{stem}_{half}")
    }
    return PatternVersion(
        effective_from=getattr(row, "effective_from"),
        worked=frozenset(worked),
        hours_per_day=float(getattr(row, "hours_per_day")),
        focus=float(getattr(row, "focus")),
    )


# ── the two seams steps 5 and 6 fill ─────────────────────────────────────────

#: True when *member_id* is absent for that half-day. Absences union rather than
#: sum, so a lookup answering per half-day is all the maths needs (§3.4).
AbsenceLookup = Callable[[str, date, Half], bool]

#: Minutes of meeting *starting* in each half of that day, for that member.
#: A meeting is placed in a half but not confined to one — see ``_meeting_hours``.
MeetingLookup = Callable[[str, date], Mapping[Half, float]]


def no_absences(member_id: str, day: date, half: Half) -> bool:
    return False


def no_meetings(member_id: str, day: date) -> Mapping[Half, float]:
    return {}


# ── results ──────────────────────────────────────────────────────────────────


@dataclass
class MemberCapacity:
    """One member's capacity over a window, with the chain that produced it.

    The fields are the steps of §5.4 in order, because that is what the expandable
    capacity cell renders: contracted → absences → meetings → present → focus →
    ÷ normal_day_hours. The collapsed cell is the summary; the chain is the point.
    """

    member_id: str
    contracted_half_days: int = 0
    contracted_hours: float = 0.0
    absent_half_days: int = 0
    hours_after_absences: float = 0.0
    meeting_hours: float = 0.0
    hours_after_meetings: float = 0.0
    net_hours: float = 0.0          # after focus
    person_days: float = 0.0
    # Surviving half-days counted in days, so a worked morning is 0.5. Presence and
    # capacity answer different questions: a member present 9 days contributes 6.3
    # PD when their day is 6 h and two of those days are halves (§5.5).
    present_days: float = 0.0


@dataclass
class TeamCapacity:
    members: list[MemberCapacity] = field(default_factory=list)
    net_hours: float = 0.0
    person_days: float = 0.0


# ── the maths ────────────────────────────────────────────────────────────────


class Dated(Protocol):
    """Anything carrying an ``effective_from`` — a dataclass here, an ORM row in a route."""

    @property
    def effective_from(self) -> date: ...


V = TypeVar("V", bound=Dated)


def resolve_version(versions: Sequence[V], on: date) -> V:
    """The version in force on *on*.

    The earliest version extends **backwards without limit**: any date before the
    first ``effective_from`` uses that first version, so no day is ever undefined
    and no capacity query has to handle a missing pattern (§3.3).

    Generic over the row shape on purpose. The routes resolve ORM versions to show
    a member's current hours and focus, and the maths resolves dataclasses; one
    implementation means the two can never disagree about which version a date
    falls in.
    """
    if not versions:
        raise ValueError("a member always has at least one pattern version")
    chosen = versions[0]
    for version in versions:
        if version.effective_from > on:
            break
        chosen = version
    return chosen


def days_in(start: date, end: date) -> Iterable[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def _meeting_hours(
    present_hours: Mapping[Half, float],
    charged: dict[Half, float],
    starts: Mapping[Half, float],
) -> None:
    """Charge one day's meetings against the hours that survived absences.

    Meetings are deducted **per day, not per half-day**. Each occurrence consumes
    from the half it starts in, then spills into the other half of the same day,
    and the day's total is clamped to what remains. Two cases turn on this: an 8 h
    workshop for a 6 h/day member costs their whole day and stops there (capacity
    0, never negative), and a full-day meeting clamped per half would be charged
    for only half its length, handing back an afternoon it plainly consumes.

    A meeting whose starting half did not survive costs **nothing** — placement is
    what lets a meeting be cancelled against an absence. Without it, a 2 h meeting
    on a morning the member is away would wrongly eat their afternoon (§3.5).
    """
    for start_half, minutes in starts.items():
        if start_half not in present_hours:
            continue
        remaining = minutes / 60.0
        for half in (start_half, other_half(start_half)):
            if remaining <= 0:
                break
            room = present_hours.get(half, 0.0) - charged.get(half, 0.0)
            if room <= 0:
                continue
            taken = min(room, remaining)
            charged[half] = charged.get(half, 0.0) + taken
            remaining -= taken


def compute_member_capacity(
    member: Member,
    normal_day_hours: float,
    start: date,
    end: date,
    absent: AbsenceLookup = no_absences,
    meetings: MeetingLookup = no_meetings,
) -> MemberCapacity:
    """One member's capacity over ``[start, end]`` inclusive, per §5.4."""
    result = MemberCapacity(member_id=member.member_id)

    for day in days_in(start, end):
        if not member.is_active_on(day):
            continue
        version = resolve_version(member.versions, day)

        # Steps 1-3: contracted half-days that survive absences, in hours.
        present_hours: dict[Half, float] = {}
        for half in HALVES:
            if not version.owes(day, half):
                continue
            result.contracted_half_days += 1
            result.contracted_hours += version.hours_per_day / 2
            if absent(member.member_id, day, half):
                result.absent_half_days += 1
                continue
            present_hours[half] = version.hours_per_day / 2

        if not present_hours:
            continue
        result.present_days += 0.5 * len(present_hours)
        result.hours_after_absences += sum(present_hours.values())

        # Step 4: meetings, charged per day and clamped to the surviving hours.
        charged: dict[Half, float] = {}
        _meeting_hours(present_hours, charged, meetings(member.member_id, day))
        result.meeting_hours += sum(charged.values())

        # Step 5: focus applies to what is left, and comes from the same version.
        # Meetings are subtracted *before* focus — they are booked time the member
        # does not have, and focus then discounts the rest. Encoding meeting
        # overhead in focus as well pays for it twice.
        for half, slot_hours in present_hours.items():
            net = (slot_hours - charged.get(half, 0.0)) * version.focus
            result.hours_after_meetings += slot_hours - charged.get(half, 0.0)
            result.net_hours += net

    result.person_days = result.net_hours / normal_day_hours
    return result


def compute_team_capacity(
    members: Sequence[Member],
    normal_day_hours: float,
    start: date,
    end: date,
    absent: AbsenceLookup = no_absences,
    meetings: MeetingLookup = no_meetings,
) -> TeamCapacity:
    """Team totals over a window.

    ``team_PD = team_hours / normal_day_hours`` and ``Σ member_PD`` over the
    *counting* members are the same number, because the divisor is shared. They
    agree by construction (§5.2).

    A member who does not count towards capacity is still computed and returned
    in ``members`` — they are on the team, and their chain is worth reading — but
    contributes nothing to the totals (§3.2).
    """
    result = TeamCapacity()
    for member in members:
        capacity = compute_member_capacity(
            member, normal_day_hours, start, end, absent=absent, meetings=meetings
        )
        result.members.append(capacity)
        if member.counts_towards_capacity:
            result.net_hours += capacity.net_hours
    result.person_days = result.net_hours / normal_day_hours
    return result


def round_half_up(value: float) -> int:
    """Round a float to the integer a sprint header will hold (§6.4).

    **Not** Python's ``round()``, which is banker's rounding: ``round(0.5) == 0``
    and ``round(2.5) == 2``. Nobody reading a sprint header expects that, and a
    ``.5`` lands often once shares and factors are in play — 13.5 pts must become
    14, every time.

    The float goes through ``str`` first so the rounding sees the number as it
    reads rather than its binary expansion: ``Decimal(2.675)`` is
    2.67499999999999982…, and would round down against every expectation.

    This is the **only** rounding in the chain. Everything upstream is float, and
    nothing downstream re-rounds (§6.4).
    """
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
