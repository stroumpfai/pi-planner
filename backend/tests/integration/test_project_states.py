"""Integration tests for project State Lists.

Covers the three independent lists (feature/story/bug), how CSV import discovers
entries, the dedupe rule, the editor (add/rename/reorder) and the guarded delete.
"""
import json

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


async def _make_state(client, pid: str, item_type: str, value: str) -> dict:
    resp = await client.post(_states_url(pid), json={"item_type": item_type, "value": value})
    assert resp.status_code == 201, resp.text
    return resp.json()


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
    done = await _make_state(client, pid, "feature", "Done")
    await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_id": done["system_id"]}
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


# ── Assigning a State to an item ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assigning_a_state_by_id(client, project):
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "In Review")
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()

    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_id": state["system_id"]}
    )
    assert resp.status_code == 200
    assert resp.json()["state"] == "In Review"


@pytest.mark.asyncio
async def test_a_state_can_be_assigned_at_creation(client, project):
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "New")

    resp = await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth", "state_id": state["system_id"]},
    )
    assert resp.status_code == 201
    assert resp.json()["state"] == "New"


@pytest.mark.asyncio
async def test_item_writes_cannot_create_vocabulary(client, project):
    """The old free-typing path: a State name on an item write is not a way in."""
    pid = project["system_id"]
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()

    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_value": "In Review"}
    )
    assert resp.status_code == 200
    assert resp.json()["state"] is None
    assert await _states(client, pid) == []


@pytest.mark.asyncio
async def test_state_can_be_cleared_with_null(client, project):
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "Done")
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth", "state_id": state["system_id"]},
    )).json()

    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}", json={"state_id": None}
    )
    assert resp.json()["state"] is None


