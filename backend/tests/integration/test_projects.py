import json

import pytest
from httpx import AsyncClient


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


# ── Additional project tests (Phase 2.6) ──────────────────────────────────────

@pytest.mark.asyncio
async def test_update_project_description(client):
    create = await client.post("/api/v1/projects/", json={"name": "Desc Project"})
    pid = create.json()["system_id"]
    resp = await client.patch(f"/api/v1/projects/{pid}", json={"description": "A description"})
    assert resp.status_code == 200
    assert resp.json()["description"] == "A description"


@pytest.mark.asyncio
async def test_delete_project_not_found(client):
    resp = await client.delete("/api/v1/projects/nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_project_with_nested_data(client):
    """Delete a project that has features, PBIs, PI, and swimlane — should cascade."""
    create = await client.post("/api/v1/projects/", json={"name": "Nested Project"})
    pid = create.json()["system_id"]

    # Create feature
    fid = (await client.post(f"/api/v1/projects/{pid}/features", json={"title": "F1"})).json()["system_id"]

    # Create PBI
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "PBI 1", "parent_feature_system_id": fid},
    )

    # Create PI (auto-creates sprints)
    pi_id = (await client.post(
        f"/api/v1/projects/{pid}/pis", json={"name": "Q1"}
    )).json()["system_id"]

    # Create swimline
    sl_id = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team A"}
    )).json()["system_id"]

    # Move feature to swimline
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sl_id})

    # Delete the project
    resp = await client.delete(f"/api/v1/projects/{pid}")
    assert resp.status_code == 204

    # Project should be gone
    assert (await client.get(f"/api/v1/projects/{pid}")).status_code == 404

    # Features, PI, swimline should be gone too
    assert (await client.get(f"/api/v1/features/{fid}")).status_code == 404
    assert (await client.get(f"/api/v1/pis/{pi_id}")).status_code == 404
    assert (await client.get(f"/api/v1/swimlines/{sl_id}")).status_code == 404


@pytest.mark.asyncio
async def test_export_content_disposition_filename(client):
    """Content-Disposition header includes safe project name and date."""
    create = await client.post("/api/v1/projects/", json={"name": "My Project Name"})
    pid = create.json()["system_id"]
    resp = await client.get(f"/api/v1/projects/{pid}/export")
    assert resp.status_code == 200
    cd = resp.headers["Content-Disposition"]
    assert "attachment" in cd
    assert "My_Project_Name" in cd
    assert ".json" in cd


@pytest.mark.asyncio
async def test_export_project_structure_keys(client):
    """Export JSON has expected top-level keys."""
    create = await client.post("/api/v1/projects/", json={"name": "Keys Test"})
    pid = create.json()["system_id"]
    resp = await client.get(f"/api/v1/projects/{pid}/export")
    data = resp.json()
    assert "version" in data
    assert "exported_at" in data
    assert "project" in data
    project = data["project"]
    for key in ("system_id", "name", "features", "pbis", "pis"):
        assert key in project


# ── Import tests ──────────────────────────────────────────────────────────────

def _make_export_payload(name: str = "Import Test", **overrides) -> dict:
    """Minimal valid export payload."""
    return {
        "version": "1.0",
        "exported_at": "2026-01-01T00:00:00+00:00",
        "project": {
            "system_id": "old-proj-uuid",
            "name": name,
            "description": "A description",
            "effort_unit": "pts",
            "created_at": "2026-01-01T00:00:00+00:00",
            "modified_at": "2026-01-01T00:00:00+00:00",
            "features": [],
            "pbis": [],
            "pis": [],
            **overrides,
        },
    }


def _upload(payload: dict) -> tuple[str, tuple[str, bytes, str]]:
    return ("file", ("backup.json", json.dumps(payload).encode(), "application/json"))


