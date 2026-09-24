"""Assignment, and the capacity a team has for what it serves (§6.1–§6.4, §7.6).

The arithmetic itself is unit-tested against hand-computed fixtures in
`tests/unit/test_team_capacity.py`; what these tests watch is everything around
it — which sprints become columns, which cells are null rather than zero, where
the share and the factor apply, and the one place a float becomes an integer.
"""
import pytest

from app.schemas import MAX_PROJECTS_PER_TEAM
from app.services.events import broadcaster, team_channel

_TEAMS = "/api/v1/teams"


def _projects_url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/projects"


def _if_match(etag: str) -> dict[str, str]:
    return {"If-Match": etag}


async def _project(client, name: str, effort_unit: str = "pts") -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": name, "effort_unit": effort_unit})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _pi_with_sprints(client, project_id: str, name: str, sprints: list[dict]) -> dict:
    """A PI, with dates written onto the sprints it was created with.

    A PI always arrives with five sprints and no dates, so the fixture patches
    the ones a test cares about. Dates are what make a sprint computable at all
    (§5.3), and everything untouched here stays an undated column.
    """
    resp = await client.post(
        f"/api/v1/projects/{project_id}/pis", json={"name": name, "start_date": "2026-04-06"}
    )
    assert resp.status_code == 201, resp.text
    pi = resp.json()

    existing = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    by_index = {s["sprint_index"]: s for s in existing}
    for sprint in sprints:
        fields = {k: v for k, v in sprint.items() if k != "sprint_index"}
        if not fields:
            continue
        target = by_index[sprint["sprint_index"]]
        patched = await client.patch(f"/api/v1/sprints/{target['system_id']}", json=fields)
        assert patched.status_code == 200, patched.text
    return pi


