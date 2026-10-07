"""A project that takes the team's remaining capacity (§6.3.4, ADR 0012).

The Portal has Anna and Bruno to itself. Billing books Carla for 2 days a week
and Dario at 50%. Search takes whatever is left: nothing of Anna and Bruno, 3 of
Carla's 5 days and half of Dario. Every member is a full-timer bringing 10 PD to
the one dated fortnight, so Search reads 6 + 5 = 11 PD.
"""
import pytest

from tests.integration.test_assignment_scope import (
    _TEAMS,
    _assign,
    _assignment,
    _date_first_sprint,
    _member,
    _patch,
    _project,
    _project_pd,
    _projects_url,
)


@pytest.fixture
async def rest(client) -> dict:
    team = (await client.post(_TEAMS, json={"name": "Platform"})).json()
    team_id = team["system_id"]
    ids = {
        name: (await _member(client, team_id, name))["system_id"]
        for name in ("Anna", "Bruno", "Carla", "Dario")
    }
    portal = await _project(client, "Portal")
    billing = await _project(client, "Billing")
    search = await _project(client, "Search")
    await _date_first_sprint(client, portal["system_id"])

    await _assign(
        client, team_id, portal["system_id"],
        all_members=False, member_ids=[ids["Anna"], ids["Bruno"]],
    )
    await _assign(
        client, team_id, billing["system_id"],
        all_members=False,
        member_shares=[
            {"member_id": ids["Carla"], "share_days": 2},
            {"member_id": ids["Dario"], "share_pct": 50},
        ],
    )
    await _assign(client, team_id, search["system_id"], remaining=True)
    return {"team_id": team_id, "ids": ids, "portal": portal, "billing": billing, "search": search}


async def _loads(client, team_id: str) -> dict[str, dict]:
    team = (await client.get(f"{_TEAMS}/{team_id}")).json()
    return {load["name"]: load for load in team["member_loads"]}


# ── What it gets ──────────────────────────────────────────────────────────────

async def test_the_remaining_project_gets_what_the_others_leave(client, rest):
    pd = await _project_pd(client, rest["team_id"])

    assert pd["Search"] == pytest.approx(11.0)
    assert pd["Portal"] == pytest.approx(20.0)
    assert pd["Billing"] == pytest.approx(9.0)


async def test_it_moves_when_another_project_changes(client, rest):
    await _patch(
        client, rest["team_id"], rest["billing"]["system_id"],
        member_shares=[
            {"member_id": rest["ids"]["Carla"], "share_days": 2},
            {"member_id": rest["ids"]["Dario"], "share_pct": 20},
        ],
    )

    assert (await _project_pd(client, rest["team_id"]))["Search"] == pytest.approx(14.0)


async def test_the_assignment_reads_as_remaining_with_the_whole_team(client, rest):
    search = await _assignment(client, rest["team_id"], rest["search"]["system_id"])

    assert search["remaining"] is True
    assert search["all_members"] is True
    assert search["member_ids"] == []
    assert search["member_shares"] == []


async def test_the_team_names_its_remaining_project(client, rest):
    team = (await client.get(f"{_TEAMS}/{rest['team_id']}")).json()

    assert team["remaining_project_id"] == rest["search"]["system_id"]


async def test_the_push_proposes_the_remainder(client, rest):
    search_id = rest["search"]["system_id"]
    await _date_first_sprint(client, search_id)
    resp = await _patch(
        client, rest["team_id"], search_id, available_source="factor", units_per_pd=2,
    )
    assert resp.status_code == 200, resp.text

    preview = (await client.get(f"/api/v1/projects/{search_id}/team-capacity/preview")).json()

    assert preview["remaining"] is True
    dated = [row for row in preview["sprints"] if row["start_date"]]
    assert dated[0]["share_adjusted_person_days"] == pytest.approx(11.0)
    assert dated[0]["proposed_available"] == 22


# ── Load ──────────────────────────────────────────────────────────────────────

async def test_the_remainder_brings_every_load_to_exactly_100(client, rest):
    loads = await _loads(client, rest["team_id"])

    assert {name: load["share_pct"] for name, load in loads.items()} == {
        "Anna": 100, "Bruno": 100, "Carla": 100, "Dario": 100,
    }


async def test_each_member_reports_what_the_fixed_shares_leave(client, rest):
    loads = await _loads(client, rest["team_id"])

    assert {name: load["remaining_days"] for name, load in loads.items()} == {
        "Anna": 0, "Bruno": 0, "Carla": 3, "Dario": 2.5,
    }


