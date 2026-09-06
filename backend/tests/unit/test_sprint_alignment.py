"""The alignment comparison itself, with no database in the way (§6.8).

`conflicts_between` is pure over two lists of PI windows, so the cases that are
awkward to stage through the API — an undated sprint, two PIs that never meet,
a PI with no dated sprint at all — are cheap to state here.
"""
from datetime import date

from app.services.sprint_alignment import PIWindow, conflicts_between


def _window(
    project: str,
    pi: str,
    sprints: dict[int, tuple[str, str]],
    span: tuple[str, str] | None = None,
) -> PIWindow:
    dated = {
        index: (date.fromisoformat(start), date.fromisoformat(end))
        for index, (start, end) in sprints.items()
    }
    if dated:
        start = min(pair[0] for pair in dated.values())
        end = max(pair[1] for pair in dated.values())
    elif span is not None:
        start, end = date.fromisoformat(span[0]), date.fromisoformat(span[1])
    else:
        start, end = None, None  # type: ignore[assignment]
    return PIWindow(
        project_id=project,
        project_name=project,
        pi_id=f"{project}-{pi}",
        pi_name=pi,
        start=start,
        end=end,
        sprints=dated,
    )


_ISK = {0: ("2026-04-06", "2026-04-17"), 1: ("2026-04-20", "2026-05-01")}


def test_identical_calendars_agree():
    mine = [_window("isk", "PI-7", _ISK)]
    theirs = [_window("dx", "Q2", _ISK)]
    assert conflicts_between(mine, theirs) == []


def test_a_shifted_sprint_is_a_conflict_naming_both_ranges():
    mine = [_window("isk", "PI-7", _ISK)]
    theirs = [_window("dx", "Q2", {**_ISK, 1: ("2026-04-21", "2026-05-02")})]

    found = conflicts_between(mine, theirs)
    assert len(found) == 1
    assert found[0].sprint_index == 1
    assert found[0].start_date == date(2026, 4, 20)
    assert found[0].other_start_date == date(2026, 4, 21)
    assert "Q2" in found[0].message() and "PI-7" in found[0].message()


def test_pis_that_never_overlap_are_never_compared():
    mine = [_window("isk", "PI-7", _ISK)]
    theirs = [_window("dx", "Q4", {0: ("2026-10-05", "2026-10-16")})]
    assert conflicts_between(mine, theirs) == []


def test_an_index_the_other_pi_has_not_dated_is_not_a_conflict():
    # Undated is not misaligned; it is not yet placed.
    mine = [_window("isk", "PI-7", _ISK)]
    theirs = [_window("dx", "Q2", {0: ("2026-04-06", "2026-04-17")})]
    assert conflicts_between(mine, theirs) == []


def test_a_pi_with_no_dated_sprint_cannot_overlap_anything():
    mine = [_window("isk", "PI-7", _ISK)]
    # Its span comes from its own PI dates, but it has no sprint to disagree over.
    theirs = [_window("dx", "Q2", {}, span=("2026-04-06", "2026-05-01"))]
    assert conflicts_between(mine, theirs) == []


def test_a_project_is_never_compared_against_itself():
    mine = [_window("isk", "PI-7", _ISK)]
    theirs = [_window("isk", "PI-8", {**_ISK, 0: ("2026-04-07", "2026-04-18")})]
    # Alignment is between projects. Two PIs of the *same* project overlapping is
    # a different problem, and not this rule's to police.
    assert conflicts_between(mine, theirs) == []
