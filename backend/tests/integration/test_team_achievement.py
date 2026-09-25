"""The Achievement grid over a seeded team (spec/team-achievement.md §5.3, §5.5, §10).

Where a point lands is unit-tested in `tests/unit/test_achievement.py`. These
tests watch the assembly: which items are loaded, which States count as done,
how placement finds Committed, and how the capacity report's columns and PD reach
each row and the team total.

Teams, members and assignments go through the API, so capacity is computed the
real way. The calendar, States and items are written straight to the session:
alignment and edit-lock rules are not what is under test, and a grid with
deliberately misaligned or overlapping sprints could not be built through them.
"""
from datetime import date

import pytest

from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.project_state import ProjectState
from app.models.sprint import Sprint
from app.models.swimline import Swimline

_TEAMS = "/api/v1/teams"

# Three fortnights of the anchor calendar, a weekend apart, Mon–Fri each: one
# full-time member gives 10 PD per sprint.
S1 = (date(2026, 4, 6), date(2026, 4, 17))
S2 = (date(2026, 4, 20), date(2026, 5, 1))
S3 = (date(2026, 5, 4), date(2026, 5, 15))


def _url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/achievement"


async def _achievement(client, team_id: str, **params) -> dict:
    resp = await client.get(_url(team_id), params=params or None)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _team(client, name: str = "Platform", members: int = 1) -> dict:
    team = (await client.post(_TEAMS, json={"name": name})).json()
    for index in range(members):
        resp = await client.post(
            f"{_TEAMS}/{team['system_id']}/members",
            json={"name": f"Member {index}", "pattern": {"effective_from": "2026-01-01"}},
        )
        assert resp.status_code == 201, resp.text
    return team


async def _project(client, team_id: str, name: str, effort_unit: str = "pts", **fields) -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": name, "effort_unit": effort_unit})
    assert resp.status_code == 201, resp.text
    project = resp.json()
    resp = await client.post(
        f"{_TEAMS}/{team_id}/projects", json={"project_id": project["system_id"], **fields}
    )
    assert resp.status_code == 201, resp.text
    return project


class Board:
    """One project's calendar, States and items, written straight to the session."""

    def __init__(self, db, project_id: str) -> None:
        self.db = db
        self.project_id = project_id
        self.feature = Feature(project_id=project_id, title="Feature")
        db.add(self.feature)
        self.states: dict[tuple[str, str], ProjectState] = {}
        self._groups = 0

    async def pi(
        self, name: str, sprints: list[tuple[date, date] | None]
    ) -> tuple[PI, Swimline, list[Sprint]]:
        dated = [s for s in sprints if s is not None]
        pi = PI(
            project_id=self.project_id,
            name=name,
            start_date=min(s[0] for s in dated) if dated else None,
            end_date=max(s[1] for s in dated) if dated else None,
        )
        self.db.add(pi)
        await self.db.flush()
        rows = [
            Sprint(
                pi_id=pi.system_id,
                sprint_index=index,
                available=0,
                start_date=dates[0] if dates else None,
                end_date=dates[1] if dates else None,
            )
            for index, dates in enumerate(sprints)
        ]
        swimline = Swimline(pi_id=pi.system_id, name="Lane", order_index=0)
        self.db.add_all([*rows, swimline])
        await self.db.flush()
        return pi, swimline, rows

    async def state(self, item_type: str, value: str, category: str | None) -> ProjectState:
        state = ProjectState(
            project_id=self.project_id, item_type=item_type, value=value, category=category
        )
        self.db.add(state)
        await self.db.flush()
        self.states[(item_type, value)] = state
        return state

    async def item(
        self,
        title: str,
        *,
        effort: float | None,
        state: ProjectState | None = None,
        completed_on: date | None = None,
        item_type: str = "story",
        placed: tuple[Swimline, int] | None = None,
        user_id: int | None = None,
    ) -> PBI:
        group_id = None
        if placed is not None:
            swimline, sprint_index = placed
            self._groups += 1
            group = Group(
                swimline_id=swimline.system_id,
                feature_system_id=self.feature.system_id,
                name=f"Group {self._groups}",
                sprint_index=sprint_index,
            )
            self.db.add(group)
            await self.db.flush()
            group_id = group.system_id
        pbi = PBI(
            project_id=self.project_id,
            parent_feature_system_id=self.feature.system_id,
            title=title,
            effort=effort,
            item_type=item_type,
            state_id=state.system_id if state else None,
            completed_on=completed_on,
            group_id=group_id,
            user_id=user_id,
        )
        self.db.add(pbi)
        await self.db.flush()
        return pbi


