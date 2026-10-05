"""Assignments that count only some of the team's members (§6.3, ADR 0009).

The case this exists for: one team where Anna and Bruno work only on the
Portal, while Carla and Dario cover everything else. Every member is a
full-timer, so each brings 10 PD to the one dated fortnight below and every
expected figure is a multiple of 10.
"""
import pytest
from sqlalchemy import select

from app.models.team import TeamProject, TeamProjectMember

_TEAMS = "/api/v1/teams"
_SPRINT = ("2026-04-06", "2026-04-17")


def _projects_url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/projects"


async def _project(client, name: str) -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": name, "effort_unit": "pts"})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _date_first_sprint(client, project_id: str) -> None:
    resp = await client.post(
        f"/api/v1/projects/{project_id}/pis", json={"name": "PI-7", "start_date": _SPRINT[0]}
    )
    assert resp.status_code == 201, resp.text
    sprints = (await client.get(f"/api/v1/pis/{resp.json()['system_id']}/sprints")).json()
    first = next(s for s in sprints if s["sprint_index"] == 0)
    patched = await client.patch(
        f"/api/v1/sprints/{first['system_id']}",
        json={"start_date": _SPRINT[0], "end_date": _SPRINT[1]},
    )
    assert patched.status_code == 200, patched.text


async def _member(client, team_id: str, name: str, **fields) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01"}, **fields},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _assign(client, team_id: str, project_id: str, **fields) -> dict:
    resp = await client.post(_projects_url(team_id), json={"project_id": project_id, **fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _assignment(client, team_id: str, project_id: str) -> dict:
    rows = (await client.get(_projects_url(team_id))).json()
    return next(row for row in rows if row["project_id"] == project_id)


async def _patch(client, team_id: str, project_id: str, **fields):
    current = await _assignment(client, team_id, project_id)
    return await client.patch(
        f"{_projects_url(team_id)}/{project_id}",
        json=fields,
        headers={"If-Match": current["etag"]},
    )


async def _project_pd(client, team_id: str) -> dict[str, float]:
    """The first sprint's share-adjusted PD per served project, by name."""
    resp = await client.get(f"{_TEAMS}/{team_id}/capacity")
    assert resp.status_code == 200, resp.text
    return {row["name"]: row["person_days"][0] for row in resp.json()["projects"]}


@pytest.fixture
async def split(client) -> dict:
    """Anna and Bruno only on the Portal; Carla and Dario on Billing and Search."""
    team = (await client.post(_TEAMS, json={"name": "Platform"})).json()
    members = {
        name: await _member(client, team["system_id"], name)
        for name in ("Anna", "Bruno", "Carla", "Dario")
    }
    portal = await _project(client, "Portal")
    billing = await _project(client, "Billing")
    search = await _project(client, "Search")
    await _date_first_sprint(client, portal["system_id"])

    ids = {name: member["system_id"] for name, member in members.items()}
    await _assign(
        client, team["system_id"], portal["system_id"],
        share_pct=100, all_members=False, member_ids=[ids["Anna"], ids["Bruno"]],
    )
    for project, share in ((billing, 60), (search, 40)):
        await _assign(
            client, team["system_id"], project["system_id"],
            share_pct=share, all_members=False, member_ids=[ids["Carla"], ids["Dario"]],
        )
    return {
        "team": team, "ids": ids, "members": members,
        "portal": portal, "billing": billing, "search": search,
    }


# ── Assignment ────────────────────────────────────────────────────────────────

async def test_an_assignment_counts_the_whole_team_by_default(client):
    team = (await client.post(_TEAMS, json={"name": "Platform"})).json()
    project = await _project(client, "Portal")

    assignment = await _assign(client, team["system_id"], project["system_id"])

    assert assignment["all_members"] is True
    assert assignment["member_ids"] == []


async def test_a_scoped_assignment_lists_its_members_in_display_order(client, split):
    portal = await _assignment(client, split["team"]["system_id"], split["portal"]["system_id"])

    assert portal["all_members"] is False
    assert portal["member_ids"] == [split["ids"]["Anna"], split["ids"]["Bruno"]]


async def test_listing_members_while_counting_everyone_is_refused(client, split):
    resp = await _patch(
        client, split["team"]["system_id"], split["portal"]["system_id"],
        all_members=True, member_ids=[split["ids"]["Anna"]],
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "SCOPE_CONFLICT"


async def test_a_member_of_another_team_cannot_count_for_a_project(client, split):
    other = (await client.post(_TEAMS, json={"name": "Data"})).json()
    stranger = await _member(client, other["system_id"], "Elif")
    project = await _project(client, "Lake")

    resp = await client.post(
        _projects_url(split["team"]["system_id"]),
        json={
            "project_id": project["system_id"],
            "all_members": False,
            "member_ids": [stranger["system_id"]],
        },
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["member_ids"] == [stranger["system_id"]]
    # Refused before anything was written: the project is still unserved.
    served = (await client.get(_projects_url(split["team"]["system_id"]))).json()
    assert project["system_id"] not in [row["project_id"] for row in served]


async def test_member_ids_alone_scopes_and_all_members_alone_unscopes(client, split):
    team_id = split["team"]["system_id"]
    billing_id = split["billing"]["system_id"]

    resp = await _patch(client, team_id, billing_id, member_ids=[split["ids"]["Carla"]])
    assert resp.status_code == 200, resp.text
    assert resp.json()["all_members"] is False
    assert resp.json()["member_ids"] == [split["ids"]["Carla"]]

    resp = await _patch(client, team_id, billing_id, all_members=True)
    assert resp.status_code == 200, resp.text
    assert resp.json()["all_members"] is True
    assert resp.json()["member_ids"] == []


async def test_a_patch_that_leaves_the_scope_out_leaves_it_alone(client, split):
    resp = await _patch(
        client, split["team"]["system_id"], split["portal"]["system_id"], share_pct=90
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["share_pct"] == 90
    assert resp.json()["member_ids"] == [split["ids"]["Anna"], split["ids"]["Bruno"]]


# ── Capacity ──────────────────────────────────────────────────────────────────

async def test_each_project_gets_the_pd_of_the_members_it_counts(client, split):
    pd = await _project_pd(client, split["team"]["system_id"])

    # 2 × 10 PD at 100%; the other two's 20 PD split 60/40.
    assert pd["Portal"] == pytest.approx(20.0)
    assert pd["Billing"] == pytest.approx(12.0)
    assert pd["Search"] == pytest.approx(8.0)


async def test_the_team_row_still_counts_everyone(client, split):
    resp = await client.get(f"{_TEAMS}/{split['team']['system_id']}/capacity")

    assert resp.json()["team"][0]["person_days"] == pytest.approx(40.0)


async def test_a_scoped_member_who_does_not_count_adds_nothing(client, split):
    team_id = split["team"]["system_id"]
    observer = await _member(client, team_id, "Pia", counts_towards_capacity=False)
    resp = await _patch(
        client, team_id, split["portal"]["system_id"],
        member_ids=[split["ids"]["Anna"], split["ids"]["Bruno"], observer["system_id"]],
    )
    assert resp.status_code == 200, resp.text

    assert (await _project_pd(client, team_id))["Portal"] == pytest.approx(20.0)


async def test_deleting_the_last_scoped_member_leaves_the_project_at_zero(client, split):
    """Never back to the whole team: that is why ``all_members`` is a flag."""
    team_id = split["team"]["system_id"]
    for name in ("Anna", "Bruno"):
        member = split["members"][name]
        resp = await client.delete(
            f"{_TEAMS}/{team_id}/members/{member['system_id']}",
            headers={"If-Match": member["etag"]},
        )
        assert resp.status_code == 204, resp.text

    portal = await _assignment(client, team_id, split["portal"]["system_id"])
    assert portal["all_members"] is False
    assert portal["member_ids"] == []
    assert (await _project_pd(client, team_id))["Portal"] == pytest.approx(0.0)


# ── Push ──────────────────────────────────────────────────────────────────────

async def test_the_push_proposes_the_scoped_figure_and_names_who_it_counts(client, split):
    portal_id = split["portal"]["system_id"]
    resp = await _patch(
        client, split["team"]["system_id"], portal_id,
        available_source="factor", units_per_pd=1.5,
    )
    assert resp.status_code == 200, resp.text

    preview = (await client.get(f"/api/v1/projects/{portal_id}/team-capacity/preview")).json()

    assert preview["all_members"] is False
    assert preview["member_names"] == ["Anna", "Bruno"]
    dated = [row for row in preview["sprints"] if row["start_date"]]
    assert dated[0]["team_person_days"] == pytest.approx(20.0)
    assert dated[0]["proposed_available"] == 30


# ── Load and over-allocation ──────────────────────────────────────────────────

async def test_each_member_carries_the_shares_of_the_projects_that_count_them(client, split):
    team = (await client.get(f"{_TEAMS}/{split['team']['system_id']}")).json()

    assert {load["name"]: load["share_pct"] for load in team["member_loads"]} == {
        "Anna": 100, "Bruno": 100, "Carla": 100, "Dario": 100,
    }
    # The old team-wide total would have read 200% and called this over-allocated.
    assert sum(team["project_shares"].values()) == 200


async def test_a_member_counted_by_a_whole_team_project_too_is_over_allocated(client, split):
    team_id = split["team"]["system_id"]
    extra = await _project(client, "Support")
    await _assign(client, team_id, extra["system_id"], share_pct=10)

    loads = {
        load["name"]: load["share_pct"]
        for load in (await client.get(f"{_TEAMS}/{team_id}")).json()["member_loads"]
    }

    assert loads == {"Anna": 110, "Bruno": 110, "Carla": 110, "Dario": 110}


async def test_members_tracked_for_absences_only_carry_no_load(client, split):
    team_id = split["team"]["system_id"]
    await _member(client, team_id, "Pia", counts_towards_capacity=False)

    team = (await client.get(f"{_TEAMS}/{team_id}")).json()

    assert "Pia" not in [load["name"] for load in team["member_loads"]]


# ── Deletion ──────────────────────────────────────────────────────────────────

async def test_unassigning_removes_the_scope_rows(client, db, split):
    team_id = split["team"]["system_id"]
    portal = await _assignment(client, team_id, split["portal"]["system_id"])

    resp = await client.delete(
        f"{_projects_url(team_id)}/{split['portal']['system_id']}",
        headers={"If-Match": portal["etag"]},
    )
    assert resp.status_code == 204, resp.text

    left = await db.execute(
        select(TeamProjectMember).where(TeamProjectMember.team_project_id == portal["system_id"])
    )
    assert left.scalars().all() == []


async def test_deleting_a_project_removes_its_assignment(client, db, split):
    team_id = split["team"]["system_id"]
    billing = await _assignment(client, team_id, split["billing"]["system_id"])

    resp = await client.delete(f"/api/v1/projects/{split['billing']['system_id']}")
    assert resp.status_code == 204, resp.text

    assert await db.get(TeamProject, billing["system_id"]) is None
    left = await db.execute(
        select(TeamProjectMember).where(TeamProjectMember.team_project_id == billing["system_id"])
    )
    assert left.scalars().all() == []
    team = (await client.get(f"{_TEAMS}/{team_id}")).json()
    assert split["billing"]["system_id"] not in team["project_ids"]
