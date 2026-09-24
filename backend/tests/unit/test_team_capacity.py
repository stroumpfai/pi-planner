"""The capacity engine (spec/teams.md §5.4), checked against §5.5's worked example."""
from datetime import date

import pytest

from app.services.team_capacity import (
    HALVES,
    Member,
    PatternVersion,
    compute_member_capacity,
    compute_team_capacity,
    pattern_version_from_row,
    resolve_version,
    round_half_up,
)

# §5.5's sprint: Mon 6 Apr – Fri 17 Apr 2026, ten working days.
SPRINT_START = date(2026, 4, 6)
SPRINT_END = date(2026, 4, 17)


def pattern(days: str, *, hours_per_day: float = 8.0, focus: float = 1.0,
            effective_from: date = date(2000, 1, 1)) -> PatternVersion:
    """A version from a compact spec like "mon-fri" or "mon-thu,fri_am"."""
    stems = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    worked: set[tuple[int, str]] = set()
    for token in days.split(","):
        token = token.strip()
        if not token:
            continue
        half = None
        if token.endswith("_am") or token.endswith("_pm"):
            token, half = token[:-3], token[-2:]
        first, _, last = token.partition("-")
        start, stop = stems.index(first), stems.index(last or first)
        for index in range(start, stop + 1):
            for h in ([half] if half else list(HALVES)):
                worked.add((index, h))
    return PatternVersion(
        effective_from=effective_from, worked=frozenset(worked),  # type: ignore[arg-type]
        hours_per_day=hours_per_day, focus=focus,
    )


def member(member_id: str, *versions: PatternVersion, **kwargs) -> Member:
    return Member(member_id=member_id, versions=versions, **kwargs)


# ── version resolution ───────────────────────────────────────────────────────


def test_the_earliest_version_extends_backwards_without_limit():
    """No day is ever undefined, which is what makes the model cheap to adopt."""
    first = pattern("mon-fri", effective_from=date(2026, 9, 1))
    assert resolve_version([first], date(2020, 1, 1)) is first


def test_a_version_holds_from_its_own_date_until_the_next():
    first = pattern("mon-fri", effective_from=date(2026, 1, 1))
    second = pattern("mon-thu", effective_from=date(2026, 9, 1))
    assert resolve_version([first, second], date(2026, 8, 31)) is first
    assert resolve_version([first, second], date(2026, 9, 1)) is second
    assert resolve_version([first, second], date(2030, 1, 1)) is second


def test_resolution_works_on_stored_rows_as_well_as_the_maths_dataclass():
    """One rule, one implementation.

    The routes resolve ORM versions to show a member's current hours and focus,
    and the maths resolves dataclasses. If these were two functions they could
    disagree about which version a date falls in, and the Members view would
    quietly show a contract the capacity figure was not computed from.
    """
    from app.models.team import MemberPatternVersion

    first = MemberPatternVersion(effective_from=date(2026, 1, 1), hours_per_day=8.0)
    second = MemberPatternVersion(effective_from=date(2026, 9, 1), hours_per_day=6.0)

    assert resolve_version([first, second], date(2025, 12, 31)) is first
    assert resolve_version([first, second], date(2026, 8, 31)) is first
    assert resolve_version([first, second], date(2026, 9, 1)) is second


def test_resolving_with_no_versions_is_a_programming_error():
    with pytest.raises(ValueError):
        resolve_version([], date(2026, 1, 1))


def test_pattern_version_from_row_reads_the_fourteen_booleans():
    class Row:
        effective_from = date(2026, 1, 1)
        hours_per_day = 6.0
        focus = 0.8
    for stem in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
        for half in HALVES:
            setattr(Row, f"{stem}_{half}", stem in ("mon", "tue"))

    version = pattern_version_from_row(Row())
    assert version.worked == frozenset({(0, "am"), (0, "pm"), (1, "am"), (1, "pm")})
    assert version.hours_per_day == 6.0 and version.focus == 0.8


# ── a full sprint ────────────────────────────────────────────────────────────


