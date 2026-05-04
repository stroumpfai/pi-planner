import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Test Project"})).json()


@pytest.fixture
async def pi(client, project):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "Q1-2026"},
    )).json()


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_pis_empty(client, project):
    resp = await client.get(f"/api/v1/projects/{project['system_id']}/pis")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_pis_returns_all(client, project):
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})
    await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-2"})
    resp = await client.get(f"/api/v1/projects/{pid}/pis")
    assert len(resp.json()) == 2


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_pi_minimal(client, project):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "Q1-2026"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Q1-2026"
    assert data["state"] == "draft"
    assert data["start_date"] is None


@pytest.mark.asyncio
async def test_create_pi_with_dates(client, project):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "Q2", "start_date": "2026-04-01", "end_date": "2026-06-30"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["start_date"] == "2026-04-01"
    assert data["end_date"] == "2026-06-30"


@pytest.mark.asyncio
async def test_create_pi_auto_creates_5_sprints(client, project):
    pi = (await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "PI-1"},
    )).json()
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    assert len(sprints) == 5
    assert [s["sprint_index"] for s in sprints] == [0, 1, 2, 3, 4]
    assert all(s["capacity"] == 0 for s in sprints)


@pytest.mark.asyncio
async def test_create_pi_project_not_found(client):
    resp = await client.post("/api/v1/projects/no-such/pis", json={"name": "PI"})
    assert resp.status_code == 404


# ── Get ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_pi(client, pi):
    resp = await client.get(f"/api/v1/pis/{pi['system_id']}")
    assert resp.status_code == 200
    assert resp.json()["system_id"] == pi["system_id"]


@pytest.mark.asyncio
async def test_get_pi_not_found(client):
    assert (await client.get("/api/v1/pis/no-such")).status_code == 404


# ── State machine ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_transition_draft_to_in_progress(client, pi):
    resp = await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"state": "in_progress"})
    assert resp.status_code == 200
    assert resp.json()["state"] == "in_progress"


@pytest.mark.asyncio
async def test_two_pis_in_progress_rejected(client, project):
    pid = project["system_id"]
    pi1 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    pi2 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-2"})).json()

    await client.patch(f"/api/v1/pis/{pi1['system_id']}", json={"state": "in_progress"})
    resp = await client.patch(f"/api/v1/pis/{pi2['system_id']}", json={"state": "in_progress"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ACTIVE_PI_EXISTS"


@pytest.mark.asyncio
async def test_close_pi_does_not_require_unique(client, project):
    pid = project["system_id"]
    pi1 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    await client.patch(f"/api/v1/pis/{pi1['system_id']}", json={"state": "in_progress"})
    resp = await client.patch(f"/api/v1/pis/{pi1['system_id']}", json={"state": "closed"})
    assert resp.status_code == 200
    assert resp.json()["state"] == "closed"


@pytest.mark.asyncio
async def test_patch_closed_pi_rejected(client, pi):
    await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"state": "in_progress"})
    await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"state": "closed"})
    resp = await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"name": "New Name"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_pi_in_progress_rejected_if_one_active(client, project):
    pid = project["system_id"]
    pi1 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    await client.patch(f"/api/v1/pis/{pi1['system_id']}", json={"state": "in_progress"})
    resp = await client.post(
        f"/api/v1/projects/{pid}/pis",
        json={"name": "PI-2", "state": "in_progress"},
    )
    assert resp.status_code == 409


# ── Update (non-state) ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_pi_name(client, pi):
    resp = await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


@pytest.mark.asyncio
async def test_update_pi_dates(client, pi):
    resp = await client.patch(
        f"/api/v1/pis/{pi['system_id']}",
        json={"start_date": "2026-01-01", "end_date": "2026-03-31"},
    )
    assert resp.status_code == 200
    assert resp.json()["start_date"] == "2026-01-01"


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_pi(client, pi):
    resp = await client.delete(f"/api/v1/pis/{pi['system_id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/pis/{pi['system_id']}")).status_code == 404


# ── Sprint CRUD ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_sprints_ordered_by_index(client, pi):
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    assert len(sprints) == 5
    assert sprints[0]["sprint_index"] == 0
    assert sprints[4]["sprint_index"] == 4


@pytest.mark.asyncio
async def test_update_sprint_capacity(client, pi):
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    sprint_id = sprints[0]["system_id"]
    resp = await client.patch(f"/api/v1/sprints/{sprint_id}", json={"capacity": 42})
    assert resp.status_code == 200
    assert resp.json()["capacity"] == 42


@pytest.mark.asyncio
async def test_update_sprint_dates(client, pi):
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    sprint_id = sprints[0]["system_id"]
    resp = await client.patch(
        f"/api/v1/sprints/{sprint_id}",
        json={"start_date": "2026-01-01", "end_date": "2026-01-14"},
    )
    assert resp.status_code == 200
    assert resp.json()["start_date"] == "2026-01-01"


@pytest.mark.asyncio
async def test_update_sprint_in_closed_pi_rejected(client, pi):
    await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"state": "in_progress"})
    await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"state": "closed"})
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    resp = await client.patch(f"/api/v1/sprints/{sprints[0]['system_id']}", json={"capacity": 99})
    assert resp.status_code == 403