@pytest.fixture
async def grid(client, db) -> dict:
    """Two projects over one member's 10 PD a sprint.

    Alpha (anchor, pts, factor 1.5 at 70%): sprints S1–S3 plus an undated fourth.
      A1  5 pts, planned in S1, completed 6 May (S3)  → committed S1, achieved S3
      A2  3 pts, planned in S1, still Active          → committed S1 only
      A3  2 pts bug, unplanned, closed 17 Apr (S1 end) → achieved S1, boundary
      A4  no estimate, completed 20 Apr (S2 start)     → 0 pts, listed in S2
      A5  4 pts, completed 30 Jun (after the calendar) → outside
      A6  7 pts, Done with no date                     → done but undated

    Beta (sp, factor 0.5 at 30%): sprints on S1 and S2 only; its bug list has no
    done State.
      B1  6 sp, planned in S2, completed 8 Apr (S1)    → committed S2, achieved S1
      B2  9 sp bug, planned in S2, not done           → committed S2 only
    """
    team = await _team(client)
    alpha = await _project(
        client, team["system_id"], "Alpha", "pts",
        share_pct=70, available_source="factor", units_per_pd=1.5,
    )
    beta = await _project(
        client, team["system_id"], "Beta", "sp",
        share_pct=30, available_source="factor", units_per_pd=0.5,
    )

    a = Board(db, alpha["system_id"])
    _, a_lane, _ = await a.pi("Q2", [S1, S2, S3, None])
    done = await a.state("story", "Done", "done")
    active = await a.state("story", "Active", "in_progress")
    closed = await a.state("bug", "Closed", "done")
    await a.item("A1", effort=5, state=done, completed_on=date(2026, 5, 6),
                 placed=(a_lane, 0), user_id=101)
    await a.item("A2", effort=3, state=active, placed=(a_lane, 0))
    await a.item("A3", effort=2, state=closed, completed_on=S1[1], item_type="bug", user_id=103)
    await a.item("A4", effort=None, state=done, completed_on=S2[0])
    await a.item("A5", effort=4, state=done, completed_on=date(2026, 6, 30))
    await a.item("A6", effort=7, state=done)

    b = Board(db, beta["system_id"])
    _, b_lane, _ = await b.pi("B-PI", [S1, S2])
    b_done = await b.state("story", "Done", "done")
    fixed = await b.state("bug", "Fixed", None)
    await b.item("B1", effort=6, state=b_done, completed_on=date(2026, 4, 8), placed=(b_lane, 1))
    await b.item("B2", effort=9, state=fixed, item_type="bug", placed=(b_lane, 1))
    await db.commit()
    return {"team": team, "alpha": alpha, "beta": beta}


def _row(body: dict, name: str) -> dict:
    return next(p for p in body["projects"] if p["name"] == name)


# ── The grid ──────────────────────────────────────────────────────────────────

async def test_the_columns_and_pd_are_the_capacity_views(client, grid):
    team_id = grid["team"]["system_id"]
    body = await _achievement(client, team_id)
    capacity = (await client.get(f"{_TEAMS}/{team_id}/capacity")).json()

    assert body["team_id"] == team_id
    assert body["anchor_project_id"] == grid["alpha"]["system_id"]
    assert body["sprints"] == capacity["sprints"]
    assert [s["label"] for s in body["sprints"]] == ["Q2.1", "Q2.2", "Q2.3", "Q2.4"]
    assert [p["name"] for p in body["projects"]] == ["Alpha", "Beta"]
    for row, cap in zip(body["projects"], capacity["projects"], strict=True):
        assert row["pd_given"] == cap["person_days"]
    assert body["team"]["available_pd"] == [
        cell["person_days"] if cell else None for cell in capacity["team"]
    ]
    assert body["team"]["available_pd"] == [10.0, 10.0, 10.0, None]


async def test_committed_and_achieved_diverge(client, grid):
    """Planned in sprint 1, completed in sprint 3: counted in each, by its own rule."""
    alpha = _row(await _achievement(client, grid["team"]["system_id"]), "Alpha")

    assert alpha["committed"] == [8.0, 0.0, 0.0, None]
    assert alpha["achieved"] == [2.0, 0.0, 5.0, None]
    assert alpha["pd_given"] == [pytest.approx(7.0)] * 3 + [None]
    assert alpha["velocity"] == [pytest.approx(2 / 7), 0.0, pytest.approx(5 / 7), None]
    assert alpha["in_pd_total"] is True
    assert alpha["effort_unit"] == "pts"
    assert alpha["share_pct"] == 70
    assert alpha["units_per_pd"] == 1.5
    assert alpha["item_types_without_done_state"] == []


