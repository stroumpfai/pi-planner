"""Integration tests for project State Lists.

Covers the three independent lists (feature/story/bug), how CSV import discovers
entries, the dedupe rule, and the guarded delete.
"""
import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "State Project"})).json()


def _import_url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/import/csv"


def _states_url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/states/"


def _row(row_number: int, item_type: str, title: str, **kwargs):
    return {"row_number": row_number, "item_type": item_type, "title": title, **kwargs}


async def _states(client, pid: str, item_type: str | None = None) -> list[dict]:
    all_states = (await client.get(_states_url(pid))).json()
    if item_type is None:
        return all_states
    return [s for s in all_states if s["item_type"] == item_type]


# ── Empty before the first import ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_new_project_has_no_states(client, project):
    resp = await client.get(_states_url(project["system_id"]))
    assert resp.status_code == 200
    assert resp.json() == []


# ── Discovery during import ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_discovers_states_per_item_type(client, project):
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "Auth", user_id=101, state="In Progress"),
        _row(2, "story", "Login", user_id=201, parent_id=101, state="Committed"),
        _row(3, "bug", "Crash", user_id=202, parent_id=101, state="Active"),
    ]
    resp = await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})
    assert resp.status_code == 200
    assert resp.json()["created_states"] == 3

    assert [s["value"] for s in await _states(client, pid, "feature")] == ["In Progress"]
    assert [s["value"] for s in await _states(client, pid, "story")] == ["Committed"]
    assert [s["value"] for s in await _states(client, pid, "bug")] == ["Active"]


@pytest.mark.asyncio
async def test_story_and_bug_lists_are_independent(client, project):
    """The same word in both files produces an entry in each list, not one shared entry."""
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "Auth", user_id=101, state="New"),
        _row(2, "story", "Login", user_id=201, parent_id=101, state="New"),
        _row(3, "bug", "Crash", user_id=202, parent_id=101, state="New"),
    ]
    await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})

    all_states = await _states(client, pid)
    assert len(all_states) == 3
    assert {s["item_type"] for s in all_states} == {"feature", "story", "bug"}


@pytest.mark.asyncio
async def test_import_assigns_state_to_items(client, project):
    pid = project["system_id"]
    rows = [_row(1, "feature", "Auth", user_id=101, state="In Progress")]
    await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})

    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    assert feature["state"] == "In Progress"
    assert feature["state_id"] is not None


@pytest.mark.asyncio
async def test_states_dedupe_case_insensitively_keeping_first_spelling(client, project):
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "Auth", user_id=101, state="Done"),
        _row(2, "feature", "Payments", user_id=102, state="done"),
        _row(3, "feature", "Search", user_id=103, state="  DONE  "),
    ]
    resp = await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})
    assert resp.json()["created_states"] == 1
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["Done"]


@pytest.mark.asyncio
async def test_states_are_appended_in_discovery_order(client, project):
    pid = project["system_id"]
    rows = [
        _row(1, "feature", "A", user_id=101, state="Zulu"),
        _row(2, "feature", "B", user_id=102, state="Alpha"),
    ]
    await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["Zulu", "Alpha"]


# ── Blank cells and absent columns ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_blank_state_cell_is_not_a_list_entry(client, project):
    pid = project["system_id"]
    rows = [_row(1, "feature", "Auth", user_id=101, state="")]
    resp = await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})
    assert resp.json()["created_states"] == 0
    assert await _states(client, pid) == []

    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    assert feature["state"] is None


@pytest.mark.asyncio
async def test_blank_state_cell_clears_an_existing_state(client, project):
    pid = project["system_id"]
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="Done")],
              "has_state_column": True},
    )
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="")],
              "has_state_column": True},
    )

    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    assert feature["state"] is None
    # The entry stays in the list — lists never shrink on their own.
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["Done"]


