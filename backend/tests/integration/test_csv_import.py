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

    # The same ID arriving as a Feature is a type change, not an error. Left alone
    # by default, so the story keeps its place and the row is dropped.
    rows = [_row(1, "feature", "New Feature", user_id=201)]
    resp = await client.post(_url(pid), json={"rows": rows})
    assert resp.status_code == 200
    assert resp.json()["items_retype_skipped"] == 1
    assert resp.json()["created_features"] == 0

    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    assert [p["title"] for p in pbis] == ["Existing PBI"]


@pytest.mark.asyncio
async def test_import_bug_id_conflicts_with_existing_feature(client, project):
    """A Feature arriving as a story is reported, never converted automatically."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(1, "feature", "Auth", user_id=101)]})

    resp = await client.post(_url(pid), json={
        "rows": [_row(1, "bug", "Now a bug", user_id=101)],
        "apply_type_changes": True,
    })
    assert resp.status_code == 200
    assert resp.json()["items_retype_blocked"] == 1
    assert resp.json()["items_retyped"] == 0

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert [f["title"] for f in features] == ["Auth"]
    assert (await client.get(f"/api/v1/projects/{pid}/pbis")).json() == []


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
    assert data["removed_stories"] == 1  # the child counts: it really was deleted

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
    """A child PBI whose id is also in removals is already gone with its feature — no error."""
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
    assert data["removed_stories"] == 1  # counted once, not twice for being listed twice
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


# ── Split features (work carried across several PIs) ──────────────────────────

@pytest.fixture
async def split_feature(client, project):
    """Feature 101 planned onto PI-1, then split so story 203 carries into PI-2.

    Returns the ids the continuation tests need: the origin, the continuation, and
    the stories either side of the split.
    """
    pid = project["system_id"]
    pi1 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    sw1 = (await client.post(f"/api/v1/pis/{pi1['system_id']}/swimlines", json={"name": "A"})).json()
    pi2 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-2"})).json()
    sw2 = (await client.post(f"/api/v1/pis/{pi2['system_id']}/swimlines", json={"name": "A"})).json()

    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101, state="Active"),
        _row(3, "story", "S1", user_id=201, parent_id=101),
        _row(4, "story", "S3", user_id=203, parent_id=101),
    ], "has_state_column": True})

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    origin = next(f for f in features if f["id"] == 101)
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}

    await client.patch(f"/api/v1/features/{origin['system_id']}", json={"swimlane_id": sw1["system_id"]})
    await client.post(f"/api/v1/pbis/{pbis[201]['system_id']}/place", json={"sprint_index": 0})
    continuation = (await client.post(f"/api/v1/features/{origin['system_id']}/split", json={
        "target_pi_id": pi2["system_id"],
        "target_swimline_id": sw2["system_id"],
        "pbi_ids": [pbis[203]["system_id"]],
    })).json()

    return {"project_id": pid, "origin": origin, "continuation": continuation, "pbis": pbis}


@pytest.mark.asyncio
async def test_reimport_updates_every_member_of_a_split_feature(client, split_feature):
    """Only the origin carries the user_id, but the whole lineage is the same work item."""
    pid = split_feature["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Auth & SSO", user_id=101, state="Resolved")],
        "has_state_column": True,
    })
    assert resp.status_code == 200
    assert resp.json()["updated_features"] == 1  # one CSV row, however many members

    features = {f["system_id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    for member in (split_feature["origin"], split_feature["continuation"]):
        updated = features[member["system_id"]]
        assert updated["title"] == "Auth & SSO"
        assert updated["state"] == "Resolved"


@pytest.mark.asyncio
async def test_reimport_clears_the_state_across_a_split_feature(client, split_feature):
    pid = split_feature["project_id"]
    await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Auth", user_id=101, state="")],
        "has_state_column": True,
    })
    features = {f["system_id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert features[split_feature["continuation"]["system_id"]]["state"] is None


@pytest.mark.asyncio
async def test_a_file_with_no_state_column_leaves_a_split_features_state_alone(client, split_feature):
    pid = split_feature["project_id"]
    await client.post(_url(pid), json={"rows": [_row(2, "feature", "Renamed", user_id=101)]})
    features = {f["system_id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    continuation = features[split_feature["continuation"]["system_id"]]
    assert continuation["title"] == "Renamed"
    assert continuation["state"] == "Active"


@pytest.mark.asyncio
async def test_new_stories_join_the_latest_pi_of_a_split_feature(client, split_feature):
    """Work discovered mid-PI belongs where the feature has got to, not where it began."""
    pid = split_feature["project_id"]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Newly found", user_id=204, parent_id=101),
    ]})
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[204]["parent_feature_system_id"] == split_feature["continuation"]["system_id"]


@pytest.mark.asyncio
async def test_existing_stories_of_a_split_feature_are_never_re_parented(client, split_feature):
    pid = split_feature["project_id"]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "S1 revised", user_id=201, parent_id=101),
    ]})
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["title"] == "S1 revised"
    assert pbis[201]["parent_feature_system_id"] == split_feature["origin"]["system_id"]


@pytest.mark.asyncio
async def test_new_stories_of_an_unsplit_feature_stay_with_it(client, project):
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(2, "feature", "Plain", user_id=101)]})
    origin = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Plain", user_id=101),
        _row(3, "story", "Child", user_id=201, parent_id=101),
    ]})
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    assert pbis[0]["parent_feature_system_id"] == origin["system_id"]


@pytest.mark.asyncio
async def test_removing_a_split_feature_takes_its_continuations(client, split_feature):
    pid = split_feature["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [], "removals": [split_feature["origin"]["system_id"]],
    })
    assert resp.status_code == 200
    assert resp.json()["removed_features"] == 2   # origin + continuation
    assert resp.json()["removed_stories"] == 2
    assert (await client.get(f"/api/v1/projects/{pid}/features")).json() == []
    assert (await client.get(f"/api/v1/projects/{pid}/pbis")).json() == []


@pytest.mark.asyncio
async def test_removing_a_feature_holding_a_placed_story_succeeds(client, split_feature):
    """The PBI↔Group cycle used to make this a 500 that aborted the whole import."""
    pid = split_feature["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Survivor", user_id=301)],
        "removals": [split_feature["origin"]["system_id"]],
    })
    assert resp.status_code == 200
    assert resp.json()["created_features"] == 1
    titles = {f["title"] for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert titles == {"Survivor"}



# ── Partial files: Parent resolved against the project ────────────────────────

@pytest.mark.asyncio
async def test_a_story_finds_its_parent_already_in_the_project(client, project):
    """An incremental export lists new stories only — their Parent is not in the file."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(2, "feature", "Auth", user_id=101)]})
    origin = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]

    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "New story", user_id=301, parent_id=101)],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["orphan_stories"] == 0
    assert data["stories_parented_from_project"] == 1

    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    assert pbis[0]["parent_feature_system_id"] == origin["system_id"]
    titles = {f["title"] for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert "Unassigned" not in titles


@pytest.mark.asyncio
async def test_a_parent_in_neither_file_nor_project_is_still_an_orphan(client, project):
    pid = project["system_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Lost", user_id=301, parent_id=999)],
    })
    data = resp.json()
    assert data["orphan_stories"] == 1
    assert data["stories_parented_from_project"] == 0
    titles = {f["title"] for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert "Unassigned" in titles


@pytest.mark.asyncio
async def test_a_parent_naming_a_story_is_not_a_parent(client, project):
    """Only features can be parents — an ID that names a story stays an orphan."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Existing", user_id=201, parent_id=101),
    ]})
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Child of a story", user_id=301, parent_id=201)],
    })
    assert resp.json()["orphan_stories"] == 1
    assert resp.json()["stories_parented_from_project"] == 0


@pytest.mark.asyncio
async def test_an_existing_story_is_not_counted_as_newly_parented(client, project):
    """The count names stories the file could not have placed — updates are not that."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Existing", user_id=201, parent_id=101),
    ]})
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Existing revised", user_id=201, parent_id=101)],
    })
    data = resp.json()
    assert data["updated_stories"] == 1
    assert data["orphan_stories"] == 0
    assert data["stories_parented_from_project"] == 0