def test_full_time_member_over_a_full_sprint():
    alice = member("alice", pattern("mon-fri"))
    result = compute_member_capacity(alice, 8.0, SPRINT_START, SPRINT_END)
    assert result.contracted_half_days == 20
    assert result.net_hours == pytest.approx(80.0)
    assert result.person_days == pytest.approx(10.0)
    assert result.present_days == pytest.approx(10.0)


def test_a_part_timers_day_is_not_a_person_day():
    """§5.2: PD is a unit of work. Bob's 6 h day is 0.75 PD, never 1.0."""
    bob = member("bob", pattern("mon-thu,fri_am", hours_per_day=6.0))
    result = compute_member_capacity(bob, 8.0, SPRINT_START, SPRINT_END)
    # 18 half-days x 3 h = 54 h — nine present days, not ten PD.
    assert result.contracted_half_days == 18
    assert result.net_hours == pytest.approx(54.0)
    # Eight full days plus two Friday mornings.
    assert result.present_days == pytest.approx(9.0)
    assert result.person_days == pytest.approx(6.75)
    assert result.person_days != result.present_days


def test_focus_discounts_what_is_left():
    alice = member("alice", pattern("mon-fri", focus=0.8))
    result = compute_member_capacity(alice, 8.0, SPRINT_START, SPRINT_END)
    assert result.net_hours == pytest.approx(64.0)
    assert result.person_days == pytest.approx(8.0)


def test_a_mid_sprint_contract_change_needs_no_special_case():
    """Each half-day uses the version in force on its own date; hours simply add."""
    changer = member(
        "changer",
        pattern("mon-fri", effective_from=date(2026, 1, 1)),
        # From Mon 13 Apr, week two: four days instead of five.
        pattern("mon-thu", effective_from=date(2026, 4, 13)),
    )
    result = compute_member_capacity(changer, 8.0, SPRINT_START, SPRINT_END)
    # Week one 40 h; week two loses Friday's 8 h.
    assert result.net_hours == pytest.approx(72.0)


def test_a_change_dated_after_the_window_does_not_touch_it():
    changer = member(
        "changer",
        pattern("mon-fri", effective_from=date(2026, 1, 1)),
        pattern("mon-thu", effective_from=date(2026, 9, 1)),
    )
    result = compute_member_capacity(changer, 8.0, SPRINT_START, SPRINT_END)
    assert result.net_hours == pytest.approx(80.0)


def test_half_days_outside_the_validity_window_contribute_nothing():
    """A mid-sprint joiner, without deleting anyone or rewriting closed sprints."""
    joiner = member("joiner", pattern("mon-fri"), active_from=date(2026, 4, 13))
    result = compute_member_capacity(joiner, 8.0, SPRINT_START, SPRINT_END)
    assert result.net_hours == pytest.approx(40.0)
    assert result.contracted_half_days == 10

    leaver = member("leaver", pattern("mon-fri"), active_to=date(2026, 4, 10))
    assert compute_member_capacity(leaver, 8.0, SPRINT_START, SPRINT_END).net_hours == pytest.approx(40.0)


def test_normal_day_hours_is_the_divisor_not_the_members_day():
    """A 37.5 h week: the same hours, honestly larger in days."""
    alice = member("alice", pattern("mon-fri", hours_per_day=7.5))
    result = compute_member_capacity(alice, 7.5, SPRINT_START, SPRINT_END)
    assert result.net_hours == pytest.approx(75.0)
    assert result.person_days == pytest.approx(10.0)


# ── the two seams ────────────────────────────────────────────────────────────


def test_absences_drop_the_half_days_they_cover():
    alice = member("alice", pattern("mon-fri"))
    away = {(date(2026, 4, 13), "am"), (date(2026, 4, 13), "pm")}

    result = compute_member_capacity(
        alice, 8.0, SPRINT_START, SPRINT_END,
        absent=lambda _m, day, half: (day, half) in away,
    )
    assert result.absent_half_days == 2
    assert result.net_hours == pytest.approx(72.0)
    assert result.present_days == pytest.approx(9.0)


