"""The §6.3 velocity suggestion over a seeded team (spec/team-achievement.md §6.3, §10).

The figure is read off the Achievement grid, so these tests only watch which
columns it keeps — closed, dated, measured, given PD — and how it divides. One
full-time member gives 1 PD per working day; sprint lengths vary on purpose so a
ratio of sums and a mean of ratios would disagree.
"""
from datetime import date

import pytest

from tests.integration.test_team_achievement import _TEAMS, Board, _project, _team

# Mon–Fri fortnights give 10 PD, the one-week sprint 5 PD.
OLD = (date(2026, 3, 23), date(2026, 4, 3))  # 10 PD
C1 = (date(2026, 4, 6), date(2026, 4, 17))  # 10 PD
C2 = (date(2026, 4, 20), date(2026, 4, 24))  # 5 PD
OPEN = (date(2026, 4, 27), date(2026, 5, 8))  # 10 PD
DRAFT = (date(2026, 5, 11), date(2026, 5, 22))  # 10 PD


def _url(team_id: str, project_id: str) -> str:
    return f"{_TEAMS}/{team_id}/projects/{project_id}/velocity"


async def _velocity(client, team_id: str, project_id: str, **params) -> dict:
    resp = await client.get(_url(team_id, project_id), params=params or None)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _pi(board: Board, name: str, sprints, state: str) -> None:
    pi, _, _ = await board.pi(name, sprints)
    pi.state = state


@pytest.fixture
async def history(client, db) -> dict:
    """Alpha (pts, factor 1.5), sole project of a one-member team.

    Closed:      OLD 30 pts / 10 PD, C1 10 pts / 10 PD, C2 10 pts / 5 PD
    In progress: OPEN 50 pts / 10 PD
    Draft:       DRAFT 40 pts / 10 PD
    """
    team = await _team(client)
    alpha = await _project(
        client, team["system_id"], "Alpha", "pts", available_source="factor", units_per_pd=1.5
    )
    board = Board(db, alpha["system_id"])
    await _pi(board, "Old", [OLD], "closed")
    await _pi(board, "Q2", [C1, C2], "closed")
    await _pi(board, "Now", [OPEN], "in_progress")
    await _pi(board, "Next", [DRAFT], "draft")
    done = await board.state("story", "Done", "done")
    for title, points, sprint in (
        ("old", 30, OLD), ("c1", 10, C1), ("c2", 10, C2), ("open", 50, OPEN), ("draft", 40, DRAFT),
    ):
        await board.item(title, effort=points, state=done, completed_on=sprint[0])
    await db.commit()
    return {"team": team, "alpha": alpha}


async def test_a_ratio_of_sums_over_the_latest_closed_sprints(client, history):
    body = await _velocity(
        client, history["team"]["system_id"], history["alpha"]["system_id"], sprints=2
    )
    assert body["project_id"] == history["alpha"]["system_id"]
    assert body["effort_unit"] == "pts"
    assert body["units_per_pd"] == 1.5
    assert body["sprints_requested"] == 2
    assert [s["label"] for s in body["sprints"]] == ["Q2.1", "Q2.2"]
    assert body["sprints"][1] == {
        "label": "Q2.2",
        "start_date": "2026-04-20",
        "end_date": "2026-04-24",
        "achieved": 10.0,
        "pd_given": 5.0,
    }
    # (10 + 10) ÷ (10 + 5), not the mean of 1.0 and 2.0.
    assert body["velocity"] == pytest.approx(20 / 15)


async def test_open_pis_are_never_measured(client, history):
    """Default N = 3: the three closed sprints, oldest first; OPEN and DRAFT left out."""
    body = await _velocity(client, history["team"]["system_id"], history["alpha"]["system_id"])
    assert body["sprints_requested"] == 3
    assert [s["label"] for s in body["sprints"]] == ["Old.1", "Q2.1", "Q2.2"]
    assert body["velocity"] == pytest.approx(50 / 25)


async def test_fewer_closed_sprints_than_requested_uses_what_exists(client, history):
    body = await _velocity(
        client, history["team"]["system_id"], history["alpha"]["system_id"], sprints=10
    )
    assert body["sprints_requested"] == 10
    assert len(body["sprints"]) == 3
    assert body["velocity"] == pytest.approx(2.0)


async def test_the_suggestion_matches_the_grids_own_figures(client, history):
    team_id = history["team"]["system_id"]
    grid = (await client.get(f"{_TEAMS}/{team_id}/achievement")).json()
    row = grid["projects"][0]
    body = await _velocity(client, team_id, history["alpha"]["system_id"], sprints=10)
    by_label = {c["label"]: i for i, c in enumerate(grid["sprints"])}
    for sprint in body["sprints"]:
        index = by_label[sprint["label"]]
        assert sprint["achieved"] == row["achieved"][index]
        assert sprint["pd_given"] == row["pd_given"][index]