@pytest.mark.asyncio
async def test_state_from_the_wrong_list_is_rejected(client, project):
    pid = project["system_id"]
    story_state = await _make_state(client, pid, "story", "Committed")
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
    committed = await _make_state(client, pid, "story", "Committed")
    await client.patch(
        f"/api/v1/pbis/{pbi['system_id']}", json={"state_id": committed["system_id"]}
    )

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

    active = await _make_state(client, pid, "bug", "Active")
    resp = await client.patch(
        f"/api/v1/pbis/{pbi['system_id']}",
        json={"item_type": "bug", "state_id": active["system_id"]},
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
    state = await _make_state(client, pid, "feature", "In Progress")
    await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth", "state_id": state["system_id"]},
    )

    resp = await client.delete(f"{_states_url(pid)}{state['system_id']}")
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
async def test_adding_a_duplicate_value_is_refused(client, project):
    """With an explicit Add button, silently handing back a different entry misleads."""
    pid = project["system_id"]
    await _make_state(client, pid, "feature", "Done")

    resp = await client.post(_states_url(pid), json={"item_type": "feature", "value": "DONE"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "STATE_VALUE_TAKEN"
    assert "Done" in resp.json()["detail"]["message"]
    assert len(await _states(client, pid)) == 1


@pytest.mark.asyncio
async def test_the_same_value_can_exist_in_two_lists(client, project):
    pid = project["system_id"]
    await _make_state(client, pid, "story", "New")
    await _make_state(client, pid, "bug", "New")
    assert len(await _states(client, pid)) == 2


@pytest.mark.asyncio
async def test_blank_state_cannot_be_created(client, project):
    resp = await client.post(
        _states_url(project["system_id"]), json={"item_type": "feature", "value": "   "}
    )
    assert resp.status_code == 422


# ── Rename ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rename_carries_every_item_holding_the_state(client, project):
    """The point of renaming: items reference by id, so no data migration is needed."""
    pid = project["system_id"]
    typo = await _make_state(client, pid, "feature", "In Progres")
    for title in ("Auth", "Payments"):
        await client.post(
            f"/api/v1/projects/{pid}/features",
            json={"title": title, "state_id": typo["system_id"]},
        )

    resp = await client.patch(
        f"{_states_url(pid)}{typo['system_id']}", json={"value": "In Progress"}
    )
    assert resp.status_code == 200
    assert resp.json()["value"] == "In Progress"

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert {f["state"] for f in features} == {"In Progress"}


@pytest.mark.asyncio
async def test_rename_onto_an_existing_value_is_refused(client, project):
    pid = project["system_id"]
    await _make_state(client, pid, "feature", "Done")
    other = await _make_state(client, pid, "feature", "New")

    resp = await client.patch(f"{_states_url(pid)}{other['system_id']}", json={"value": "done"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "STATE_VALUE_TAKEN"
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["Done", "New"]


@pytest.mark.asyncio
async def test_rename_can_change_only_the_casing(client, project):
    """The collision check must not trip over the entry being renamed."""
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "in progress")

    resp = await client.patch(
        f"{_states_url(pid)}{state['system_id']}", json={"value": "In Progress"}
    )
    assert resp.status_code == 200
    assert resp.json()["value"] == "In Progress"


@pytest.mark.asyncio
async def test_rename_may_reuse_a_value_from_another_list(client, project):
    pid = project["system_id"]
    await _make_state(client, pid, "story", "Committed")
    bug_state = await _make_state(client, pid, "bug", "Raised")

    resp = await client.patch(
        f"{_states_url(pid)}{bug_state['system_id']}", json={"value": "Committed"}
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_rename_of_a_state_from_another_project_is_404(client, project):
    other = (await client.post("/api/v1/projects/", json={"name": "Other Project"})).json()
    state = await _make_state(client, other["system_id"], "feature", "Done")

    resp = await client.patch(
        f"{_states_url(project['system_id'])}{state['system_id']}", json={"value": "New"}
    )
    assert resp.status_code == 404


# ── Reorder ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reorder_rewrites_one_list_without_touching_the_others(client, project):
    """CSV discovery order is arbitrary; this is what makes it fixable."""
    pid = project["system_id"]
    zulu = await _make_state(client, pid, "feature", "Zulu")
    alpha = await _make_state(client, pid, "feature", "Alpha")
    await _make_state(client, pid, "story", "First")
    await _make_state(client, pid, "story", "Second")

    resp = await client.post(
        f"{_states_url(pid)}reorder",
        json={"item_type": "feature", "order": [alpha["system_id"], zulu["system_id"]]},
    )
    assert resp.status_code == 200
    assert [s["value"] for s in resp.json()] == ["Alpha", "Zulu"]

    assert [s["value"] for s in await _states(client, pid, "feature")] == ["Alpha", "Zulu"]
    assert [s["value"] for s in await _states(client, pid, "story")] == ["First", "Second"]


@pytest.mark.asyncio
async def test_reorder_rejects_an_id_from_another_item_type(client, project):
    pid = project["system_id"]
    feature_state = await _make_state(client, pid, "feature", "New")
    story_state = await _make_state(client, pid, "story", "Committed")

    resp = await client.post(
        f"{_states_url(pid)}reorder",
        json={
            "item_type": "feature",
            "order": [story_state["system_id"], feature_state["system_id"]],
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "UNKNOWN_STATE"
    assert [s["value"] for s in await _states(client, pid, "feature")] == ["New"]


@pytest.mark.asyncio
async def test_reorder_rejects_an_id_from_another_project(client, project):
    pid = project["system_id"]
    mine = await _make_state(client, pid, "feature", "New")
    other = (await client.post("/api/v1/projects/", json={"name": "Other Project"})).json()
    theirs = await _make_state(client, other["system_id"], "feature", "Done")

    resp = await client.post(
        f"{_states_url(pid)}reorder",
        json={"item_type": "feature", "order": [theirs["system_id"], mine["system_id"]]},
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
async def test_adding_a_state_broadcasts_state_created(client, project, captured_events):
    """Other sessions must refresh their dropdowns when a State joins the list."""
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "New")

    matching = [e for e in captured_events if e[1] == "state:created"]
    assert len(matching) == 1
    assert matching[0][0] == pid
    assert matching[0][2] == {"system_id": state["system_id"]}


@pytest.mark.asyncio
async def test_rename_broadcasts_state_updated(client, project, captured_events):
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "In Progres")
    captured_events.clear()

    await client.patch(f"{_states_url(pid)}{state['system_id']}", json={"value": "In Progress"})

    matching = [e for e in captured_events if e[1] == "state:updated"]
    assert matching == [(pid, "state:updated", {"system_id": state["system_id"]})]


@pytest.mark.asyncio
async def test_reorder_broadcasts_state_reordered(client, project, captured_events):
    pid = project["system_id"]
    first = await _make_state(client, pid, "feature", "A")
    second = await _make_state(client, pid, "feature", "B")
    captured_events.clear()

    await client.post(
        f"{_states_url(pid)}reorder",
        json={"item_type": "feature", "order": [second["system_id"], first["system_id"]]},
    )

    matching = [e for e in captured_events if e[1] == "state:reordered"]
    assert matching == [(pid, "state:reordered", {"item_type": "feature"})]


# ── Export / import ───────────────────────────────────────────────────────────

def _upload(payload: dict) -> tuple[str, tuple[str, bytes, str]]:
    return ("file", ("backup.json", json.dumps(payload).encode(), "application/json"))


@pytest.mark.asyncio
async def test_export_import_round_trips_state_lists_and_assignments(client, project):
    """The export carried States all along; the import used to drop them on the floor."""
    pid = project["system_id"]
    feature_state = await _make_state(client, pid, "feature", "In Progress")
    story_state = await _make_state(client, pid, "story", "Committed")
    await _make_state(client, pid, "bug", "Active")
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth", "state_id": feature_state["system_id"]},
    )).json()
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login", "parent_feature_system_id": feature["system_id"],
              "state_id": story_state["system_id"]},
    )

    export = (await client.get(f"/api/v1/projects/{pid}/export")).json()
    resp = await client.post("/api/v1/projects/import", files=[_upload(export)])
    assert resp.status_code == 201
    new_pid = resp.json()["system_id"]

    assert [s["value"] for s in await _states(client, new_pid, "feature")] == ["In Progress"]
    assert [s["value"] for s in await _states(client, new_pid, "story")] == ["Committed"]
    assert [s["value"] for s in await _states(client, new_pid, "bug")] == ["Active"]

    imported_feature = (await client.get(f"/api/v1/projects/{new_pid}/features")).json()[0]
    imported_pbi = (await client.get(f"/api/v1/projects/{new_pid}/pbis")).json()[0]
    assert imported_feature["state"] == "In Progress"
    assert imported_pbi["state"] == "Committed"


@pytest.mark.asyncio
async def test_import_regenerates_state_ids(client, project):
    """Every id in an import is fresh, so the copy shares no rows with the original."""
    pid = project["system_id"]
    original = await _make_state(client, pid, "feature", "New")
    await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth", "state_id": original["system_id"]},
    )

    export = (await client.get(f"/api/v1/projects/{pid}/export")).json()
    new_pid = (await client.post(
        "/api/v1/projects/import", files=[_upload(export)]
    )).json()["system_id"]

    imported = (await _states(client, new_pid, "feature"))[0]
    assert imported["system_id"] != original["system_id"]
    assert imported["project_id"] == new_pid
    # And the item points at the copy, not across projects.
    imported_feature = (await client.get(f"/api/v1/projects/{new_pid}/features")).json()[0]
    assert imported_feature["state_id"] == imported["system_id"]


