"""The completion helper: stamping and clearing ``completed_on`` (team-achievement.md §4.1–§4.2).

Pure-function tests on transient ORM objects — no database.
"""
from datetime import date

import pytest

from app.models.pbi import PBI
from app.models.project_state import ProjectState
from app.services.completion import apply_completion, is_done, utc_today

TODAY = date(2026, 9, 25)
EARLIER = date(2026, 9, 1)


def _state(value: str, category: str | None) -> ProjectState:
    return ProjectState(system_id=f"s-{value}", item_type="story", value=value, category=category)


NEW = _state("New", "not_started")
ACTIVE = _state("Active", "in_progress")
TRIAGE = _state("Triage", None)
DONE = _state("Done", "done")
CLOSED = _state("Closed", "done")


def _pbi(completed_on: date | None = None) -> PBI:
    return PBI(title="Login", completed_on=completed_on)


def test_is_done_reads_the_category_not_the_wording():
    assert is_done(DONE)
    assert not is_done(_state("Done", None))
    assert not is_done(ACTIVE)
    assert not is_done(None)


@pytest.mark.parametrize("old", [NEW, ACTIVE, TRIAGE, None], ids=["not_started", "in_progress", "uncategorised", "no_state"])
def test_edge_into_done_stamps_today(old):
    pbi = _pbi()
    apply_completion(pbi, old, DONE, today=TODAY)
    assert pbi.completed_on == TODAY


def test_stamp_defaults_to_the_utc_date():
    pbi = _pbi()
    apply_completion(pbi, ACTIVE, DONE)
    assert pbi.completed_on == utc_today()


def test_staying_in_the_same_done_state_keeps_the_date():
    pbi = _pbi(EARLIER)
    apply_completion(pbi, DONE, DONE, today=TODAY)
    assert pbi.completed_on == EARLIER


def test_done_to_another_done_state_keeps_the_date():
    pbi = _pbi(EARLIER)
    apply_completion(pbi, DONE, CLOSED, today=TODAY)
    assert pbi.completed_on == EARLIER


def test_done_but_undated_is_not_back_stamped_by_a_resave():
    """§9.2: an item already done when the feature shipped has no transition."""
    pbi = _pbi()
    apply_completion(pbi, DONE, DONE, today=TODAY)
    assert pbi.completed_on is None
    apply_completion(pbi, DONE, CLOSED, today=TODAY)
    assert pbi.completed_on is None


@pytest.mark.parametrize("new", [NEW, ACTIVE, TRIAGE, None], ids=["not_started", "in_progress", "uncategorised", "no_state"])
def test_leaving_done_clears_the_date(new):
    pbi = _pbi(EARLIER)
    apply_completion(pbi, DONE, new, today=TODAY)
    assert pbi.completed_on is None


def test_re_completion_gets_a_fresh_date():
    pbi = _pbi(EARLIER)
    apply_completion(pbi, DONE, ACTIVE, today=TODAY)
    apply_completion(pbi, ACTIVE, DONE, today=TODAY)
    assert pbi.completed_on == TODAY


def test_explicit_date_wins_over_the_stamp():
    pbi = _pbi()
    apply_completion(pbi, ACTIVE, DONE, explicit_date=EARLIER, today=TODAY)
    assert pbi.completed_on == EARLIER


def test_explicit_date_corrects_an_item_that_stays_done():
    pbi = _pbi(TODAY)
    apply_completion(pbi, DONE, DONE, explicit_date=EARLIER, today=TODAY)
    assert pbi.completed_on == EARLIER


def test_explicit_date_is_ignored_for_an_item_that_is_not_done():
    pbi = _pbi()
    apply_completion(pbi, NEW, ACTIVE, explicit_date=EARLIER, today=TODAY)
    assert pbi.completed_on is None


def test_create_in_a_done_state_is_stamped():
    pbi = _pbi()
    apply_completion(pbi, None, DONE, today=TODAY)
    assert pbi.completed_on == TODAY


def test_create_without_a_state_leaves_no_date():
    pbi = _pbi()
    apply_completion(pbi, None, None, today=TODAY)
    assert pbi.completed_on is None


def test_moving_between_non_done_states_leaves_no_date():
    pbi = _pbi()
    apply_completion(pbi, NEW, ACTIVE, today=TODAY)
    assert pbi.completed_on is None


def test_no_state_change_never_rewrites_the_date():
    """A State recategorised after the fact leaves its items alone (§5.6)."""
    recategorised = _state("Shipped", "in_progress")
    pbi = _pbi(EARLIER)
    apply_completion(pbi, recategorised, recategorised, today=TODAY)
    assert pbi.completed_on == EARLIER


def test_a_stale_date_is_not_restamped_on_entering_done():
    """The stamp fires only while the date is null (§4.1)."""
    pbi = _pbi(EARLIER)
    apply_completion(pbi, ACTIVE, DONE, today=TODAY)
    assert pbi.completed_on == EARLIER