async def test_no_closed_sprint_measures_nothing(client, db):
    team = await _team(client)
    project = await _project(client, team["system_id"], "Alpha")
    board = Board(db, project["system_id"])
    await _pi(board, "Now", [C1], "in_progress")
    done = await board.state("story", "Done", "done")
    await board.item("x", effort=8, state=done, completed_on=C1[0])
    await db.commit()

    body = await _velocity(client, team["system_id"], project["system_id"])
    assert body["sprints"] == []
    assert body["velocity"] is None


async def test_a_sprint_given_no_pd_is_skipped(client, db):
    """A weekend-only sprint gives 0 PD: points there cannot make a rate."""
    team = await _team(client)
    project = await _project(client, team["system_id"], "Alpha")
    board = Board(db, project["system_id"])
    weekend = (date(2026, 4, 18), date(2026, 4, 19))
    await _pi(board, "Q2", [C1, weekend], "closed")
    done = await board.state("story", "Done", "done")
    await board.item("weekday", effort=5, state=done, completed_on=C1[0])
    await board.item("weekend", effort=9, state=done, completed_on=weekend[0])
    await db.commit()

    body = await _velocity(client, team["system_id"], project["system_id"])
    assert [s["label"] for s in body["sprints"]] == ["Q2.1"]
    assert body["velocity"] == pytest.approx(0.5)


async def test_an_undated_sprint_is_skipped(client, db):
    team = await _team(client)
    project = await _project(client, team["system_id"], "Alpha")
    board = Board(db, project["system_id"])
    await _pi(board, "Q2", [C1, None], "closed")
    done = await board.state("story", "Done", "done")
    await board.item("x", effort=4, state=done, completed_on=C1[1])
    await db.commit()

    body = await _velocity(client, team["system_id"], project["system_id"])
    assert [s["label"] for s in body["sprints"]] == ["Q2.1"]
    assert body["velocity"] == pytest.approx(0.4)


async def test_a_project_with_no_done_state_has_no_velocity(client, db):
    team = await _team(client)
    project = await _project(client, team["system_id"], "Alpha")
    board = Board(db, project["system_id"])
    await _pi(board, "Q2", [C1], "closed")
    active = await board.state("story", "Active", "in_progress")
    await board.item("x", effort=4, state=active, completed_on=C1[0])
    await db.commit()

    body = await _velocity(client, team["system_id"], project["system_id"])
    assert body["sprints"] == []
    assert body["velocity"] is None


async def test_a_second_project_reads_its_own_row(client, db):
    """Columns are the anchor's calendar; a served non-anchor project is measured on them."""
    team = await _team(client)
    anchor = await _project(client, team["system_id"], "Anchor", share_pct=50)
    other = await _project(client, team["system_id"], "Other", share_pct=50)
    for project, points in ((anchor, 1), (other, 6)):
        board = Board(db, project["system_id"])
        await _pi(board, "Q2", [C1], "closed")
        done = await board.state("story", "Done", "done")
        await board.item("x", effort=points, state=done, completed_on=C1[0])
    await db.commit()

    body = await _velocity(client, team["system_id"], other["system_id"])
    assert body["project_id"] == other["system_id"]
    assert body["sprints"][0]["pd_given"] == pytest.approx(5.0)
    assert body["velocity"] == pytest.approx(6 / 5)


# ── Guard and not-found ───────────────────────────────────────────────────────

async def test_a_reader_can_read_the_velocity(reader_client, history):
    resp = await reader_client.get(
        _url(history["team"]["system_id"], history["alpha"]["system_id"])
    )
    assert resp.status_code == 200, resp.text


async def test_an_unknown_team_is_a_404(client, history):
    resp = await client.get(_url("no-such-team", history["alpha"]["system_id"]))
    assert resp.status_code == 404


async def test_a_project_the_team_does_not_serve_is_a_404(client, history):
    resp = await client.post("/api/v1/projects/", json={"name": "Elsewhere"})
    assert resp.status_code == 201, resp.text
    elsewhere = resp.json()["system_id"]
    resp = await client.get(_url(history["team"]["system_id"], elsewhere))
    assert resp.status_code == 404
    resp = await client.get(_url(history["team"]["system_id"], "no-such-project"))
    assert resp.status_code == 404


@pytest.mark.parametrize("sprints", [0, 11])
async def test_sprints_out_of_range_is_a_422(client, history, sprints):
    resp = await client.get(
        _url(history["team"]["system_id"], history["alpha"]["system_id"]),
        params={"sprints": sprints},
    )
    assert resp.status_code == 422