def test_meetings_are_subtracted_before_focus():
    """Focus is for the diffuse losses; charging meetings after it pays twice."""
    alice = member("alice", pattern("mon-fri", focus=0.8))
    result = compute_member_capacity(
        alice, 8.0, SPRINT_START, SPRINT_END,
        meetings=lambda _m, day: {"am": 120.0} if day == SPRINT_START else {},
    )
    # (80 - 2) x 0.8, not 80 x 0.8 - 2.
    assert result.net_hours == pytest.approx(62.4)


def test_a_meeting_spills_into_the_other_half_of_the_same_day():
    """Clamping per half would charge a full-day workshop for half its length."""
    bob = member("bob", pattern("mon-fri", hours_per_day=6.0))
    result = compute_member_capacity(
        bob, 8.0, SPRINT_START, SPRINT_END,
        meetings=lambda _m, day: {"am": 480.0} if day == date(2026, 4, 8) else {},
    )
    # The workshop costs Bob his whole 6 h day and stops: 60 - 6, not 60 - 3.
    assert result.meeting_hours == pytest.approx(6.0)
    assert result.net_hours == pytest.approx(54.0)


def test_a_meeting_longer_than_the_day_never_goes_negative():
    bob = member("bob", pattern("mon-fri", hours_per_day=6.0))
    result = compute_member_capacity(
        bob, 8.0, date(2026, 4, 8), date(2026, 4, 8),
        meetings=lambda _m, _day: {"am": 480.0},
    )
    assert result.net_hours == pytest.approx(0.0)
    assert result.net_hours >= 0


def test_a_meeting_starting_on_an_absent_half_costs_nothing():
    """Placement is what lets a meeting be cancelled against an absence."""
    alice = member("alice", pattern("mon-fri"))
    result = compute_member_capacity(
        alice, 8.0, date(2026, 4, 6), date(2026, 4, 6),
        absent=lambda _m, _day, half: half == "am",
        meetings=lambda _m, _day: {"am": 120.0},
    )
    # The afternoon survives untouched; without placement the spill would eat it.
    assert result.meeting_hours == pytest.approx(0.0)
    assert result.net_hours == pytest.approx(4.0)


def test_a_meeting_on_a_non_contracted_half_is_not_deducted():
    bob = member("bob", pattern("mon-thu,fri_am"))
    result = compute_member_capacity(
        bob, 8.0, date(2026, 4, 10), date(2026, 4, 10),  # a Friday
        meetings=lambda _m, _day: {"pm": 60.0},
    )
    assert result.meeting_hours == pytest.approx(0.0)
    assert result.net_hours == pytest.approx(4.0)


def test_several_meetings_on_one_day_are_clamped_together():
    bob = member("bob", pattern("mon-fri", hours_per_day=6.0))
    result = compute_member_capacity(
        bob, 8.0, date(2026, 4, 8), date(2026, 4, 8),
        meetings=lambda _m, _day: {"am": 300.0, "pm": 300.0},  # 5 h + 5 h against 6 h
    )
    assert result.meeting_hours == pytest.approx(6.0)
    assert result.net_hours == pytest.approx(0.0)


# ── the worked example, end to end ───────────────────────────────────────────


def test_worked_example_from_the_spec():
    """§5.5: Alice 6.9 PD, Bob 6.3 PD, team 105.2 h · 13.2 PD."""
    alice = member("alice", pattern("mon-fri", hours_per_day=8.0, focus=0.8))
    bob = member("bob", pattern("mon-thu,fri_am", hours_per_day=6.0, focus=1.0))

    holiday = {("alice", date(2026, 4, 13))}
    mondays = {date(2026, 4, 6), date(2026, 4, 13)}

    def absent(member_id: str, day: date, _half: str) -> bool:
        return (member_id, day) in holiday

    def meetings(_member_id: str, day: date) -> dict[str, float]:
        minutes = 0.0
        if day == SPRINT_START:
            minutes += 120.0          # sprint planning, 6 Apr am
        if day in mondays:
            minutes += 60.0           # weekly sync
        return {"am": minutes} if minutes else {}

    team = compute_team_capacity([alice, bob], 8.0, SPRINT_START, SPRINT_END,
                                 absent=absent, meetings=meetings)

    by_id = {m.member_id: m for m in team.members}
    assert by_id["alice"].net_hours == pytest.approx(55.2)
    assert by_id["alice"].person_days == pytest.approx(6.9)
    assert by_id["bob"].net_hours == pytest.approx(50.0)
    # 6.25, which the spec displays half-up as 6.3. Nothing rounds in here: the
    # engine keeps the float and the single rounding happens at the push (§6.4).
    assert by_id["bob"].person_days == pytest.approx(6.25)
    # Bob is present nine days and contributes 6.25 PD — different questions.
    assert by_id["bob"].present_days == pytest.approx(9.0)

    assert team.net_hours == pytest.approx(105.2)
    assert team.person_days == pytest.approx(13.15)
    # The two headline figures are one number in two units, by construction.
    assert team.person_days == pytest.approx(team.net_hours / 8.0)
    assert team.person_days == pytest.approx(sum(m.person_days for m in team.members))


