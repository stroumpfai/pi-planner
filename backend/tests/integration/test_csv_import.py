"""Integration tests for CSV import service (Phase 2.1)."""
import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Import Project"})).json()


def _url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/import/csv"


def _row(row_number: int, item_type: str, title: str, **kwargs):
    return {"row_number": row_number, "item_type": item_type, "title": title, **kwargs}


@pytest.fixture
def captured_events(monkeypatch):
    events: list[tuple[str, str, dict]] = []

    async def fake_broadcast(project_id, event_type, data):
        events.append((project_id, event_type, data))

    from app.services.events import broadcaster
    monkeypatch.setattr(broadcaster, "broadcast", fake_broadcast)
    return events


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
async def test_reimport_orphans_reuses_single_unassigned_feature(client, project):
    """Re-importing the same orphan stories must not pile up empty "Unassigned" features."""
    pid = project["system_id"]
    rows = [
        _row(1, "story", "Login Story", user_id=201),
        _row(2, "story", "Logout Story", user_id=202),
    ]
    await client.post(_url(pid), json={"rows": rows})
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 200
    assert resp.json()["updated_stories"] == 2
    assert resp.json()["created_stories"] == 0

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    unassigned = [f for f in features if f["title"] == "Unassigned"]
    assert len(unassigned) == 1

    # The one placeholder still holds both stories — none were orphaned elsewhere.
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis?feature_id={unassigned[0]['system_id']}")).json()
    assert len(pbis) == 2


@pytest.mark.asyncio
async def test_new_orphans_join_the_existing_unassigned_feature(client, project):
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(1, "story", "First", user_id=201)]})
    resp = await client.post(_url(pid), json={"rows": [_row(1, "story", "Second", user_id=202)]})
    assert resp.status_code == 200
    assert resp.json()["created_stories"] == 1

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    unassigned = [f for f in features if f["title"] == "Unassigned"]
    assert len(unassigned) == 1
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis?feature_id={unassigned[0]['system_id']}")).json()
    assert {p["title"] for p in pbis} == {"First", "Second"}


@pytest.mark.asyncio
async def test_result_reports_where_existing_orphans_live(client, project):
    """A re-import that only updates orphans must name the feature holding them."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(1, "story", "First", user_id=201)]})
    feats = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    placeholder = [f for f in feats if f["title"] == "Unassigned"][0]

    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={
        "name": "PI 1", "start_date": "2026-01-01",
        "sprint_count": 2, "sprint_length_days": 14,
    })).json()
    swimline = (await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "Team A"}
    )).json()
    await client.patch(f"/api/v1/features/{placeholder['system_id']}", json={
        "location": "pi", "swimlane_id": swimline["system_id"], "pi_id": pi["system_id"],
    })

    resp = await client.post(_url(pid), json={"rows": [_row(1, "story", "First v2", user_id=201)]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["orphan_stories"] == 1
    assert data["orphan_stories_placed"] == 0
    assert data["orphan_stories_existing"] == [
        {"feature_title": "Unassigned", "location": "pi", "count": 1}
    ]


@pytest.mark.asyncio
async def test_result_reports_newly_placed_orphans(client, project):
    pid = project["system_id"]
    resp = await client.post(_url(pid), json={"rows": [
        _row(1, "story", "A", user_id=201),
        _row(2, "story", "B"),
    ]})
    data = resp.json()
    assert data["orphan_stories"] == 2
    assert data["orphan_stories_placed"] == 2
    assert data["orphan_stories_existing"] == []


@pytest.mark.asyncio
async def test_result_splits_placed_and_existing_orphans(client, project):
    """A file mixing a new orphan with one that already exists reports both sides."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Known", user_id=201, parent_id=101),
    ]})

    resp = await client.post(_url(pid), json={"rows": [
        _row(1, "story", "Known v2", user_id=201),
        _row(2, "story", "Brand new", user_id=202),
    ]})
    data = resp.json()
    assert data["orphan_stories"] == 2
    assert data["orphan_stories_placed"] == 1
    assert data["orphan_stories_existing"] == [
        {"feature_title": "Auth Feature", "location": "backlog", "count": 1}
    ]