@pytest.mark.asyncio
async def test_a_row_in_the_file_still_wins_over_the_project(client, project):
    """The file's own feature row is authoritative; the project is only a fallback."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(2, "feature", "Auth", user_id=101)]})
    origin = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]

    resp = await client.post(_url(pid), json={
        "rows": [
            _row(2, "feature", "Auth renamed", user_id=101),
            _row(3, "story", "Child", user_id=301, parent_id=101),
        ],
    })
    data = resp.json()
    assert data["stories_parented_from_project"] == 0  # the file listed the parent
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    assert pbis[0]["parent_feature_system_id"] == origin["system_id"]


@pytest.mark.asyncio
async def test_a_partial_file_reaches_the_newest_pi_of_a_split_feature(client, split_feature):
    """Project-resolved parents follow the lineage too, exactly as file-resolved ones do."""
    pid = split_feature["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Found mid-PI", user_id=301, parent_id=101)],
    })
    assert resp.json()["stories_parented_from_project"] == 1
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[301]["parent_feature_system_id"] == split_feature["continuation"]["system_id"]


@pytest.mark.asyncio
async def test_a_parent_removed_in_this_import_does_not_resolve(client, project):
    """Removals run first, so a Parent pointing at a deleted feature is an orphan."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [_row(2, "feature", "Auth", user_id=101)]})
    origin = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]

    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Orphaned by the removal", user_id=301, parent_id=101)],
        "removals": [origin["system_id"]],
    })
    assert resp.json()["orphan_stories"] == 1
    titles = {f["title"] for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert titles == {"Unassigned"}


# ── Re-parenting: opt-in, and never silent ────────────────────────────────────

@pytest.fixture
async def two_features(client, project):
    """Features 101 and 102; story 201 sits under 101."""
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "feature", "Payments", user_id=102),
        _row(4, "story", "Login form", user_id=201, parent_id=101),
    ]})
    features = {f["id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    return {"project_id": pid, "features": features, "pbis": pbis}


def _moved_rows():
    return [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "feature", "Payments", user_id=102),
        _row(4, "story", "Login form", user_id=201, parent_id=102),  # moved
    ]


@pytest.mark.asyncio
async def test_a_moved_parent_is_reported_but_not_applied_by_default(client, two_features):
    pid = two_features["project_id"]
    resp = await client.post(_url(pid), json={"rows": _moved_rows()})
    data = resp.json()
    assert data["stories_reparent_skipped"] == 1
    assert data["stories_reparented"] == 0

    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["parent_feature_system_id"] == two_features["features"][101]["system_id"]


@pytest.mark.asyncio
async def test_a_moved_parent_is_applied_when_asked_for(client, two_features):
    pid = two_features["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": _moved_rows(), "apply_reparenting": True,
    })
    data = resp.json()
    assert data["stories_reparented"] == 1
    assert data["stories_reparent_skipped"] == 0

    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["parent_feature_system_id"] == two_features["features"][102]["system_id"]