@pytest.mark.asyncio
async def test_file_without_state_column_leaves_state_untouched(client, project):
    """The failure this guards: one State-less file wiping every State in the project."""
    pid = project["system_id"]
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="Done")],
              "has_state_column": True},
    )
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101)], "has_state_column": False},
    )

    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    assert feature["state"] == "Done"


@pytest.mark.asyncio
async def test_reimport_overwrites_a_manually_set_state(client, project):
    pid = project["system_id"]
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="New")],
              "has_state_column": True},
    )
    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_value": "Done"}
    )

    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="New")],
              "has_state_column": True},
    )
    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    assert feature["state"] == "New"


# ── Removed ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_removed_rows_do_not_enter_the_state_list(client, project):
    """Removed rows are deleted by the client before import, so nothing registers."""
    pid = project["system_id"]
    rows = [_row(1, "feature", "Auth", user_id=101, state="New")]
    await client.post(_import_url(pid), json={"rows": rows, "has_state_column": True})

    values = [s["value"] for s in await _states(client, pid, "feature")]
    assert "Removed" not in values


# ── Manual entry from the item modals ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_typing_a_state_creates_a_list_entry(client, project):
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()

    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_value": "In Review"}
    )
    assert resp.status_code == 200
    assert resp.json()["state"] == "In Review"
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["In Review"]


@pytest.mark.asyncio
async def test_typed_state_matches_existing_entry_case_insensitively(client, project):
    pid = project["system_id"]
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="Done")],
              "has_state_column": True},
    )
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()

    await client.patch(f"/api/v1/features/{features[0]['system_id']}", json={"state_value": "done"})
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["Done"]


@pytest.mark.asyncio
async def test_state_can_be_cleared_with_null(client, project):
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    await client.patch(f"/api/v1/features/{feature['system_id']}", json={"state_value": "Done"})

    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_id": None}
    )
    assert resp.json()["state"] is None


@pytest.mark.asyncio
async def test_state_from_the_wrong_list_is_rejected(client, project):
    pid = project["system_id"]
    story_state = (await client.post(
        _states_url(pid), json={"item_type": "story", "value": "Committed"}
    )).json()
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()

    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_id": story_state["system_id"]}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "UNKNOWN_STATE"


# ── Item type changes ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_switching_story_to_bug_clears_the_state(client, project):
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login", "parent_feature_system_id": feature["system_id"]},
    )).json()
    await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"state_value": "Committed"})

    resp = await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"item_type": "bug"})
    assert resp.status_code == 200
    assert resp.json()["state"] is None
    # The story list keeps its entry; the bug list is untouched.
    assert [s["value"] for s in await _states(client, pid, "story")] == ["Committed"]
    assert await _states(client, pid, "bug") == []


@pytest.mark.asyncio
async def test_type_change_with_explicit_state_uses_the_new_list(client, project):
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login", "parent_feature_system_id": feature["system_id"]},
    )).json()

    resp = await client.patch(
        f"/api/v1/pbis/{pbi['system_id']}", json={"item_type": "bug", "state_value": "Active"}
    )
    assert resp.json()["state"] == "Active"
    assert [s["value"] for s in await _states(client, pid, "bug")] == ["Active"]


# ── Guarded delete ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_unused_state(client, project):
    pid = project["system_id"]
    state = (await client.post(
        _states_url(pid), json={"item_type": "feature", "value": "Obsolete"}
    )).json()

    resp = await client.delete(f"{_states_url(pid)}{state['system_id']}")
    assert resp.status_code == 204
    assert await _states(client, pid) == []


@pytest.mark.asyncio
async def test_delete_state_in_use_is_refused(client, project):
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    updated = (await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_value": "In Progress"}
    )).json()

    resp = await client.delete(f"{_states_url(pid)}{updated['state_id']}")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "STATE_IN_USE"
    assert resp.json()["detail"]["details"] == {"features": 1, "pbis": 0}