@pytest.mark.asyncio
async def test_unassigned_on_the_pi_board_is_not_reused(client, project):
    """Imports land in the backlog, so a placeholder moved onto the board is not a target."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(1, "story", "First", user_id=201)]})
    feats = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    placeholder = [f for f in feats if f["title"] == "Unassigned"][0]

    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={
        "name": "PI 1", "start_date": "2026-01-01",
        "sprint_count": 2, "sprint_length_days": 14,
    })).json()
    swimline = (await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "Team A"}
    )).json()
    moved = await client.patch(f"/api/v1/features/{placeholder['system_id']}", json={
        "location": "pi", "swimlane_id": swimline["system_id"], "pi_id": pi["system_id"],
    })
    assert moved.status_code == 200

    resp = await client.post(_url(pid), json={"rows": [_row(1, "story", "Second", user_id=202)]})
    assert resp.status_code == 200
    assert resp.json()["created_stories"] == 1

    feats = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    backlog = [f for f in feats if f["location"] == "backlog" and f["title"] == "Unassigned"]
    assert len(backlog) == 1
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis?feature_id={backlog[0]['system_id']}")).json()
    assert [p["title"] for p in pbis] == ["Second"]


@pytest.mark.asyncio
async def test_orphan_updates_alone_create_no_unassigned_feature(client, project):
    """A re-import of stories that already live under a real feature adds no placeholder."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Login UI", user_id=201, parent_id=101),
    ]})

    # Same story, but the parent feature is absent from this file — an orphan row
    # that nonetheless resolves to an existing story and is updated in place.
    resp = await client.post(_url(pid), json={"rows": [_row(1, "story", "Login UI v2", user_id=201)]})
    assert resp.status_code == 200
    assert resp.json()["updated_stories"] == 1

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert [f["title"] for f in features] == ["Auth Feature"]


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


# ── Removals (Removed status reconciliation) ────────────────────────────────────

@pytest.mark.asyncio
async def test_removal_deletes_feature_and_child_pbis(client, project):
    """Removing a feature cascades to its child PBIs."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Login UI", user_id=201, parent_id=101),
    ]})
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    feature_sid = next(f["system_id"] for f in features if f["id"] == 101)

    resp = await client.post(_url(pid), json={"rows": [], "removals": [feature_sid]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["removed_features"] == 1
    assert data["removed_stories"] == 0  # child removed via cascade, not counted separately

    assert (await client.get(f"/api/v1/projects/{pid}/features")).json() == []
    assert (await client.get(f"/api/v1/projects/{pid}/pbis")).json() == []


@pytest.mark.asyncio
async def test_removal_deletes_story_keeps_feature(client, project):
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Login UI", user_id=201, parent_id=101),
    ]})
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    story_sid = next(p["system_id"] for p in pbis if p["id"] == 201)

    resp = await client.post(_url(pid), json={"rows": [], "removals": [story_sid]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["removed_stories"] == 1
    assert data["removed_features"] == 0

    assert len((await client.get(f"/api/v1/projects/{pid}/features")).json()) == 1
    assert (await client.get(f"/api/v1/projects/{pid}/pbis")).json() == []


@pytest.mark.asyncio
async def test_removal_unknown_system_id_is_ignored(client, project):
    pid = project["system_id"]
    resp = await client.post(_url(pid), json={"rows": [], "removals": ["does-not-exist"]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["removed_features"] == 0
    assert data["removed_stories"] == 0


@pytest.mark.asyncio
async def test_removal_feature_and_its_child_both_listed(client, project):
    """A child PBI whose id is also in removals is already cascade-deleted — no error."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Auth Feature", user_id=101),
        _row(2, "story", "Login UI", user_id=201, parent_id=101),
    ]})
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    feature_sid = next(f["system_id"] for f in features if f["id"] == 101)
    story_sid = next(p["system_id"] for p in pbis if p["id"] == 201)

    resp = await client.post(_url(pid), json={"rows": [], "removals": [feature_sid, story_sid]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["removed_features"] == 1
    assert data["removed_stories"] == 0  # child gone via cascade before its own removal
    assert (await client.get(f"/api/v1/projects/{pid}/pbis")).json() == []


@pytest.mark.asyncio
async def test_removal_combined_with_create_and_update(client, project):
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Old Feature", user_id=101),
        _row(2, "feature", "Doomed Feature", user_id=102),
    ]})
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    doomed_sid = next(f["system_id"] for f in features if f["id"] == 102)

    resp = await client.post(_url(pid), json={
        "rows": [
            _row(1, "feature", "Updated Feature", user_id=101),  # update
            _row(2, "feature", "Brand New", user_id=103),        # create
        ],
        "removals": [doomed_sid],                                 # remove
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["updated_features"] == 1
    assert data["created_features"] == 1
    assert data["removed_features"] == 1

    features_after = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    by_id = {f["id"]: f["title"] for f in features_after}
    assert by_id == {101: "Updated Feature", 103: "Brand New"}


# ── Removals and the PI board ─────────────────────────────────────────────────

async def _place_story_in_sprint(client, pid: str) -> tuple[str, str]:
    """Create a story sitting in a sprint and return (story_system_id, group_system_id)."""
    pi_id = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "Q1"})).json()["system_id"]
    sl_id = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team A"})).json()["system_id"]

    await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Board Feature", user_id=101),
        _row(2, "story", "Placed Story", user_id=201, parent_id=101),
    ]})
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    feature_sid = next(f["system_id"] for f in features if f["id"] == 101)
    await client.patch(f"/api/v1/features/{feature_sid}", json={"swimlane_id": sl_id})

    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    story_sid = next(p["system_id"] for p in pbis if p["id"] == 201)
    group = (await client.post(
        f"/api/v1/pbis/{story_sid}/place", json={"sprint_index": 1}
    )).json()["group"]
    return story_sid, group["system_id"]