@pytest.mark.asyncio
async def test_an_unchanged_parent_is_not_a_move(client, two_features):
    pid = two_features["project_id"]
    resp = await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Login form", user_id=201, parent_id=101),
    ], "apply_reparenting": True})
    data = resp.json()
    assert data["stories_reparented"] == 0
    assert data["stories_reparent_skipped"] == 0


@pytest.mark.asyncio
async def test_a_story_row_with_no_parent_is_never_a_move(client, two_features):
    """An unresolvable Parent leaves an existing story where it sits, as before."""
    pid = two_features["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Login form", user_id=201)],
        "apply_reparenting": True,
    })
    data = resp.json()
    assert data["stories_reparented"] == 0
    assert data["orphan_stories"] == 1
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["parent_feature_system_id"] == two_features["features"][101]["system_id"]


@pytest.mark.asyncio
async def test_reparenting_onto_a_board_feature_carries_pi_and_swimlane(client, two_features):
    pid = two_features["project_id"]
    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    sw = (await client.post(f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "A"})).json()
    await client.patch(
        f"/api/v1/features/{two_features['features'][102]['system_id']}",
        json={"swimlane_id": sw["system_id"]},
    )

    await client.post(_url(pid), json={"rows": _moved_rows(), "apply_reparenting": True})
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["pi_id"] == pi["system_id"]
    assert pbis[201]["swimlane_id"] == sw["system_id"]