def test_worked_example_with_bobs_workshop():
    """§5.5's third case: one 8 h workshop drops Bob to 44.0 h · 5.5 PD."""
    bob = member("bob", pattern("mon-thu,fri_am", hours_per_day=6.0))
    mondays = {date(2026, 4, 6), date(2026, 4, 13)}

    def meetings(_member_id: str, day: date) -> dict[str, float]:
        minutes = 0.0
        if day == SPRINT_START:
            minutes += 120.0
        if day in mondays:
            minutes += 60.0
        if day == date(2026, 4, 8):
            minutes += 480.0
        return {"am": minutes} if minutes else {}

    result = compute_member_capacity(bob, 8.0, SPRINT_START, SPRINT_END, meetings=meetings)
    assert result.net_hours == pytest.approx(44.0)
    assert result.person_days == pytest.approx(5.5)


def test_a_team_with_no_members_is_zero_not_an_error():
    team = compute_team_capacity([], 8.0, SPRINT_START, SPRINT_END)
    assert team.net_hours == 0.0 and team.person_days == 0.0



# ── members who do not count towards capacity (§3.2) ─────────────────────────


def test_a_member_who_does_not_count_is_computed_but_never_totalled():
    """A PO whose holidays the team tracks is on the team, not in its capacity.

    Their chain is still returned — the Capacity view shows it — but the totals,
    and so every project share and every push, are over the counting members.
    """
    dev = member("dev", pattern("mon-fri"))
    po = member("po", pattern("mon-fri"), counts_towards_capacity=False)

    team = compute_team_capacity([dev, po], 8.0, SPRINT_START, SPRINT_END)

    by_id = {m.member_id: m for m in team.members}
    assert by_id["po"].person_days == pytest.approx(10.0)
    assert team.net_hours == pytest.approx(80.0)
    assert team.person_days == pytest.approx(10.0)
    # The shared-divisor identity still holds, over the members that count.
    assert team.person_days == pytest.approx(by_id["dev"].person_days)


def test_a_team_where_nobody_counts_totals_zero():
    team = compute_team_capacity(
        [member("po", pattern("mon-fri"), counts_towards_capacity=False)],
        8.0, SPRINT_START, SPRINT_END,
    )
    assert len(team.members) == 1
    assert team.net_hours == 0.0 and team.person_days == 0.0

# ── rounding at the boundary (§6.4) ──────────────────────────────────────────


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0.5, 1), (1.5, 2), (2.5, 3), (13.5, 14), (13.4999, 13), (0.0, 0), (14.0, 14)],
)
def test_the_boundary_rounds_half_up_not_to_even(value, expected):
    """Python's round() is banker's rounding: round(0.5) == 0, round(2.5) == 2.

    Nobody reading a sprint header expects 2.5 points to become 2, and a .5 lands
    often once shares and factors are in play. This is the only rounding in the
    chain, so getting it wrong is wrong everywhere.
    """
    assert round_half_up(value) == expected


def test_rounding_sees_the_number_as_it_reads():
    """2.675 is 2.67499999999999982… in binary, and would round down from the float."""
    assert round_half_up(2.675) == 3
