import pytest


@pytest.mark.asyncio
async def test_list_projects_empty(client):
    resp = await client.get("/api/v1/projects/")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_project(client):
    resp = await client.post("/api/v1/projects/", json={"name": "My Project"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Project"
    assert "system_id" in data
    assert data["description"] is None


@pytest.mark.asyncio
async def test_create_project_with_description(client):
    resp = await client.post("/api/v1/projects/", json={"name": "Proj", "description": "Desc"})
    assert resp.status_code == 201
    assert resp.json()["description"] == "Desc"


@pytest.mark.asyncio
async def test_create_project_duplicate_name(client):
    await client.post("/api/v1/projects/", json={"name": "Dup"})
    resp = await client.post("/api/v1/projects/", json={"name": "Dup"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "NAME_TAKEN"


@pytest.mark.asyncio
async def test_get_project(client):
    create = await client.post("/api/v1/projects/", json={"name": "Proj"})
    pid = create.json()["system_id"]
    resp = await client.get(f"/api/v1/projects/{pid}")
    assert resp.status_code == 200
    assert resp.json()["system_id"] == pid


@pytest.mark.asyncio
async def test_get_project_not_found(client):
    resp = await client.get("/api/v1/projects/does-not-exist")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_project(client):
    create = await client.post("/api/v1/projects/", json={"name": "Old Name"})
    pid = create.json()["system_id"]
    resp = await client.patch(f"/api/v1/projects/{pid}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_update_project_duplicate_name(client):
    await client.post("/api/v1/projects/", json={"name": "A"})
    b = await client.post("/api/v1/projects/", json={"name": "B"})
    pid = b.json()["system_id"]
    resp = await client.patch(f"/api/v1/projects/{pid}", json={"name": "A"})
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_project(client):
    create = await client.post("/api/v1/projects/", json={"name": "To Delete"})
    pid = create.json()["system_id"]
    resp = await client.delete(f"/api/v1/projects/{pid}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/projects/{pid}")).status_code == 404


@pytest.mark.asyncio
async def test_list_projects_ordered_by_modified(client):
    a = await client.post("/api/v1/projects/", json={"name": "Alpha"})
    b = await client.post("/api/v1/projects/", json={"name": "Beta"})
    # Update Alpha so its modified_at is newest
    await client.patch(f"/api/v1/projects/{a.json()['system_id']}", json={"name": "Alpha Updated"})
    resp = await client.get("/api/v1/projects/")
    names = [p["name"] for p in resp.json()]
    assert names[0] == "Alpha Updated"
    assert b.json()["name"] in names


@pytest.mark.asyncio
async def test_export_project(client):
    create = await client.post("/api/v1/projects/", json={"name": "Export Me"})
    pid = create.json()["system_id"]
    resp = await client.get(f"/api/v1/projects/{pid}/export")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "1.0"
    assert "exported_at" in data
    assert data["project"]["name"] == "Export Me"
    assert data["project"]["system_id"] == pid
    assert "features" in data["project"]
    assert "pbis" in data["project"]
    assert "pis" in data["project"]
    assert "Content-Disposition" in resp.headers
    assert "Export_Me" in resp.headers["Content-Disposition"]


@pytest.mark.asyncio
async def test_export_no_sensitive_data(client):
    create = await client.post("/api/v1/projects/", json={"name": "Secure"})
    pid = create.json()["system_id"]
    resp = await client.get(f"/api/v1/projects/{pid}/export")
    text = resp.text
    assert "password" not in text.lower()
    assert "session" not in text.lower()


@pytest.mark.asyncio
async def test_export_includes_full_pi_structure(client):
    """Export contains PI, sprints, swimlines, groups, features and PBIs."""
    # Create project
    pid = (await client.post("/api/v1/projects/", json={"name": "Full Export"})).json()["system_id"]

    # Create feature in backlog (effort is computed from PBIs)
    fid = (await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth"},
    )).json()["system_id"]

    # Create PBI
    pbi_id = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login", "effort": 3, "parent_feature_system_id": fid},
    )).json()["system_id"]

    # Create PI (auto-creates 5 sprints)
    pi_id = (await client.post(
        f"/api/v1/projects/{pid}/pis",
        json={"name": "Q1-2026"},
    )).json()["system_id"]

    # Create swimline and move feature into it
    sl_id = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines",
        json={"name": "Team A"},
    )).json()["system_id"]
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sl_id})

    # Create group with PBI, assign to sprint 0
    g_id = (await client.post(
        f"/api/v1/swimlines/{sl_id}/groups",
        json={"name": "Login Group", "feature_system_id": fid,
              "pbi_ids": [pbi_id], "sprint_index": 0},
    )).json()["system_id"]

    # Export
    resp = await client.get(f"/api/v1/projects/{pid}/export")
    assert resp.status_code == 200
    data = resp.json()
    proj = data["project"]

    # Features
    assert len(proj["features"]) == 1
    assert proj["features"][0]["title"] == "Auth"
    assert proj["features"][0]["effort"] == 3  # sum of PBI efforts
    assert proj["features"][0]["location"] == "pi"

    # PBIs
    assert len(proj["pbis"]) == 1
    assert proj["pbis"][0]["title"] == "Login"
    assert proj["pbis"][0]["group_id"] == g_id

    # PI
    assert len(proj["pis"]) == 1
    pi_export = proj["pis"][0]
    assert pi_export["system_id"] == pi_id
    assert pi_export["name"] == "Q1-2026"

    # Sprints (5 auto-created)
    assert len(pi_export["sprints"]) == 5

    # Swimline and group
    assert len(pi_export["swimlines"]) == 1
    sl_export = pi_export["swimlines"][0]
    assert sl_export["name"] == "Team A"
    assert len(sl_export["groups"]) == 1
    assert sl_export["groups"][0]["name"] == "Login Group"
    assert sl_export["groups"][0]["sprint_index"] == 0


@pytest.mark.asyncio
async def test_export_404_unknown_project(client):
    resp = await client.get("/api/v1/projects/nonexistent/export")
    assert resp.status_code == 404