@pytest.mark.asyncio
async def test_reparenting_a_placed_story_takes_its_implicit_group(client, two_features):
    """Moving a story out of a sprint must not leave the group it was placed in."""
    pid = two_features["project_id"]
    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    sw = (await client.post(f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "A"})).json()
    await client.patch(
        f"/api/v1/features/{two_features['features'][101]['system_id']}",
        json={"swimlane_id": sw["system_id"]},
    )
    place = await client.post(
        f"/api/v1/pbis/{two_features['pbis'][201]['system_id']}/place", json={"sprint_index": 0}
    )
    assert place.status_code == 200

    await client.post(_url(pid), json={"rows": _moved_rows(), "apply_reparenting": True})
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["group_id"] is None
    assert (await client.get(f"/api/v1/swimlines/{sw['system_id']}/groups")).json() == []



@pytest.mark.asyncio
async def test_a_split_is_never_undone_by_a_re_import(client, split_feature):
    """Story 201 stayed on PI-1 and 203 carried to PI-2; the file says both are 101."""
    pid = split_feature["project_id"]
    resp = await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "S1", user_id=201, parent_id=101),
        _row(4, "story", "S3", user_id=203, parent_id=101),
    ], "apply_reparenting": True})
    data = resp.json()
    assert data["stories_reparented"] == 0
    assert data["stories_reparent_skipped"] == 0

    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[201]["parent_feature_system_id"] == split_feature["origin"]["system_id"]
    assert pbis[203]["parent_feature_system_id"] == split_feature["continuation"]["system_id"]


@pytest.mark.asyncio
async def test_moving_a_story_into_a_split_feature_targets_its_newest_pi(client, split_feature):
    pid = split_feature["project_id"]
    await client.post(_url(pid), json={"rows": [_row(2, "feature", "Other", user_id=102)]})
    other = next(
        f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json() if f["id"] == 102
    )
    await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Stray", user_id=401, parent_id=102)],
    })

    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Stray", user_id=401, parent_id=101)],
        "apply_reparenting": True,
    })
    assert resp.json()["stories_reparented"] == 1
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[401]["parent_feature_system_id"] == split_feature["continuation"]["system_id"]
    assert other["system_id"] != split_feature["continuation"]["system_id"]


# ── Type changes: promote on request, never demote ────────────────────────────

@pytest.fixture
async def story_to_promote(client, project):
    """Story 201 under feature 101, with a description and a sprint placement."""
    pid = project["system_id"]
    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()
    sw = (await client.post(f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "A"})).json()
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth", "id": 101}
    )).json()
    await client.patch(f"/api/v1/features/{feature['system_id']}", json={"swimlane_id": sw["system_id"]})
    story = (await client.post(f"/api/v1/projects/{pid}/pbis", json={
        "title": "Login form", "id": 201, "description": "Carried over",
        "parent_feature_system_id": feature["system_id"],
    })).json()
    await client.post(f"/api/v1/pbis/{story['system_id']}/place", json={"sprint_index": 0})
    return {"project_id": pid, "feature": feature, "story": story, "swimlane": sw}


@pytest.mark.asyncio
async def test_a_promotion_is_reported_but_not_applied_by_default(client, story_to_promote):
    pid = story_to_promote["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Login", user_id=201)],
    })
    data = resp.json()
    assert data["items_retype_skipped"] == 1
    assert data["items_retyped"] == 0
    assert data["created_features"] == 0

    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    assert [p["id"] for p in pbis] == [201]


@pytest.mark.asyncio
async def test_a_promotion_turns_the_story_into_a_feature_when_asked(client, story_to_promote):
    pid = story_to_promote["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Login", user_id=201)],
        "apply_type_changes": True,
    })
    data = resp.json()
    assert data["items_retyped"] == 1
    assert data["created_features"] == 1

    assert (await client.get(f"/api/v1/projects/{pid}/pbis")).json() == []
    features = {f["id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert features[201]["title"] == "Login"
    assert features[201]["location"] == "backlog"
    # The CSV has no description column — losing the story's would be silent data loss.
    assert features[201]["description"] == "Carried over"


@pytest.mark.asyncio
async def test_a_promotion_takes_the_sprint_placement_with_it(client, story_to_promote):
    pid = story_to_promote["project_id"]
    await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Login", user_id=201)],
        "apply_type_changes": True,
    })
    sw = story_to_promote["swimlane"]["system_id"]
    assert (await client.get(f"/api/v1/swimlines/{sw}/groups")).json() == []



