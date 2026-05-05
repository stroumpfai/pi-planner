import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Group Project"})).json()


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
        json={"title": "Auth Feature"},
    )).json()
    # Move feature to the swimlane so it belongs there
    await client.patch(f"/api/v1/features/{f['system_id']}", json={"swimlane_id": swimline["system_id"]})
    return f


@pytest.fixture
async def pbi(client, project, feature):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={"title": "Login PBI", "parent_feature_system_id": feature["system_id"]},
    )).json()


@pytest.fixture
async def group(client, swimline, feature):
    return (await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "Sprint Group", "feature_system_id": feature["system_id"]},
    )).json()


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_groups_empty(client, swimline):
    resp = await client.get(f"/api/v1/swimlines/{swimline['system_id']}/groups")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_groups_returns_all(client, swimline, feature):
    sid = swimline["system_id"]
    fid = feature["system_id"]
    await client.post(f"/api/v1/swimlines/{sid}/groups", json={"name": "G1", "feature_system_id": fid})
    await client.post(f"/api/v1/swimlines/{sid}/groups", json={"name": "G2", "feature_system_id": fid})
    resp = await client.get(f"/api/v1/swimlines/{sid}/groups")
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_list_groups_ordered_by_sprint_then_order(client, swimline, feature):
    sid = swimline["system_id"]
    fid = feature["system_id"]
    await client.post(f"/api/v1/swimlines/{sid}/groups",
                      json={"name": "G-sprint2", "feature_system_id": fid, "sprint_index": 2})
    await client.post(f"/api/v1/swimlines/{sid}/groups",
                      json={"name": "G-sprint1", "feature_system_id": fid, "sprint_index": 1})
    await client.post(f"/api/v1/swimlines/{sid}/groups",
                      json={"name": "G-unassigned", "feature_system_id": fid})
    resp = await client.get(f"/api/v1/swimlines/{sid}/groups")
    names = [g["name"] for g in resp.json()]
    assert names[0] == "G-unassigned"
    assert names[1] == "G-sprint1"
    assert names[2] == "G-sprint2"


@pytest.mark.asyncio
async def test_list_groups_404_unknown_swimline(client):
    resp = await client.get("/api/v1/swimlines/nonexistent/groups")
    assert resp.status_code == 404


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_minimal(client, swimline, feature):
    resp = await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "New Group", "feature_system_id": feature["system_id"]},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "New Group"
    assert data["swimline_id"] == swimline["system_id"]
    assert data["feature_system_id"] == feature["system_id"]
    assert data["sprint_index"] is None


@pytest.mark.asyncio
async def test_create_group_with_sprint(client, swimline, feature):
    resp = await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "Sprint 2 Group", "feature_system_id": feature["system_id"], "sprint_index": 2},
    )
    assert resp.status_code == 201
    assert resp.json()["sprint_index"] == 2


@pytest.mark.asyncio
async def test_create_group_with_pbis_assigns_group_id(client, swimline, feature, pbi, project):
    pbi_id = pbi["system_id"]
    resp = await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={
            "name": "Group With PBIs",
            "feature_system_id": feature["system_id"],
            "pbi_ids": [pbi_id],
        },
    )
    assert resp.status_code == 201
    group_id = resp.json()["system_id"]

    pbi_resp = (await client.get(f"/api/v1/pbis/{pbi_id}")).json()
    assert pbi_resp["group_id"] == group_id


@pytest.mark.asyncio
async def test_create_group_pbi_wrong_feature_400(client, swimline, feature, project):
    other_feature = (await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Other Feature"},
    )).json()
    pbi = (await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={"title": "PBI of other", "parent_feature_system_id": other_feature["system_id"]},
    )).json()

    resp = await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={
            "name": "Bad Group",
            "feature_system_id": feature["system_id"],
            "pbi_ids": [pbi["system_id"]],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "PBI_WRONG_FEATURE"


@pytest.mark.asyncio
async def test_create_group_feature_not_in_swimlane_400(client, swimline, project, pi):
    other_feature = (await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Unassigned Feature"},
    )).json()
    resp = await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "G", "feature_system_id": other_feature["system_id"]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "FEATURE_NOT_IN_SWIMLANE"


@pytest.mark.asyncio
async def test_create_group_duplicate_name_409(client, swimline, feature):
    sid = swimline["system_id"]
    fid = feature["system_id"]
    await client.post(f"/api/v1/swimlines/{sid}/groups", json={"name": "Same", "feature_system_id": fid})
    resp = await client.post(f"/api/v1/swimlines/{sid}/groups", json={"name": "Same", "feature_system_id": fid})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "NAME_TAKEN"


# ── Get ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_group(client, group):
    resp = await client.get(f"/api/v1/groups/{group['system_id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == group["name"]


@pytest.mark.asyncio
async def test_get_group_404(client):
    resp = await client.get("/api/v1/groups/nonexistent")
    assert resp.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_group_name(client, group):
    resp = await client.patch(f"/api/v1/groups/{group['system_id']}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


@pytest.mark.asyncio
async def test_update_group_sprint_index(client, group):
    resp = await client.patch(f"/api/v1/groups/{group['system_id']}", json={"sprint_index": 3})
    assert resp.status_code == 200
    assert resp.json()["sprint_index"] == 3


@pytest.mark.asyncio
async def test_update_group_duplicate_name_409(client, swimline, feature):
    sid = swimline["system_id"]
    fid = feature["system_id"]
    await client.post(f"/api/v1/swimlines/{sid}/groups", json={"name": "Alpha", "feature_system_id": fid})
    b = (await client.post(f"/api/v1/swimlines/{sid}/groups", json={"name": "Beta", "feature_system_id": fid})).json()
    resp = await client.patch(f"/api/v1/groups/{b['system_id']}", json={"name": "Alpha"})
    assert resp.status_code == 409


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_group(client, group):
    resp = await client.delete(f"/api/v1/groups/{group['system_id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/groups/{group['system_id']}")).status_code == 404


@pytest.mark.asyncio
async def test_delete_group_clears_pbi_group_id(client, swimline, feature, pbi, project):
    pbi_id = pbi["system_id"]
    g = (await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "G", "feature_system_id": feature["system_id"], "pbi_ids": [pbi_id]},
    )).json()

    await client.delete(f"/api/v1/groups/{g['system_id']}")

    pbi_resp = (await client.get(f"/api/v1/pbis/{pbi_id}")).json()
    assert pbi_resp["group_id"] is None


@pytest.mark.asyncio
async def test_delete_group_404(client):
    resp = await client.delete("/api/v1/groups/nonexistent")
    assert resp.status_code == 404


# ── PBI group_id via PATCH ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_pbi_assigns_group(client, swimline, feature, pbi, project):
    g = (await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "G", "feature_system_id": feature["system_id"]},
    )).json()

    resp = await client.patch(
        f"/api/v1/pbis/{pbi['system_id']}",
        json={"group_id": g["system_id"]},
    )
    assert resp.status_code == 200
    assert resp.json()["group_id"] == g["system_id"]


@pytest.mark.asyncio
async def test_patch_pbi_clears_group(client, swimline, feature, pbi, project):
    g = (await client.post(
        f"/api/v1/swimlines/{swimline['system_id']}/groups",
        json={"name": "G", "feature_system_id": feature["system_id"], "pbi_ids": [pbi["system_id"]]},
    )).json()

    resp = await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"group_id": None})
    assert resp.status_code == 200
    assert resp.json()["group_id"] is None
    # Group still exists (PBI cleared, not group deleted)
    assert (await client.get(f"/api/v1/groups/{g['system_id']}")).status_code == 200