@pytest.mark.asyncio
async def test_removing_a_placed_story_takes_its_implicit_group(client, project):
    """SQLite runs without foreign-key enforcement, so the group has to be cleaned up
    here — otherwise the board keeps a card pointing at a story that no longer exists."""
    pid = project["system_id"]
    story_sid, group_sid = await _place_story_in_sprint(client, pid)

    resp = await client.post(_url(pid), json={"rows": [], "removals": [story_sid]})
    assert resp.status_code == 200
    assert resp.json()["removed_stories"] == 1

    assert (await client.get(f"/api/v1/groups/{group_sid}")).status_code == 404


@pytest.mark.asyncio
async def test_removing_a_placed_story_broadcasts_group_deleted(client, project, captured_events):
    pid = project["system_id"]
    story_sid, group_sid = await _place_story_in_sprint(client, pid)
    captured_events.clear()

    await client.post(_url(pid), json={"rows": [], "removals": [story_sid]})

    assert (pid, "group:deleted", {"system_id": group_sid}) in captured_events


@pytest.mark.asyncio
async def test_removing_one_of_two_stories_leaves_the_group_alone(client, project):
    pid = project["system_id"]
    _, group_sid = await _place_story_in_sprint(client, pid)

    # A second story joins the same group, so removing the first must not empty it.
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    feature_sid = next(f["system_id"] for f in features if f["id"] == 101)
    other = (await client.post(f"/api/v1/projects/{pid}/pbis", json={
        "title": "Room-mate", "parent_feature_system_id": feature_sid,
    })).json()
    await client.patch(f"/api/v1/pbis/{other['system_id']}", json={"group_id": group_sid})

    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    story_sid = next(p["system_id"] for p in pbis if p["id"] == 201)
    await client.post(_url(pid), json={"rows": [], "removals": [story_sid]})

    assert (await client.get(f"/api/v1/groups/{group_sid}")).status_code == 200


# ── Item type switches and State ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_switching_a_story_to_a_bug_without_a_state_column_clears_the_state(client, project):
    """Stories and Bugs draw from separate State Lists, so the old State is stranded —
    the same guard PATCH /pbis/{id} applies."""
    pid = project["system_id"]
    await client.post(_url(pid), json={
        "rows": [
            _row(1, "feature", "Auth", user_id=101),
            _row(2, "story", "Login", user_id=201, parent_id=101, state="In Progress"),
        ],
        "has_state_column": True,
    })
    story = next(
        p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json() if p["id"] == 201
    )
    assert story["state"] == "In Progress"

    # Same item re-imported as a Bug, from a file that carries no State column.
    resp = await client.post(_url(pid), json={"rows": [
        _row(1, "feature", "Auth", user_id=101),
        _row(2, "bug", "Login", user_id=201, parent_id=101),
    ]})
    assert resp.status_code == 200

    after = next(
        p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json() if p["id"] == 201
    )
    assert after["item_type"] == "bug"
    assert after["state_id"] is None
    assert after["state"] is None


@pytest.mark.asyncio
async def test_switching_type_with_a_state_column_takes_the_new_lists_state(client, project):
    pid = project["system_id"]
    await client.post(_url(pid), json={
        "rows": [_row(1, "story", "Login", user_id=201, state="In Progress")],
        "has_state_column": True,
    })
    resp = await client.post(_url(pid), json={
        "rows": [_row(1, "bug", "Login", user_id=201, state="Triaged")],
        "has_state_column": True,
    })
    assert resp.status_code == 200

    after = next(
        p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json() if p["id"] == 201
    )
    assert after["item_type"] == "bug"
    assert after["state"] == "Triaged"

    states = (await client.get(f"/api/v1/projects/{pid}/states/")).json()
    assert {(s["item_type"], s["value"]) for s in states} == {
        ("story", "In Progress"), ("bug", "Triaged"),
    }


@pytest.mark.asyncio
async def test_re_importing_the_same_type_keeps_the_state(client, project):
    """The clear is scoped to a type switch — an ordinary update must not lose State."""
    pid = project["system_id"]
    await client.post(_url(pid), json={
        "rows": [_row(1, "story", "Login", user_id=201, state="In Progress")],
        "has_state_column": True,
    })
    await client.post(_url(pid), json={"rows": [_row(1, "story", "Login v2", user_id=201)]})

    after = next(
        p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json() if p["id"] == 201
    )
    assert after["title"] == "Login v2"
    assert after["state"] == "In Progress"
