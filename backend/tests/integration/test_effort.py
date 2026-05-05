"""Tests for M8 effort & capacity computed fields."""
import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Effort Project"})).json()


@pytest.fixture
async def pi(client, project):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "Q1-2026"},
    )).json()


@pytest.fixture
async def swimline(client, pi):
    return (await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines",
        json={"name": "Team Alpha"},
    )).json()


@pytest.fixture
async def feature(client, project, swimline):
    f = (await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Auth"},
    )).json()
    await client.patch(f"/api/v1/features/{f['system_id']}", json={"swimlane_id": swimline["system_id"]})
    return f


async def _make_pbi(client, project, feature, effort):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={"title": "PBI", "parent_feature_system_id": feature["system_id"], "effort": effort},
    )).json()


_group_seq: list[int] = [0]


async def _make_group(client, swimline, feature, pbi_ids=None, sprint_index=None):
    _group_seq[0] += 1
    body = {"name": f"G-{_group_seq[0]}", "feature_system_id": feature["system_id"]}
    if pbi_ids:
        body["pbi_ids"] = pbi_ids
    if sprint_index is not None:
        body["sprint_index"] = sprint_index
    return (await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json=body,
    )).json()


# ── Sprint effort ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sprint_effort_zero_when_no_groups(client, pi):
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    for sprint in sprints:
        assert sprint["effort"] == 0


@pytest.mark.asyncio
async def test_sprint_effort_sums_pbi_efforts(client, project, pi, swimline, feature):
    pbi1 = await _make_pbi(client, project, feature, 3)
    pbi2 = await _make_pbi(client, project, feature, 5)
    await _make_group(client, swimline, feature, pbi_ids=[pbi1["system_id"], pbi2["system_id"]], sprint_index=0)

    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    s0 = next(s for s in sprints if s["sprint_index"] == 0)
    assert s0["effort"] == 8


@pytest.mark.asyncio
async def test_sprint_effort_zero_for_unassigned_group(client, project, pi, swimline, feature):
    pbi = await _make_pbi(client, project, feature, 4)
    await _make_group(client, swimline, feature, pbi_ids=[pbi["system_id"]])  # sprint_index = None

    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    for sprint in sprints:
        assert sprint["effort"] == 0


@pytest.mark.asyncio
async def test_sprint_effort_isolated_per_sprint(client, project, pi, swimline, feature):
    pbi1 = await _make_pbi(client, project, feature, 3)
    pbi2 = await _make_pbi(client, project, feature, 7)
    await _make_group(client, swimline, feature, pbi_ids=[pbi1["system_id"]], sprint_index=0)
    await _make_group(client, swimline, feature, pbi_ids=[pbi2["system_id"]], sprint_index=1)

    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    by_index = {s["sprint_index"]: s["effort"] for s in sprints}
    assert by_index[0] == 3
    assert by_index[1] == 7
    assert by_index[2] == 0


# ── Swimline effort & capacity ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_swimline_effort_zero_initially(client, pi, swimline):
    resp = (await client.get(f"/api/v1/swimlines/{swimline['system_id']}")).json()
    assert resp["effort"] == 0


@pytest.mark.asyncio
async def test_swimline_effort_sums_all_groups(client, project, pi, swimline, feature):
    pbi1 = await _make_pbi(client, project, feature, 3)
    pbi2 = await _make_pbi(client, project, feature, 4)
    await _make_group(client, swimline, feature, pbi_ids=[pbi1["system_id"]], sprint_index=0)
    await _make_group(client, swimline, feature, pbi_ids=[pbi2["system_id"]], sprint_index=1)

    swimlines = (await client.get(f"/api/v1/pis/{pi['system_id']}/swimlines")).json()
    sw = next(s for s in swimlines if s["system_id"] == swimline["system_id"])
    assert sw["effort"] == 7


@pytest.mark.asyncio
async def test_swimline_capacity_equals_total_pi_sprint_capacity(client, pi, swimline):
    # Default: 5 sprints × 0 capacity each = 0
    sw = (await client.get(f"/api/v1/swimlines/{swimline['system_id']}")).json()
    assert sw["capacity"] == 0

    # Set sprint capacities
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    for sprint in sprints[:2]:
        await client.patch(f"/api/v1/sprints/{sprint['system_id']}", json={"capacity": 10})

    sw_after = (await client.get(f"/api/v1/swimlines/{swimline['system_id']}")).json()
    assert sw_after["capacity"] == 20  # 2 × 10 + 3 × 0


# ── PI total effort & capacity ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pi_total_effort_zero_initially(client, pi):
    resp = (await client.get(f"/api/v1/pis/{pi['system_id']}")).json()
    assert resp["total_effort"] == 0
    assert resp["total_capacity"] == 0


@pytest.mark.asyncio
async def test_pi_total_effort_sums_all_swimlines(client, project, pi, swimline, feature):
    pbi1 = await _make_pbi(client, project, feature, 5)
    pbi2 = await _make_pbi(client, project, feature, 3)
    await _make_group(client, swimline, feature, pbi_ids=[pbi1["system_id"]])
    await _make_group(client, swimline, feature, pbi_ids=[pbi2["system_id"]])

    resp = (await client.get(f"/api/v1/pis/{pi['system_id']}")).json()
    assert resp["total_effort"] == 8


@pytest.mark.asyncio
async def test_pi_total_capacity_sums_sprints(client, pi):
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    for sprint in sprints:
        await client.patch(f"/api/v1/sprints/{sprint['system_id']}", json={"capacity": 10})

    resp = (await client.get(f"/api/v1/pis/{pi['system_id']}")).json()
    assert resp["total_capacity"] == 50  # 5 sprints × 10


@pytest.mark.asyncio
async def test_sprint_capacity_zero_no_crash(client, pi):
    # Capacity = 0 (default), effort = 0 → should not crash
    resp = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    for sprint in resp:
        assert sprint["capacity"] == 0
        assert sprint["effort"] == 0


# ── Sprint PATCH broadcasts ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_sprint_capacity_returns_effort(client, project, pi, swimline, feature):
    pbi = await _make_pbi(client, project, feature, 6)
    await _make_group(client, swimline, feature, pbi_ids=[pbi["system_id"]], sprint_index=0)

    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    s0 = next(s for s in sprints if s["sprint_index"] == 0)

    resp = await client.patch(f"/api/v1/sprints/{s0['system_id']}", json={"capacity": 20})
    assert resp.status_code == 200
    data = resp.json()
    assert data["capacity"] == 20
    assert data["effort"] == 6