async def test_achieved_items_are_listed_behind_each_cell(client, grid):
    alpha = _row(await _achievement(client, grid["team"]["system_id"]), "Alpha")
    cells = alpha["achieved_items"]
    assert [[i["title"] for i in cell] for cell in cells] == [["A3"], ["A4"], ["A1"], []]

    a3 = cells[0][0]
    assert a3["id"] == 103
    assert a3["item_type"] == "bug"
    assert a3["effort"] == 2.0
    assert a3["completed_on"] == "2026-04-17"
    assert a3["system_id"]
    # No estimate: worth nothing, still listed.
    assert cells[1][0]["effort"] is None


async def test_outside_the_calendar_and_done_but_undated(client, grid):
    body = await _achievement(client, grid["team"]["system_id"])
    alpha, beta = _row(body, "Alpha"), _row(body, "Beta")
    assert alpha["outside_calendar_points"] == 4.0
    assert alpha["done_undated_count"] == 1
    assert beta["outside_calendar_points"] == 0.0
    assert beta["done_undated_count"] == 0


async def test_a_project_with_no_sprint_on_a_columns_dates_has_no_committed(client, grid):
    """Beta has no sprint on S3: Committed reads null, Achieved still a number."""
    beta = _row(await _achievement(client, grid["team"]["system_id"]), "Beta")
    assert beta["committed"] == [0.0, 15.0, None, None]
    assert beta["achieved"] == [6.0, 0.0, 0.0, None]
    assert beta["velocity"] == [pytest.approx(2.0), 0.0, 0.0, None]


async def test_only_the_list_lacking_a_done_state_is_named(client, grid):
    beta = _row(await _achievement(client, grid["team"]["system_id"]), "Beta")
    assert beta["item_types_without_done_state"] == ["bug"]


async def test_the_team_total_converts_through_each_factor(client, grid):
    team = (await _achievement(client, grid["team"]["system_id"]))["team"]
    # S1: 2 pts ÷ 1.5 + 6 sp ÷ 0.5 = 13.33 PD; S3: 5 ÷ 1.5 = 3.33 PD.
    assert team["achieved_pd"] == [pytest.approx(2 / 1.5 + 12), 0.0, pytest.approx(5 / 1.5), None]
    assert team["realised"] == [
        pytest.approx((2 / 1.5 + 12) / 10), 0.0, pytest.approx(5 / 15), None
    ]


async def test_an_undated_column_is_null_in_every_row(client, grid):
    body = await _achievement(client, grid["team"]["system_id"])
    assert body["sprints"][3]["computable"] is False
    for row in body["projects"]:
        for key in ("committed", "achieved", "pd_given", "velocity"):
            assert row[key][3] is None, key
        assert row["achieved_items"][3] == []
    for key in ("achieved_pd", "available_pd", "realised"):
        assert body["team"][key][3] is None


async def test_a_window_hides_columns_without_moving_points(client, grid):
    team_id = grid["team"]["system_id"]
    body = await _achievement(client, team_id, **{"from": "2026-04-20", "to": "2026-05-01"})
    assert [s["label"] for s in body["sprints"]] == ["Q2.2"]
    alpha, beta = _row(body, "Alpha"), _row(body, "Beta")
    assert alpha["achieved"] == [0.0]
    assert [i["title"] for i in alpha["achieved_items"][0]] == ["A4"]
    # A1 (S3) and A3 (S1) are hidden, not outside: the footer is unchanged.
    assert alpha["outside_calendar_points"] == 4.0
    assert beta["outside_calendar_points"] == 0.0
    assert beta["committed"] == [15.0]

    later = await _achievement(client, team_id, **{"from": "2026-05-04"})
    assert _row(later, "Alpha")["achieved"] == [5.0]
    assert _row(later, "Beta")["committed"] == [None]


# ── Unmeasured and excluded projects ──────────────────────────────────────────

async def test_a_project_with_no_done_state_measures_nothing(client, db):
    team = await _team(client)
    project = await _project(
        client, team["system_id"], "Gamma", share_pct=100, available_source="factor",
        units_per_pd=1.0,
    )
    board = Board(db, project["system_id"])
    _, lane, _ = await board.pi("G", [S1])
    todo = await board.state("story", "To Do", "not_started")
    await board.item("G1", effort=5, state=todo, placed=(lane, 0))
    await db.commit()

    body = await _achievement(client, team["system_id"])
    row = body["projects"][0]
    assert row["item_types_without_done_state"] == ["story", "bug"]
    assert row["achieved"] == [None]
    assert row["velocity"] == [None]
    assert row["achieved_items"] == [[]]
    # Placement needs no done State: the plan is still known.
    assert row["committed"] == [5.0]
    assert row["outside_calendar_points"] == 0.0
    assert row["done_undated_count"] == 0
    # The only project measures nothing, so neither does the team.
    assert body["team"]["achieved_pd"] == [None]
    assert body["team"]["realised"] == [None]
    assert body["team"]["available_pd"] == [10.0]