@pytest.mark.asyncio
async def test_import_preserves_state_list_order(client, project):
    pid = project["system_id"]
    zulu = await _make_state(client, pid, "feature", "Zulu")
    alpha = await _make_state(client, pid, "feature", "Alpha")
    await client.post(
        f"{_states_url(pid)}reorder",
        json={"item_type": "feature", "order": [alpha["system_id"], zulu["system_id"]]},
    )

    export = (await client.get(f"/api/v1/projects/{pid}/export")).json()
    new_pid = (await client.post(
        "/api/v1/projects/import", files=[_upload(export)]
    )).json()["system_id"]

    assert [s["value"] for s in await _states(client, new_pid, "feature")] == ["Alpha", "Zulu"]


@pytest.mark.asyncio
async def test_import_of_a_payload_predating_states(client, project):
    """Older export files have no "states" key; they import stateless, not broken."""
    pid = project["system_id"]
    state = await _make_state(client, pid, "feature", "New")
    await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth", "state_id": state["system_id"]},
    )
    export = (await client.get(f"/api/v1/projects/{pid}/export")).json()
    del export["project"]["states"]

    resp = await client.post("/api/v1/projects/import", files=[_upload(export)])
    assert resp.status_code == 201
    new_pid = resp.json()["system_id"]

    assert await _states(client, new_pid) == []
    imported_feature = (await client.get(f"/api/v1/projects/{new_pid}/features")).json()[0]
    assert imported_feature["state"] is None


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
