"""The capacity engine (spec/teams.md §5.4), checked against §5.5's worked example."""
from datetime import date

import pytest

from app.services.team_capacity import (
    HALVES,
    Member,
    PatternVersion,
    Share,
    compute_member_capacity,
    compute_team_capacity,
    pattern_version_from_row,
    resolve_version,
    round_half_up,
    shared_person_days,
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


# ── holidays (public-holidays.md §4) ─────────────────────────────────────────

EASTER_MONDAY = date(2026, 4, 6)


def _holiday_on(*days: date):
    covered = {(d, h) for d in days for h in HALVES}
    return lambda member_id, day, half: (day, half) in covered


def test_a_holiday_removes_contracted_halves_and_is_counted_apart():
    alice = member("alice", pattern("mon-fri"))
    result = compute_member_capacity(
        alice, 8.0, SPRINT_START, SPRINT_END, holiday=_holiday_on(EASTER_MONDAY)
    )
    assert result.absent_half_days == 2
    assert result.holiday_half_days == 2
    assert result.holiday_hours == pytest.approx(8.0)
    assert result.person_days == pytest.approx(9.0)


def test_leave_on_a_holiday_counts_once_and_as_holiday():
    alice = member("alice", pattern("mon-fri"))
    leave = {(EASTER_MONDAY, h) for h in HALVES} | {(date(2026, 4, 7), h) for h in HALVES}
    result = compute_member_capacity(
        alice, 8.0, SPRINT_START, SPRINT_END,
        absent=lambda m, d, h: (d, h) in leave,
        holiday=_holiday_on(EASTER_MONDAY),
    )
    assert result.absent_half_days == 4
    assert result.holiday_half_days == 2
    assert result.person_days == pytest.approx(8.0)


def test_a_holiday_on_a_day_not_worked_costs_nothing():
    part_timer = member("bob", pattern("tue-fri"))
    saturday = date(2026, 4, 11)
    result = compute_member_capacity(
        part_timer, 8.0, SPRINT_START, SPRINT_END, holiday=_holiday_on(EASTER_MONDAY, saturday)
    )
    assert result.holiday_half_days == 0
    assert result.absent_half_days == 0


def test_the_team_total_carries_holidays_through():
    team = compute_team_capacity(
        [member("alice", pattern("mon-fri")), member("bob", pattern("mon-fri"))],
        8.0, SPRINT_START, SPRINT_END, holiday=_holiday_on(EASTER_MONDAY),
    )
    assert team.person_days == pytest.approx(18.0)
    assert sum(m.holiday_half_days for m in team.members) == 4


# ── shares in days (§6.3.2, ADR 0010) ────────────────────────────────────────
#
# §5.5's fortnight again: a full-timer at 8 h, focus 1.0, is 80 h = 10 PD.


def _shared(m: Member, share: Share, **lookups) -> float:
    capacity = compute_member_capacity(m, 8.0, SPRINT_START, SPRINT_END, **lookups)
    return shared_person_days(m, capacity, share, 8.0)


def test_a_contract_counts_its_days_a_week_in_half_days():
    assert pattern("mon-fri").contracted_days == 5.0
    assert pattern("mon-thu,fri_am").contracted_days == 4.5
    assert pattern("").contracted_days == 0.0


def test_two_days_a_week_is_two_fifths_of_a_full_timer():
    assert _shared(member("a", pattern("mon-fri")), Share(days=2)) == pytest.approx(4.0)


def test_two_days_a_week_is_half_of_a_four_day_contract():
    # Mon–Thu: 8 days in the fortnight = 8 PD, and 2 of 4 days is half of it.
    assert _shared(member("a", pattern("mon-thu")), Share(days=2)) == pytest.approx(4.0)


def test_a_percentage_share_weighs_every_version_alike():
    assert _shared(member("a", pattern("mon-fri")), Share(pct=40)) == pytest.approx(4.0)


def test_a_contract_change_mid_sprint_reweighs_each_side():
    """Full-time the first week, Mon–Thu from 13 Apr: 2 days is 2/5, then 2/4."""
    m = member(
        "a",
        pattern("mon-fri", effective_from=date(2000, 1, 1)),
        pattern("mon-thu", effective_from=date(2026, 4, 13)),
    )
    # Week one 40 h × 0.4 = 16 h; week two 32 h × 0.5 = 16 h; 32 h ÷ 8 = 4 PD.
    assert _shared(m, Share(days=2)) == pytest.approx(4.0)


def test_an_absence_costs_a_days_share_in_proportion():
    """Absence hits every project alike — a proportion, not a reserved amount."""
    def monday_morning(member_id, day, half):
        return day == SPRINT_START and half == "am"

    # 80 h − 4 h = 76 h, × 2/5 = 30.4 h = 3.8 PD.
    m = member("a", pattern("mon-fri"))
    assert _shared(m, Share(days=2), absent=monday_morning) == pytest.approx(3.8)


def test_days_past_the_contract_take_the_whole_member_and_no_more():
    assert _shared(member("a", pattern("mon-fri")), Share(days=6)) == pytest.approx(10.0)


def test_a_days_share_of_a_member_with_no_contracted_days_is_nothing():
    assert _shared(member("a", pattern("")), Share(days=2)) == 0.0


def test_net_hours_by_version_add_up_to_net_hours():
    m = member(
        "a",
        pattern("mon-fri", focus=0.8, effective_from=date(2000, 1, 1)),
        pattern("mon-thu", focus=0.9, effective_from=date(2026, 4, 13)),
    )
    capacity = compute_member_capacity(m, 8.0, SPRINT_START, SPRINT_END)
    assert sum(capacity.net_hours_by_version.values()) == pytest.approx(capacity.net_hours)
    assert set(capacity.net_hours_by_version) == {date(2000, 1, 1), date(2026, 4, 13)}