async def test_a_manual_project_keeps_its_velocity_but_leaves_the_pd_total(client, db):
    team = await _team(client)
    alpha = await _project(
        client, team["system_id"], "Alpha", share_pct=50, available_source="factor",
        units_per_pd=2.0,
    )
    manual = await _project(client, team["system_id"], "Manual", share_pct=50)
    for project, points in ((alpha, 8.0), (manual, 30.0)):
        board = Board(db, project["system_id"])
        await board.pi("P", [S1])
        done = await board.state("story", "Done", "done")
        await board.item("x", effort=points, state=done, completed_on=date(2026, 4, 9))
    await db.commit()

    body = await _achievement(client, team["system_id"])
    manual_row = _row(body, "Manual")
    assert manual_row["in_pd_total"] is False
    assert manual_row["available_source"] == "manual"
    assert manual_row["achieved"] == [30.0]
    assert manual_row["velocity"] == [pytest.approx(30 / 5)]
    assert _row(body, "Alpha")["in_pd_total"] is True
    # Only Alpha's 8 pts ÷ 2.0 reach the total.
    assert body["team"]["achieved_pd"] == [4.0]
    assert body["team"]["realised"] == [pytest.approx(0.4)]


async def test_a_team_of_manual_projects_has_no_pd_total(client, db):
    team = await _team(client)
    project = await _project(client, team["system_id"], "Manual")
    board = Board(db, project["system_id"])
    await board.pi("P", [S1])
    done = await board.state("story", "Done", "done")
    await board.item("x", effort=3, state=done, completed_on=date(2026, 4, 9))
    await db.commit()

    body = await _achievement(client, team["system_id"])
    assert body["projects"][0]["achieved"] == [3.0]
    assert body["team"]["achieved_pd"] == [None]
    assert body["team"]["realised"] == [None]


# ── Calendar edge cases ───────────────────────────────────────────────────────

async def test_overlapping_sprints_count_a_point_once(client, db):
    team = await _team(client)
    project = await _project(
        client, team["system_id"], "Alpha", available_source="factor", units_per_pd=1.0
    )
    board = Board(db, project["system_id"])
    await board.pi("O", [(date(2026, 4, 6), date(2026, 4, 20)), (date(2026, 4, 13), date(2026, 4, 24))])
    done = await board.state("story", "Done", "done")
    await board.item("x", effort=8, state=done, completed_on=date(2026, 4, 15))
    await db.commit()

    row = (await _achievement(client, team["system_id"]))["projects"][0]
    assert row["achieved"] == [8.0, 0.0]
    assert row["outside_calendar_points"] == 0.0


async def test_a_completion_in_a_gap_between_pis_is_outside(client, db):
    team = await _team(client)
    project = await _project(client, team["system_id"], "Alpha")
    board = Board(db, project["system_id"])
    await board.pi("First", [S1])
    await board.pi("Second", [S3])
    done = await board.state("story", "Done", "done")
    await board.item("gap", effort=3, state=done, completed_on=date(2026, 4, 24))
    await board.item("before", effort=2, state=done, completed_on=date(2026, 1, 5))
    await db.commit()

    row = (await _achievement(client, team["system_id"]))["projects"][0]
    assert row["achieved"] == [0.0, 0.0]
    assert row["outside_calendar_points"] == 5.0


async def test_a_state_moved_off_done_no_longer_counts(client, db):
    """By construction a dated item is done; the route filters on done anyway."""
    team = await _team(client)
    project = await _project(client, team["system_id"], "Alpha")
    board = Board(db, project["system_id"])
    await board.pi("P", [S1])
    await board.state("story", "Done", "done")
    reopened = await board.state("story", "Reopened", "in_progress")
    await board.item("x", effort=3, state=reopened, completed_on=date(2026, 4, 9))
    await db.commit()

    row = (await _achievement(client, team["system_id"]))["projects"][0]
    assert row["achieved"] == [0.0]


# ── Guard and empty states ────────────────────────────────────────────────────

async def test_a_reader_can_read_achievement(client, reader_client, grid):
    resp = await reader_client.get(_url(grid["team"]["system_id"]))
    assert resp.status_code == 200, resp.text


async def test_an_unknown_team_is_a_404(client):
    resp = await client.get(_url("no-such-team"))
    assert resp.status_code == 404


async def test_a_team_with_no_project_has_no_calendar(client):
    team = await _team(client)
    body = await _achievement(client, team["system_id"])
    assert body == {
        "team_id": team["system_id"],
        "anchor_project_id": None,
        "sprints": [],
        "projects": [],
        "team": {"achieved_pd": [], "available_pd": [], "realised": []},
    }