@pytest.mark.asyncio
async def test_a_promoted_feature_can_take_children_in_the_same_file(client, story_to_promote):
    """The promoted ID is a Feature by the time story rows resolve their Parent."""
    pid = story_to_promote["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [
            _row(2, "feature", "Login", user_id=201),
            _row(3, "story", "Password field", user_id=301, parent_id=201),
        ],
        "apply_type_changes": True,
    })
    assert resp.json()["orphan_stories"] == 0

    features = {f["id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    pbis = {p["id"]: p for p in (await client.get(f"/api/v1/projects/{pid}/pbis")).json()}
    assert pbis[301]["parent_feature_system_id"] == features[201]["system_id"]


@pytest.mark.asyncio
async def test_a_promotion_takes_its_state_from_the_feature_list(client, story_to_promote):
    """Stories and Features draw from separate State Lists, so the value re-resolves."""
    pid = story_to_promote["project_id"]
    await client.post(_url(pid), json={
        "rows": [_row(2, "feature", "Login", user_id=201, state="Active")],
        "apply_type_changes": True, "has_state_column": True,
    })
    states = (await client.get(f"/api/v1/projects/{pid}/states/")).json()
    feature_states = [s for s in states if s["item_type"] == "feature"]
    assert [s["value"] for s in feature_states] == ["Active"]

    features = {f["id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert features[201]["state"] == "Active"


@pytest.mark.asyncio
async def test_a_declined_type_change_does_not_block_the_rest_of_the_file(client, story_to_promote):
    """The whole point: one retyped row used to abort the import."""
    pid = story_to_promote["project_id"]
    resp = await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Login", user_id=201),
        _row(3, "feature", "Payments", user_id=102),
        _row(4, "story", "Checkout", user_id=301, parent_id=102),
    ]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["items_retype_skipped"] == 1
    assert data["created_features"] == 1
    assert data["created_stories"] == 1


@pytest.mark.asyncio
async def test_a_demotion_never_takes_a_feature_with_children(client, story_to_promote):
    pid = story_to_promote["project_id"]
    resp = await client.post(_url(pid), json={
        "rows": [_row(2, "story", "Auth is now a story", user_id=101)],
        "apply_type_changes": True,
    })
    data = resp.json()
    assert data["items_retype_blocked"] == 1
    assert data["items_retyped"] == 0

    features = {f["id"]: f for f in (await client.get(f"/api/v1/projects/{pid}/features")).json()}
    assert features[101]["title"] == "Auth"
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    assert [p["id"] for p in pbis] == [201]


# ── What the rest of the room is told ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_import_broadcasts_exactly_one_event(client, project, captured_events):
    """Per-item events would scale with the file; the change happened all at once."""
    pid = project["system_id"]
    captured_events.clear()
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "S1", user_id=201, parent_id=101),
        _row(4, "story", "S2", user_id=202, parent_id=101),
    ]})
    assert [event for _, event, _ in captured_events] == ["import:completed"]


@pytest.mark.asyncio
async def test_the_event_names_the_actor_and_what_changed(client, project, captured_events):
    pid = project["system_id"]
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "S1", user_id=201, parent_id=101),
    ]})
    captured_events.clear()
    await client.post(_url(pid), json={"rows": [
        _row(2, "feature", "Auth renamed", user_id=101),
        _row(3, "story", "S2 new", user_id=202, parent_id=101),
    ]})
    _, _, data = captured_events[0]
    assert data["actor"] == "testuser"
    assert data["created"] == 1
    assert data["updated"] == 1
    assert data["removed"] == 0


@pytest.mark.asyncio
async def test_a_cascade_is_covered_by_the_one_event(client, split_feature, captured_events):
    """A feature removal reaches its continuations, stories and groups. Readers hold
    all of those in their own caches, so the count has to include them."""
    pid = split_feature["project_id"]
    captured_events.clear()
    await client.post(_url(pid), json={
        "rows": [], "removals": [split_feature["origin"]["system_id"]],
    })
    assert len(captured_events) == 1
    _, event, data = captured_events[0]
    assert event == "import:completed"
    # origin + continuation + both stories
    assert data["removed"] == 4