async def test_a_member_over_booked_elsewhere_stays_over_and_gives_nothing(client, rest):
    # Anna: the Portal fully, and a day of Billing on top.
    await _patch(
        client, rest["team_id"], rest["billing"]["system_id"],
        member_shares=[
            {"member_id": rest["ids"]["Anna"], "share_days": 1},
            {"member_id": rest["ids"]["Carla"], "share_days": 2},
            {"member_id": rest["ids"]["Dario"], "share_pct": 50},
        ],
    )

    loads = await _loads(client, rest["team_id"])

    assert loads["Anna"]["share_pct"] == pytest.approx(120.0)
    assert loads["Anna"]["remaining_days"] == 0
    assert (await _project_pd(client, rest["team_id"]))["Search"] == pytest.approx(11.0)


async def test_the_leftover_is_reported_without_a_remaining_project(client, rest):
    search = await _assignment(client, rest["team_id"], rest["search"]["system_id"])
    await client.delete(
        f"{_projects_url(rest['team_id'])}/{rest['search']['system_id']}",
        headers={"If-Match": search["etag"]},
    )

    loads = await _loads(client, rest["team_id"])

    assert loads["Carla"]["remaining_days"] == 3
    assert loads["Carla"]["share_pct"] == pytest.approx(40.0)


# ── One per team, and only the whole team ─────────────────────────────────────

async def test_a_second_remaining_project_is_refused_naming_the_first(client, rest):
    other = await _project(client, "Support")

    resp = await client.post(
        _projects_url(rest["team_id"]),
        json={"project_id": other["system_id"], "remaining": True},
    )

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "REMAINING_TAKEN"
    assert "'Search'" in detail["message"]
    assert detail["project_id"] == rest["search"]["system_id"]


async def test_switching_another_project_to_remaining_is_refused(client, rest):
    resp = await _patch(client, rest["team_id"], rest["portal"]["system_id"], remaining=True)

    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "REMAINING_TAKEN"


async def test_another_team_can_have_its_own_remaining_project(client, rest):
    team = (await client.post(_TEAMS, json={"name": "Data"})).json()
    lake = await _project(client, "Lake")

    assignment = await _assign(client, team["system_id"], lake["system_id"], remaining=True)

    assert assignment["remaining"] is True


@pytest.mark.parametrize(
    "fields",
    [
        {"share_pct": 50},
        {"share_days": 2},
        {"all_members": False},
        {"member_shares": []},
    ],
)
async def test_the_remainder_takes_no_share_or_members(client, fields):
    team = (await client.post(_TEAMS, json={"name": "Data"})).json()
    lake = await _project(client, "Lake")

    resp = await client.post(
        _projects_url(team["system_id"]),
        json={"project_id": lake["system_id"], "remaining": True, **fields},
    )

    assert resp.status_code == 422


async def test_taking_the_remainder_drops_a_scope(client, rest):
    await _patch(client, rest["team_id"], rest["search"]["system_id"], remaining=False)
    await _patch(
        client, rest["team_id"], rest["portal"]["system_id"],
        member_shares=[{"member_id": rest["ids"]["Anna"], "share_pct": 50}],
    )

    resp = await _patch(client, rest["team_id"], rest["portal"]["system_id"], remaining=True)

    assert resp.status_code == 200, resp.text
    portal = resp.json()
    assert portal["remaining"] is True
    assert portal["all_members"] is True
    assert portal["member_ids"] == []
    assert portal["member_shares"] == []


async def test_a_share_ends_the_remainder(client, rest):
    resp = await _patch(client, rest["team_id"], rest["search"]["system_id"], share_pct=10)

    assert resp.status_code == 200, resp.text
    assert resp.json()["remaining"] is False
    # The whole team at 10%: four members × 10 PD × 0.1.
    assert (await _project_pd(client, rest["team_id"]))["Search"] == pytest.approx(4.0)


async def test_unassigning_the_remaining_project_frees_the_place(client, rest):
    search = await _assignment(client, rest["team_id"], rest["search"]["system_id"])
    resp = await client.delete(
        f"{_projects_url(rest['team_id'])}/{rest['search']['system_id']}",
        headers={"If-Match": search["etag"]},
    )
    assert resp.status_code == 204, resp.text

    resp = await _patch(client, rest["team_id"], rest["billing"]["system_id"], remaining=True)

    assert resp.status_code == 200, resp.text
    assert resp.json()["remaining"] is True

