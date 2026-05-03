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