async def _member(client, team_id: str, name: str, **pattern) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01", **pattern}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _assign(client, team_id: str, project_id: str, **fields) -> dict:
    resp = await client.post(_projects_url(team_id), json={"project_id": project_id, **fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _capacity(client, team_id: str, **params) -> dict:
    resp = await client.get(f"{_TEAMS}/{team_id}/capacity", params=params or None)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
async def team(client) -> dict:
    resp = await client.post(_TEAMS, json={"name": "Platform"})
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture
async def project(client) -> dict:
    return await _project(client, "ISK Portal")


# ── Assignment ────────────────────────────────────────────────────────────────

async def test_a_team_serves_nothing_until_a_project_is_assigned(client, team):
    resp = await client.get(_projects_url(team["system_id"]))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_assigning_a_project_defaults_to_manual_at_full_share(client, team, project):
    body = await _assign(client, team["system_id"], project["system_id"])

    assert body["project_name"] == "ISK Portal"
    assert body["effort_unit"] == "pts"
    assert body["share_pct"] == 100
    # Nothing about an existing project changes until someone opts in (§6.4).
    assert body["available_source"] == "manual"
    assert body["units_per_pd"] == 1.0
    assert body["is_anchor"] is True


async def test_the_first_project_assigned_is_the_anchor(client, team, project):
    # Its sprint calendar is the one the team's own views count in (§6.8).
    second = await _project(client, "Data Exchange")
    await _assign(client, team["system_id"], project["system_id"])
    await _assign(client, team["system_id"], second["system_id"], share_pct=30)

    rows = (await client.get(_projects_url(team["system_id"]))).json()
    assert [r["project_name"] for r in rows] == ["ISK Portal", "Data Exchange"]
    assert [r["is_anchor"] for r in rows] == [True, False]


async def test_a_project_is_served_by_at_most_one_team(client, team, project):
    other = (await client.post(_TEAMS, json={"name": "Frontline"})).json()
    await _assign(client, team["system_id"], project["system_id"])

    resp = await client.post(
        _projects_url(other["system_id"]), json={"project_id": project["system_id"]}
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "PROJECT_ALREADY_ASSIGNED"
    # The holder is named, or "unassign it first" is a hunt through every team.
    assert "Platform" in detail["message"]


async def test_shares_over_a_hundred_percent_are_allowed(client, team, project):
    # Warn, never block: teams really are overcommitted, and refusing to represent
    # that hides what the tool exists to reveal (§6.3).
    second = await _project(client, "Data Exchange")
    await _assign(client, team["system_id"], project["system_id"], share_pct=70)
    await _assign(client, team["system_id"], second["system_id"], share_pct=60)

    rows = (await client.get(_projects_url(team["system_id"]))).json()
    assert sum(r["share_pct"] for r in rows) == 130


@pytest.mark.parametrize("share", [0, 101])
async def test_a_share_outside_one_to_a_hundred_is_rejected(client, team, project, share):
    resp = await client.post(
        _projects_url(team["system_id"]),
        json={"project_id": project["system_id"], "share_pct": share},
    )
    assert resp.status_code == 422


async def test_a_units_per_pd_of_zero_is_rejected(client, team, project):
    resp = await client.post(
        _projects_url(team["system_id"]),
        json={"project_id": project["system_id"], "units_per_pd": 0},
    )
    assert resp.status_code == 422


async def test_velocity_is_not_an_available_source_yet(client, team, project):
    # Phase 2: nothing can compute it on today's data (§6.5).
    resp = await client.post(
        _projects_url(team["system_id"]),
        json={"project_id": project["system_id"], "available_source": "velocity"},
    )
    assert resp.status_code == 422


async def test_assigning_a_project_that_does_not_exist_is_a_404(client, team):
    resp = await client.post(_projects_url(team["system_id"]), json={"project_id": "nope"})
    assert resp.status_code == 404


async def test_a_team_serves_at_most_twenty_projects(client, team):
    for index in range(MAX_PROJECTS_PER_TEAM):
        created = await _project(client, f"Project {index}")
        await _assign(client, team["system_id"], created["system_id"])

    extra = await _project(client, "One Too Many")
    resp = await client.post(
        _projects_url(team["system_id"]), json={"project_id": extra["system_id"]}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "PROJECT_LIMIT_REACHED"


async def test_an_assignment_can_switch_to_a_derived_available(client, team, project):
    assignment = await _assign(client, team["system_id"], project["system_id"])
    resp = await client.patch(
        f"{_projects_url(team['system_id'])}/{project['system_id']}",
        json={"available_source": "factor", "units_per_pd": 1.5, "share_pct": 70},
        headers=_if_match(assignment["etag"]),
    )
    assert resp.status_code == 200
    assert resp.json()["available_source"] == "factor"
    assert resp.json()["units_per_pd"] == 1.5
    assert resp.json()["share_pct"] == 70


async def test_unassigning_writes_nothing_to_the_project(client, team, project):
    # Available is always a value someone wrote, never a live view, so removing
    # the team removes nothing and plans do not silently deflate (§6.1).
    pi = await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    await client.patch(f"/api/v1/sprints/{sprints[0]['system_id']}", json={"available": 14})

    assignment = await _assign(client, team["system_id"], project["system_id"])
    resp = await client.delete(
        f"{_projects_url(team['system_id'])}/{project['system_id']}",
        headers=_if_match(assignment["etag"]),
    )
    assert resp.status_code == 204

    after = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    assert after[0]["available"] == 14


async def test_a_reader_can_see_assignments_but_not_make_them(client, reader_client, team, project):
    await _assign(client, team["system_id"], project["system_id"])
    assert len((await reader_client.get(_projects_url(team["system_id"]))).json()) == 1

    resp = await reader_client.post(
        _projects_url(team["system_id"]), json={"project_id": project["system_id"]}
    )
    assert resp.status_code == 403


async def test_a_stale_assignment_write_is_412(client, team, project):
    assignment = await _assign(client, team["system_id"], project["system_id"])
    url = f"{_projects_url(team['system_id'])}/{project['system_id']}"

    assert (await client.patch(url, json={"share_pct": 70}, headers=_if_match(assignment["etag"]))).status_code == 200
    resp = await client.patch(url, json={"share_pct": 50}, headers=_if_match(assignment["etag"]))
    assert resp.status_code == 412
    assert resp.json()["detail"]["current"]["share_pct"] == 70


async def test_assignment_writes_broadcast_on_the_team_channel(client, team, project):
    channel = team_channel(team["system_id"])
    q = broadcaster._subscribe(channel)
    try:
        assignment = await _assign(client, team["system_id"], project["system_id"])
        await client.delete(
            f"{_projects_url(team['system_id'])}/{project['system_id']}",
            headers=_if_match(assignment["etag"]),
        )
        events = []
        while not q.empty():
            events.append(q.get_nowait())
    finally:
        broadcaster._unsubscribe(channel, q)

    assert [e["type"] for e in events] == ["team:project:assigned", "team:project:unassigned"]


# ── Capacity ──────────────────────────────────────────────────────────────────

async def test_a_team_with_no_project_has_no_sprint_calendar(client, team):
    # It says so rather than inventing months (§7.0.1).
    body = await _capacity(client, team["system_id"])
    assert body["anchor_project_id"] is None
    assert body["sprints"] == []
    assert body["team"] == []


async def test_capacity_over_a_full_sprint_for_a_full_time_member(client, team, project):
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    await _member(client, team["system_id"], "Alice", focus=0.8)

    body = await _capacity(client, team["system_id"])

    assert body["sprints"][0]["label"] == "Q2-2026.1"
    assert body["sprints"][0]["computable"] is True
    cell = body["members"][0]["cells"][0]
    # 10 working days × 8 h = 80 h, × focus 0.8 = 64 h, ÷ 8 = 8 PD.
    assert cell["contracted_half_days"] == 20
    assert cell["contracted_hours"] == 80.0
    assert cell["net_hours"] == pytest.approx(64.0)
    assert cell["person_days"] == pytest.approx(8.0)
    assert cell["present_days"] == 10.0


async def test_a_part_timers_day_is_not_a_person_day(client, team, project):
    # PD is a unit of work, not of presence: a 6 h/day member's full day is
    # 0.75 PD (§5.2). Bob from the worked example, without meetings.
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    await _member(client, team["system_id"], "Bob", hours_per_day=6.0, fri_pm=False)

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["contracted_half_days"] == 18
    assert cell["net_hours"] == 54.0
    assert cell["person_days"] == 6.75
    # Present for 9 days, contributing 6.75 PD — different questions (§7.6).
    assert cell["present_days"] == 9.0


async def test_the_team_row_is_the_sum_of_its_members(client, team, project):
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    await _member(client, team["system_id"], "Alice", focus=0.8)
    await _member(client, team["system_id"], "Bob", hours_per_day=6.0, fri_pm=False)

    body = await _capacity(client, team["system_id"])
    total = body["team"][0]
    assert total["net_hours"] == pytest.approx(64.0 + 54.0)
    # team_PD == Σ member_PD, because the divisor is shared (§5.2).
    assert total["person_days"] == pytest.approx(8.0 + 6.75)
    assert total["person_days"] == pytest.approx(total["net_hours"] / body["normal_day_hours"])


async def test_a_contract_change_mid_sprint_needs_no_special_case(client, team, project):
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    member = await _member(client, team["system_id"], "Katrin")
    # From the second week, Fridays off.
    await client.post(
        f"{_TEAMS}/{team['system_id']}/members/{member['system_id']}/working-days",
        json={"effective_from": "2026-04-13", "fri_am": False, "fri_pm": False},
    )

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    # Nine working days: the second Friday is gone, the first is not.
    assert cell["contracted_half_days"] == 18
    assert cell["net_hours"] == 72.0


async def test_an_undated_sprint_is_null_and_never_zero(client, team, project):
    await _pi_with_sprints(
        client, project["system_id"], "Q2-2026",
        [
            {"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"},
            {"sprint_index": 1},
        ],
    )
    await _assign(client, team["system_id"], project["system_id"])
    await _member(client, team["system_id"], "Alice")

    body = await _capacity(client, team["system_id"])
    # A PI always carries five sprints; only the first was given dates.
    assert [s["computable"] for s in body["sprints"]] == [True, False, False, False, False]
    # Unknown and empty are different: a zero here would read as a team with no
    # capacity rather than a sprint nobody has dated (§5.3).
    assert body["members"][0]["cells"][1] is None
    assert body["team"][1] is None
    assert body["projects"][0]["person_days"][1] is None


async def test_a_window_keeps_only_the_sprints_it_covers(client, team, project):
    await _pi_with_sprints(
        client, project["system_id"], "Q2-2026",
        [
            {"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"},
            {"sprint_index": 1, "start_date": "2026-04-20", "end_date": "2026-05-01"},
        ],
    )
    await _assign(client, team["system_id"], project["system_id"])

    body = await _capacity(client, team["system_id"], **{"from": "2026-04-20", "to": "2026-05-31"})
    assert [s["sprint_number"] for s in body["sprints"]] == [2]


async def test_the_share_and_the_factor_reach_the_project_row(client, team, project):
    # The worked example from §6.4: 13.15 PD × 0.70 × 1.5 → 14 pts.
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    assignment = await _assign(
        client, team["system_id"], project["system_id"],
        share_pct=70, available_source="factor", units_per_pd=1.5,
    )
    assert assignment["available_source"] == "factor"
    await _member(client, team["system_id"], "Alice", focus=0.8)
    await _member(client, team["system_id"], "Bob", hours_per_day=6.0, fri_pm=False)

    row = (await _capacity(client, team["system_id"]))["projects"][0]
    assert row["effort_unit"] == "pts"
    assert row["person_days"][0] == pytest.approx((8.0 + 6.75) * 0.7)
    assert row["units"][0] == pytest.approx((8.0 + 6.75) * 0.7 * 1.5)
    # One rounding, half-up, at the boundary: 15.4875 → 15.
    assert row["proposed_available"][0] == 15


async def test_rounding_is_half_up_and_not_pythons_bankers_rounding(client, team, project):
    # round(2.5) == 2 in Python. A sprint header showing 2 for 2.5 points is a
    # bug nobody would find, so the boundary rounds half-up explicitly (§6.4).
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(
        client, team["system_id"], project["system_id"],
        available_source="factor", units_per_pd=0.25, share_pct=100,
    )
    # 10 PD × 0.25 = 2.5 units exactly.
    await _member(client, team["system_id"], "Alice")

    row = (await _capacity(client, team["system_id"]))["projects"][0]
    assert row["units"][0] == pytest.approx(2.5)
    assert row["proposed_available"][0] == 3


async def test_a_manual_project_proposes_nothing(client, team, project):
    # Nothing is meant to flow into a manual project (§6.4).
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    await _member(client, team["system_id"], "Alice")

    row = (await _capacity(client, team["system_id"]))["projects"][0]
    assert row["person_days"][0] is not None
    assert row["proposed_available"][0] is None



async def test_a_member_who_does_not_count_is_shown_but_not_totalled(client, team, project):
    # A PO whose holidays the team tracks: their row is there, with its full
    # chain, but the team total and every project share leave them out (§3.2).
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(
        client, team["system_id"], project["system_id"],
        available_source="factor", units_per_pd=1.0,
    )
    await _member(client, team["system_id"], "Alice")
    po = await _member(client, team["system_id"], "Pia")
    patched = await client.patch(
        f"{_TEAMS}/{team['system_id']}/members/{po['system_id']}",
        json={"counts_towards_capacity": False},
        headers={"If-Match": po["etag"]},
    )
    assert patched.status_code == 200, patched.text

    body = await _capacity(client, team["system_id"])

    rows = {m["name"]: m for m in body["members"]}
    assert rows["Alice"]["counts_towards_capacity"] is True
    assert rows["Pia"]["counts_towards_capacity"] is False
    assert rows["Pia"]["cells"][0]["person_days"] == pytest.approx(10.0)
    assert body["team"][0]["person_days"] == pytest.approx(10.0)
    assert body["team"][0]["contracted_half_days"] == 20
    assert body["projects"][0]["proposed_available"][0] == 10

async def test_capacity_counts_the_anchor_projects_calendar_only(client, team, project):
    # A second project's PIs are not columns: the anchor defines the calendar
    # every other project aligns to (§6.8, §7.0.1).
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    second = await _project(client, "Data Exchange")
    await _pi_with_sprints(
        client, second["system_id"],
        "Other-PI", [{"sprint_index": 0, "start_date": "2026-06-01", "end_date": "2026-06-12"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    await _assign(client, team["system_id"], second["system_id"], share_pct=30)

    body = await _capacity(client, team["system_id"])
    labels = [s["label"] for s in body["sprints"]]
    assert labels == ["Q2-2026.1", "Q2-2026.2", "Q2-2026.3", "Q2-2026.4", "Q2-2026.5"]
    assert not [label for label in labels if label.startswith("Other-PI")]
    # Both projects still get a row — they share the anchor's columns.
    assert [p["name"] for p in body["projects"]] == ["ISK Portal", "Data Exchange"]


async def test_a_member_outside_their_validity_window_contributes_nothing(client, team, project):
    await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    await _assign(client, team["system_id"], project["system_id"])
    resp = await client.post(
        f"{_TEAMS}/{team['system_id']}/members",
        json={"name": "Jonas", "active_from": "2026-10-01",
              "pattern": {"effective_from": "2026-01-01"}},
    )
    assert resp.status_code == 201

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["contracted_half_days"] == 0
    assert cell["person_days"] == 0.0


async def test_a_sprint_column_carries_what_the_header_holds_today(client, team, project):
    pi = await _pi_with_sprints(
        client, project["system_id"],
        "Q2-2026", [{"sprint_index": 0, "start_date": "2026-04-06", "end_date": "2026-04-17"}],
    )
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    await client.patch(f"/api/v1/sprints/{sprints[0]['system_id']}", json={"available": 12})
    await _assign(client, team["system_id"], project["system_id"])

    body = await _capacity(client, team["system_id"])
    assert body["sprints"][0]["available"] == 12


async def test_a_reader_can_read_capacity(client, reader_client, team, project):
    await _assign(client, team["system_id"], project["system_id"])
    resp = await reader_client.get(f"{_TEAMS}/{team['system_id']}/capacity")
    assert resp.status_code == 200