@pytest.mark.asyncio
async def test_import_creates_new_project(client: AsyncClient):
    resp = await client.post(
        "/api/v1/projects/import",
        files=[_upload(_make_export_payload("Imported Project"))],
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Imported Project"
    assert "system_id" in data

    projects = (await client.get("/api/v1/projects/")).json()
    assert any(p["name"] == "Imported Project" for p in projects)


@pytest.mark.asyncio
async def test_import_preserves_scalar_fields(client: AsyncClient):
    payload = _make_export_payload("Scalar Fields")
    payload["project"]["description"] = "My desc"
    payload["project"]["effort_unit"] = "days"
    resp = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp.status_code == 201
    data = resp.json()
    assert data["description"] == "My desc"
    assert data["effort_unit"] == "days"


@pytest.mark.asyncio
async def test_import_regenerates_uuids(client: AsyncClient):
    """New system_id differs from original; PBI→Feature relationship preserved."""
    old_feat_id = "old-feat-uuid"
    old_pbi_id = "old-pbi-uuid"
    payload = _make_export_payload("UUID Regen")
    payload["project"]["features"] = [
        {
            "system_id": old_feat_id,
            "id": None,
            "title": "Auth",
            "description": None,
            "effort": 3,
            "location": "backlog",
            "pi_id": None,
            "swimlane_id": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "modified_at": "2026-01-01T00:00:00+00:00",
        }
    ]
    payload["project"]["pbis"] = [
        {
            "system_id": old_pbi_id,
            "id": None,
            "parent_feature_system_id": old_feat_id,
            "title": "Login",
            "description": None,
            "effort": 3,
            "location": "backlog",
            "pi_id": None,
            "swimlane_id": None,
            "group_id": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "modified_at": "2026-01-01T00:00:00+00:00",
        }
    ]

    resp = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp.status_code == 201
    new_pid = resp.json()["system_id"]
    assert new_pid != "old-proj-uuid"

    export = (await client.get(f"/api/v1/projects/{new_pid}/export")).json()
    feat = export["project"]["features"][0]
    pbi = export["project"]["pbis"][0]

    assert feat["system_id"] != old_feat_id
    assert pbi["system_id"] != old_pbi_id
    assert pbi["parent_feature_system_id"] == feat["system_id"]


@pytest.mark.asyncio
async def test_import_name_conflict_auto_suffix(client: AsyncClient):
    payload = _make_export_payload("Conflict Name")
    await client.post("/api/v1/projects/import", files=[_upload(payload)])

    resp2 = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp2.status_code == 201
    assert resp2.json()["name"] == "Conflict Name (imported)"

    resp3 = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp3.status_code == 201
    assert resp3.json()["name"] == "Conflict Name (imported 2)"


@pytest.mark.asyncio
async def test_import_invalid_json(client: AsyncClient):
    resp = await client.post(
        "/api/v1/projects/import",
        files=[("file", ("bad.json", b"not valid json", "application/json"))],
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_JSON"


@pytest.mark.asyncio
async def test_import_missing_required_fields(client: AsyncClient):
    payload = {"version": "1.0", "project": {"system_id": "x", "features": [], "pbis": [], "pis": []}}
    resp = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_FORMAT"


@pytest.mark.asyncio
async def test_import_wrong_version(client: AsyncClient):
    payload = _make_export_payload("Version Test")
    payload["version"] = "2.0"
    resp = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "UNSUPPORTED_VERSION"


@pytest.mark.asyncio
async def test_import_requires_auth(client: AsyncClient):
    from httpx import ASGITransport, AsyncClient as UnauthClient
    from app.main import app

    transport = ASGITransport(app=app)
    async with UnauthClient(transport=transport, base_url="http://test") as unauth:
        resp = await unauth.post(
            "/api/v1/projects/import",
            files=[_upload(_make_export_payload("Auth Test"))],
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_import_empty_project(client: AsyncClient):
    """Project with no features, PBIs, or PIs imports successfully."""
    resp = await client.post(
        "/api/v1/projects/import",
        files=[_upload(_make_export_payload("Empty Project"))],
    )
    assert resp.status_code == 201
    new_pid = resp.json()["system_id"]
    export = (await client.get(f"/api/v1/projects/{new_pid}/export")).json()
    assert export["project"]["features"] == []
    assert export["project"]["pbis"] == []
    assert export["project"]["pis"] == []


@pytest.mark.asyncio
async def test_import_missing_project_system_id(client: AsyncClient):
    """Project object missing system_id returns 422, not 500."""
    payload = _make_export_payload("No SysID")
    del payload["project"]["system_id"]
    resp = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_FORMAT"


@pytest.mark.asyncio
async def test_import_dangling_group_feature_reference(client: AsyncClient):
    """Group referencing an unknown feature_system_id returns 422, not 500."""
    payload = _make_export_payload("Dangling Ref")
    payload["project"]["features"] = [
        {
            "system_id": "real-feat-uuid",
            "id": None,
            "title": "Auth",
            "description": None,
            "effort": 0,
            "location": "pi",
            "pi_id": "pi-uuid",
            "swimlane_id": "sl-uuid",
            "created_at": "2026-01-01T00:00:00+00:00",
            "modified_at": "2026-01-01T00:00:00+00:00",
        }
    ]
    payload["project"]["pis"] = [
        {
            "system_id": "pi-uuid",
            "name": "Q1",
            "description": None,
            "state": "draft",
            "start_date": None,
            "end_date": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "modified_at": "2026-01-01T00:00:00+00:00",
            "sprints": [],
            "swimlines": [
                {
                    "system_id": "sl-uuid",
                    "name": "Team A",
                    "order_index": 0,
                    "groups": [
                        {
                            "system_id": "g-uuid",
                            "name": "Login",
                            "feature_system_id": "DOES-NOT-EXIST",
                            "sprint_index": 0,
                            "order_index": 0,
                        }
                    ],
                }
            ],
        }
    ]
    resp = await client.post("/api/v1/projects/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "DANGLING_REFERENCE"


@pytest.mark.asyncio
async def test_import_file_too_large(client: AsyncClient):
    """File over 10 MB returns 413."""
    big = b"x" * (10 * 1024 * 1024 + 1)
    resp = await client.post(
        "/api/v1/projects/import",
        files=[("file", ("big.json", big, "application/json"))],
    )
    assert resp.status_code == 413
    assert resp.json()["detail"]["error"] == "FILE_TOO_LARGE"
