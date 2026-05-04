import pytest
from sqlalchemy import select
from app.models.group import Group


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Test Project"})).json()


@pytest.fixture
async def feature(client, project):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Auth Feature"},
    )).json()


@pytest.fixture
async def pbi(client, project, feature):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={"title": "Login UI", "parent_feature_system_id": feature["system_id"]},
    )).json()


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_pbis_empty(client, project, feature):
    resp = await client.get(f"/api/v1/projects/{project['system_id']}/pbis?feature_id={feature['system_id']}")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_pbis_for_feature(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P1", "parent_feature_system_id": fid})
    await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P2", "parent_feature_system_id": fid})
    resp = await client.get(f"/api/v1/projects/{pid}/pbis?feature_id={fid}")
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_list_pbis_filters_by_feature(client, project):
    pid = project["system_id"]
    f1 = (await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F1"})).json()
    f2 = (await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F2"})).json()
    await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P-F1", "parent_feature_system_id": f1["system_id"]})
    await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P-F2", "parent_feature_system_id": f2["system_id"]})
    resp = await client.get(f"/api/v1/projects/{pid}/pbis?feature_id={f1['system_id']}")
    assert len(resp.json()) == 1
    assert resp.json()[0]["title"] == "P-F1"


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_pbi_minimal(client, project, feature):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={"title": "Login UI", "parent_feature_system_id": feature["system_id"]},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Login UI"
    assert data["id"] is None
    assert data["location"] == "backlog"
    assert data["parent_feature_system_id"] == feature["system_id"]


@pytest.mark.asyncio
async def test_create_pbi_with_all_fields(client, project, feature):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={
            "title": "2FA",
            "description": "Two-factor auth",
            "effort": 3,
            "id": 102,
            "parent_feature_system_id": feature["system_id"],
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == 102
    assert data["effort"] == 3


@pytest.mark.asyncio
async def test_create_pbi_parent_not_in_project(client, project):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/pbis",
        json={"title": "Orphan", "parent_feature_system_id": "does-not-exist"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_pbi_duplicate_user_id(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P1", "id": 201, "parent_feature_system_id": fid})
    resp = await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P2", "id": 201, "parent_feature_system_id": fid})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ID_ALREADY_EXISTS"


@pytest.mark.asyncio
async def test_pbi_id_conflicts_with_feature_id(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    await client.patch(f"/api/v1/features/{fid}", json={"id": 101})
    resp = await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "PBI same id", "id": 101, "parent_feature_system_id": fid},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ID_ALREADY_EXISTS"


@pytest.mark.asyncio
async def test_create_pbi_null_id_allowed_multiple(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    r1 = await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P1", "parent_feature_system_id": fid})
    r2 = await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P2", "parent_feature_system_id": fid})
    assert r1.status_code == 201
    assert r2.status_code == 201


# ── Get ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_pbi(client, pbi):
    resp = await client.get(f"/api/v1/pbis/{pbi['system_id']}")
    assert resp.status_code == 200
    assert resp.json()["system_id"] == pbi["system_id"]


@pytest.mark.asyncio
async def test_get_pbi_not_found(client):
    assert (await client.get("/api/v1/pbis/does-not-exist")).status_code == 404


# ── Update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_pbi_title(client, pbi):
    resp = await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"title": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"


@pytest.mark.asyncio
async def test_update_pbi_set_user_id(client, pbi):
    resp = await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"id": 303})
    assert resp.status_code == 200
    assert resp.json()["id"] == 303


@pytest.mark.asyncio
async def test_update_pbi_clear_user_id(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    p = (await client.post(f"/api/v1/projects/{pid}/pbis",
        json={"title": "P", "id": 201, "parent_feature_system_id": fid})).json()
    resp = await client.patch(f"/api/v1/pbis/{p['system_id']}", json={"id": None})
    assert resp.status_code == 200
    assert resp.json()["id"] is None


@pytest.mark.asyncio
async def test_update_pbi_same_id_is_ok(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    p = (await client.post(f"/api/v1/projects/{pid}/pbis",
        json={"title": "P", "id": 201, "parent_feature_system_id": fid})).json()
    resp = await client.patch(f"/api/v1/pbis/{p['system_id']}", json={"id": 201, "title": "Renamed"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_update_pbi_duplicate_id(client, project, feature):
    pid, fid = project["system_id"], feature["system_id"]
    await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P1", "id": 201, "parent_feature_system_id": fid})
    p2 = (await client.post(f"/api/v1/projects/{pid}/pbis", json={"title": "P2", "parent_feature_system_id": fid})).json()
    resp = await client.patch(f"/api/v1/pbis/{p2['system_id']}", json={"id": 201})
    assert resp.status_code == 409


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_pbi(client, pbi):
    resp = await client.delete(f"/api/v1/pbis/{pbi['system_id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/pbis/{pbi['system_id']}")).status_code == 404


@pytest.mark.asyncio
async def test_delete_last_pbi_in_group_removes_group(client, db, project, feature):
    from app.models.pbi import PBI as PBIModel
    pid, fid = project["system_id"], feature["system_id"]

    # Create a PBI via API
    p = (await client.post(f"/api/v1/projects/{pid}/pbis",
        json={"title": "Only PBI", "parent_feature_system_id": fid})).json()
    pbi_id = p["system_id"]

    # Create a group and assign the PBI to it directly in DB
    group = Group(swimline_id="dummy", feature_system_id=fid, name="G1")
    db.add(group)
    await db.flush()
    pbi_row = await db.get(PBIModel, pbi_id)
    pbi_row.group_id = group.system_id
    await db.commit()

    group_id = group.system_id
    resp = await client.delete(f"/api/v1/pbis/{pbi_id}")
    assert resp.status_code == 204

    result = await db.execute(select(Group).where(Group.system_id == group_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_delete_pbi_non_last_in_group_keeps_group(client, db, project, feature):
    from app.models.pbi import PBI as PBIModel
    pid, fid = project["system_id"], feature["system_id"]

    p1 = (await client.post(f"/api/v1/projects/{pid}/pbis",
        json={"title": "PBI 1", "parent_feature_system_id": fid})).json()
    p2 = (await client.post(f"/api/v1/projects/{pid}/pbis",
        json={"title": "PBI 2", "parent_feature_system_id": fid})).json()

    group = Group(swimline_id="dummy", feature_system_id=fid, name="G2")
    db.add(group)
    await db.flush()
    for pbi_id in [p1["system_id"], p2["system_id"]]:
        row = await db.get(PBIModel, pbi_id)
        row.group_id = group.system_id
    await db.commit()

    group_id = group.system_id
    await client.delete(f"/api/v1/pbis/{p1['system_id']}")

    result = await db.execute(select(Group).where(Group.system_id == group_id))
    assert result.scalar_one_or_none() is not None
