"""Integration tests for CSV import service (Phase 2.1)."""
import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Import Project"})).json()


def _url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/import/csv"


def _row(row_number: int, item_type: str, title: str, **kwargs):
    return {"row_number": row_number, "item_type": item_type, "title": title, **kwargs}


# ── Empty rows ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_empty_rows(client, project):
    resp = await client.post(_url(project["system_id"]), json={"rows": []})
    assert resp.status_code == 200
    data = resp.json()
    assert data["created_features"] == 0
    assert data["created_stories"] == 0
    assert data["orphan_stories"] == 0


# ── Valid imports ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_features_only(client, project):
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "feature", "Payment Feature", user_id=102),
    ]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 200
    data = resp.json()
    assert data["created_features"] == 2
    assert data["created_stories"] == 0
    assert data["updated_features"] == 0

    # Features should appear in project
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert len(features) == 2
    titles = {f["title"] for f in features}
    assert titles == {"Auth Feature", "Payment Feature"}


@pytest.mark.asyncio
async def test_import_stories_only_creates_unassigned_feature(client, project):
    pid = project["system_id"]
    rows = [
        _row(1, "story", "Login Story", user_id=201),
        _row(2, "story", "Logout Story"),
    ]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 200
    data = resp.json()
    assert data["created_stories"] == 2
    assert data["orphan_stories"] == 2

    # An "Unassigned" feature should have been created
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    feature_titles = {f["title"] for f in features}
    assert "Unassigned" in feature_titles


@pytest.mark.asyncio
async def test_import_mixed_with_parent_linking(client, project):
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Login UI", user_id=201, parent_id=101),
        _row(3, "bug", "Login Bug", user_id=202, parent_id=101),
    ]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 200
    data = resp.json()
    assert data["created_features"] == 1
    assert data["created_stories"] == 2
    assert data["orphan_stories"] == 0

    # Verify features
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert len(features) == 1
    assert features[0]["title"] == "Auth Feature"

    # Verify PBIs are linked to the feature
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis?feature_id={features[0]['system_id']}")).json()
    assert len(pbis) == 2
    pbi_titles = {p["title"] for p in pbis}
    assert pbi_titles == {"Login UI", "Login Bug"}


@pytest.mark.asyncio
async def test_import_orphan_stories_partial_parents(client, project):
    """Stories with unknown parent_id go to Unassigned; others link correctly."""
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Linked Story", user_id=201, parent_id=101),
        _row(3, "story", "Orphan Story", user_id=202, parent_id=999),  # 999 not in import
    ]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 200
    data = resp.json()
    assert data["orphan_stories"] == 1

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    feature_titles = {f["title"] for f in features}
    assert "Unassigned" in feature_titles


# ── Upsert ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upsert_updates_existing_feature_by_user_id(client, project):
    pid = project["system_id"]
    # First import
    await client.post(_url(pid), json={"rows": [_row(1, "feature", "Old Title", user_id=101)]})
    features_before = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert len(features_before) == 1
    assert features_before[0]["title"] == "Old Title"

    # Second import with same user_id
    resp = await client.post(_url(pid), json={"rows": [_row(1, "feature", "New Title", user_id=101)]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated_features"] == 1
    assert data["created_features"] == 0

    features_after = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert len(features_after) == 1
    assert features_after[0]["title"] == "New Title"


@pytest.mark.asyncio
async def test_upsert_updates_existing_story_by_user_id(client, project):
    pid = project["system_id"]
    rows_first = [
        _row(1, "feature", "Auth", user_id=101),
        _row(2, "story", "Old Story", user_id=201, parent_id=101),
    ]
    await client.post(_url(pid), json={"rows": rows_first})

    # Re-import with updated story title
    rows_second = [
        _row(1, "feature", "Auth", user_id=101),
        _row(2, "story", "Updated Story", user_id=201, parent_id=101),
    ]
    resp = await client.post(_url(pid), json={"rows": rows_second})
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated_stories"] == 1
    assert data["created_stories"] == 0


# ── Validation errors ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_missing_title_error(client, project):
    rows = [_row(1, "feature", "   ")]  # blank title
    resp = await client.post(_url(project["system_id"]), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "errors" in detail
    assert any("missing title" in e["message"] for e in detail["errors"])


@pytest.mark.asyncio
async def test_import_bad_item_type_error(client, project):
    rows = [_row(1, "widget", "Something")]
    resp = await client.post(_url(project["system_id"]), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("unknown type" in e["message"] for e in detail["errors"])


@pytest.mark.asyncio
async def test_import_out_of_range_id_error(client, project):
    rows = [_row(1, "feature", "Big ID", user_id=1_000_000)]
    resp = await client.post(_url(project["system_id"]), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("out of range" in e["message"] for e in detail["errors"])


@pytest.mark.asyncio
async def test_import_duplicate_id_in_file_error(client, project):
    rows = [
        _row(1, "feature", "Feature A", user_id=101),
        _row(2, "feature", "Feature B", user_id=101),  # same id
    ]
    resp = await client.post(_url(project["system_id"]), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("more than once" in e["message"] for e in detail["errors"])


@pytest.mark.asyncio
async def test_import_multiple_validation_errors_returned(client, project):
    rows = [
        _row(1, "feature", ""),  # missing title
        _row(2, "invalid_type", "Something"),  # bad item_type
    ]
    resp = await client.post(_url(project["system_id"]), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert len(detail["errors"]) >= 2


# ── Cross-entity errors ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_feature_id_conflicts_with_existing_pbi(client, project):
    pid = project["system_id"]
    # Create a PBI with user_id=201 first
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Existing Feature"}
    )).json()
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Existing PBI", "id": 201, "parent_feature_system_id": feature["system_id"]},
    )

    # Try to import a feature with the same ID
    rows = [_row(1, "feature", "New Feature", user_id=201)]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("story" in e["message"] for e in detail["errors"])


@pytest.mark.asyncio
async def test_import_bug_id_conflicts_with_existing_feature(client, project):
    pid = project["system_id"]
    # Create a feature with user_id=101
    await client.post(f"/api/v1/projects/{pid}/features", json={"title": "Existing Feature", "id": 101})

    # Try to import a bug with the same ID — "bug" type is checked against feature_map
    rows = [_row(1, "bug", "New Bug", user_id=101)]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any("feature" in e["message"] for e in detail["errors"])


@pytest.mark.asyncio
async def test_import_project_not_found(client):
    rows = [_row(1, "feature", "Feature A")]
    resp = await client.post("/api/v1/projects/nonexistent/import/csv", json={"rows": rows})
    assert resp.status_code == 404
