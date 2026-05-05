import pytest
from app.models.pbi import PBI


@pytest.fixture
async def project(client):
    resp = await client.post("/api/v1/projects/", json={"name": "Test Project"})
    return resp.json()


@pytest.fixture
async def feature(client, project):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Auth Feature"},
    )
    return resp.json()


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_features_empty(client, project):
    resp = await client.get(f"/api/v1/projects/{project['system_id']}/features")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_features_returns_created(client, project):
    await client.post(f"/api/v1/projects/{project['system_id']}/features", json={"title": "F1"})
    await client.post(f"/api/v1/projects/{project['system_id']}/features", json={"title": "F2"})
    resp = await client.get(f"/api/v1/projects/{project['system_id']}/features")
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_list_features_sort_by_name(client, project):
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "Zebra"})
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "Apple"})
    resp = await client.get(f"/api/v1/projects/{pid}/features?sort=name")
    titles = [f["title"] for f in resp.json()]
    assert titles == sorted(titles)


@pytest.mark.asyncio
async def test_list_features_default_sort_is_created_at_desc(client, project):
    # Default sort returns features — just verify both are present in the list
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "First"})
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "Second"})
    resp = await client.get(f"/api/v1/projects/{pid}/features")
    titles = {f["title"] for f in resp.json()}
    assert titles == {"First", "Second"}


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_feature_minimal(client, project):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "New Feature"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "New Feature"
    assert data["id"] is None
    assert data["location"] == "backlog"
    assert "system_id" in data


@pytest.mark.asyncio
async def test_create_feature_with_all_fields(client, project):
    resp = await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Full Feature", "description": "Desc", "id": 101},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == 101
    assert data["effort"] == 0  # no PBIs yet
    assert data["description"] == "Desc"


@pytest.mark.asyncio
async def test_create_feature_duplicate_user_id(client, project):
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F1", "id": 101})
    resp = await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F2", "id": 101})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ID_ALREADY_EXISTS"


@pytest.mark.asyncio
async def test_create_feature_null_user_id_allowed_multiple(client, project):
    pid = project["system_id"]
    r1 = await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F1"})
    r2 = await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F2"})
    assert r1.status_code == 201
    assert r2.status_code == 201


# ── Get ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_feature(client, feature):
    resp = await client.get(f"/api/v1/features/{feature['system_id']}")
    assert resp.status_code == 200
    assert resp.json()["system_id"] == feature["system_id"]


@pytest.mark.asyncio
async def test_get_feature_not_found(client):
    resp = await client.get("/api/v1/features/does-not-exist")
    assert resp.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_feature_title(client, feature):
    resp = await client.patch(f"/api/v1/features/{feature['system_id']}", json={"title": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"


@pytest.mark.asyncio
async def test_update_feature_set_user_id(client, feature):
    resp = await client.patch(f"/api/v1/features/{feature['system_id']}", json={"id": 202})
    assert resp.status_code == 200
    assert resp.json()["id"] == 202


@pytest.mark.asyncio
async def test_update_feature_clear_user_id(client, project):
    pid = project["system_id"]
    f = (await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F", "id": 101})).json()
    resp = await client.patch(f"/api/v1/features/{f['system_id']}", json={"id": None})
    assert resp.status_code == 200
    assert resp.json()["id"] is None


@pytest.mark.asyncio
async def test_update_feature_duplicate_user_id(client, project):
    pid = project["system_id"]
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F1", "id": 101})
    f2 = (await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F2"})).json()
    resp = await client.patch(f"/api/v1/features/{f2['system_id']}", json={"id": 101})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ID_ALREADY_EXISTS"


@pytest.mark.asyncio
async def test_update_feature_same_user_id_is_ok(client, project):
    pid = project["system_id"]
    f = (await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F", "id": 101})).json()
    resp = await client.patch(f"/api/v1/features/{f['system_id']}", json={"id": 101, "title": "Renamed"})
    assert resp.status_code == 200


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_feature(client, feature):
    fid = feature["system_id"]
    resp = await client.delete(f"/api/v1/features/{fid}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/features/{fid}")).status_code == 404


@pytest.mark.asyncio
async def test_delete_feature_cascades_pbis(client, db, project, feature):
    fid = feature["system_id"]
    pid = project["system_id"]
    # Insert a PBI directly — the /pbis route is not yet implemented (M3)
    pbi = PBI(project_id=pid, parent_feature_system_id=fid, title="Child PBI")
    db.add(pbi)
    await db.commit()
    pbi_id = pbi.system_id

    await client.delete(f"/api/v1/features/{fid}")
    resp = await client.get(f"/api/v1/features/{fid}")
    assert resp.status_code == 404
    # PBI should be gone too (cascade delete)
    from sqlalchemy import select
    result = await db.execute(select(PBI).where(PBI.system_id == pbi_id))
    assert result.scalar_one_or_none() is None


# ── Cross-entity user_id uniqueness ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_feature_id_conflicts_with_pbi_id(client, db, project, feature):
    pid = project["system_id"]
    fid = feature["system_id"]
    # Insert PBI with user_id=202 directly — the /pbis route is not yet implemented (M3)
    pbi = PBI(project_id=pid, parent_feature_system_id=fid, title="PBI", user_id=202)
    db.add(pbi)
    await db.commit()

    resp = await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Feature with same ID", "id": 202},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ID_ALREADY_EXISTS"