@pytest.mark.asyncio
async def test_delete_state_from_another_project_is_404(client, project):
    other = (await client.post("/api/v1/projects/", json={"name": "Other Project"})).json()
    state = (await client.post(
        _states_url(other["system_id"]), json={"item_type": "feature", "value": "Done"}
    )).json()

    resp = await client.delete(f"{_states_url(project['system_id'])}{state['system_id']}")
    assert resp.status_code == 404


# ── Creating entries directly ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_state_is_idempotent_on_an_existing_value(client, project):
    pid = project["system_id"]
    first = (await client.post(
        _states_url(pid), json={"item_type": "feature", "value": "Done"}
    )).json()
    second = (await client.post(
        _states_url(pid), json={"item_type": "feature", "value": "DONE"}
    )).json()

    assert first["system_id"] == second["system_id"]
    assert len(await _states(client, pid)) == 1


@pytest.mark.asyncio
async def test_blank_state_cannot_be_created(client, project):
    resp = await client.post(
        _states_url(project["system_id"]), json={"item_type": "feature", "value": "   "}
    )
    assert resp.status_code == 422


# ── SSE ───────────────────────────────────────────────────────────────────────

@pytest.fixture
def captured_events(monkeypatch):
    events: list[tuple[str, str, dict]] = []

    async def fake_broadcast(project_id, event_type, data):
        events.append((project_id, event_type, data))

    from app.services.events import broadcaster
    monkeypatch.setattr(broadcaster, "broadcast", fake_broadcast)
    return events


@pytest.mark.asyncio
async def test_typing_a_state_broadcasts_state_created(client, project, captured_events):
    """Other sessions must refresh their dropdowns when a State joins the list."""
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()

    await client.patch(f"/api/v1/features/{feature['system_id']}", json={"state_value": "New"})

    matching = [e for e in captured_events if e[1] == "state:created"]
    assert len(matching) == 1
    assert matching[0][0] == pid
    assert matching[0][2] == {"item_type": "feature"}


@pytest.mark.asyncio
async def test_reusing_an_existing_state_does_not_broadcast(client, project, captured_events):
    pid = project["system_id"]
    await client.post(_states_url(pid), json={"item_type": "feature", "value": "New"})
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    captured_events.clear()

    await client.patch(f"/api/v1/features/{feature['system_id']}", json={"state_value": "new"})

    assert [e for e in captured_events if e[1] == "state:created"] == []


@pytest.mark.asyncio
async def test_pbi_state_broadcast_names_the_right_list(client, project, captured_events):
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()
    pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Crash", "parent_feature_system_id": feature["system_id"],
              "item_type": "bug"},
    )).json()
    captured_events.clear()

    await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"state_value": "Active"})

    matching = [e for e in captured_events if e[1] == "state:created"]
    assert len(matching) == 1
    assert matching[0][2] == {"item_type": "bug"}


# ── Snapshots ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_snapshot_restores_state_lists_and_assignments(client, project):
    pid = project["system_id"]
    await client.post(
        _import_url(pid),
        json={"rows": [_row(1, "feature", "Auth", user_id=101, state="In Progress")],
              "has_state_column": True},
    )
    snapshot = (await client.post(
        f"/api/v1/projects/{pid}/snapshots/", json={"name": "With States"}
    )).json()

    # Mutate: clear the assignment and add an unrelated entry.
    feature = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    await client.patch(f"/api/v1/features/{feature['system_id']}", json={"state_id": None})
    await client.post(_states_url(pid), json={"item_type": "feature", "value": "Scrapped"})

    resp = await client.post(
        f"/api/v1/projects/{pid}/snapshots/{snapshot['system_id']}/restore"
    )
    assert resp.status_code == 200

    assert [s["value"] for s in await _states(client, pid, "feature")] == ["In Progress"]
    restored = (await client.get(f"/api/v1/projects/{pid}/features")).json()[0]
    assert restored["state"] == "In Progress"
