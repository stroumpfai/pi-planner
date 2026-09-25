"""Tests for the State List write tools and State resolution in the item write tools.

Agents pass a State by name on item writes; unknown names are rejected there rather
than creating vocabulary. Extending a list is a deliberate act with its own tool.
"""
import json
from datetime import date

import httpx
import pytest

from mcp_server.backend import MCPBackendError
from mcp_server.tools.features import create_feature, create_pbi, update_feature, update_pbi
from mcp_server.tools.read import list_states
from mcp_server.tools.states import (
    create_state,
    delete_state,
    rename_state,
    reorder_states,
    set_state_category,
)

PROJECT_ID = "proj-uuid-1"
FEATURE_ID = "feat-uuid-1"
PBI_ID = "pbi-uuid-1"

FEATURE_STATES = [
    {"system_id": "st-1", "project_id": PROJECT_ID, "item_type": "feature",
     "value": "In Progress", "position": 0, "category": None,
     "created_at": "2026-01-01T00:00:00Z"},
    {"system_id": "st-2", "project_id": PROJECT_ID, "item_type": "story",
     "value": "Committed", "position": 0, "category": None,
     "created_at": "2026-01-01T00:00:00Z"},
    {"system_id": "st-3", "project_id": PROJECT_ID, "item_type": "bug",
     "value": "Active", "position": 0, "category": None,
     "created_at": "2026-01-01T00:00:00Z"},
]

FEATURE_RESP = {
    "system_id": FEATURE_ID, "id": None, "title": "Auth", "description": None,
    "effort": 0, "location": "backlog", "pi_id": None, "swimlane_id": None,
    "project_id": PROJECT_ID,
}

PBI_RESP = {
    "system_id": PBI_ID, "id": None, "parent_feature_system_id": FEATURE_ID,
    "title": "Login", "description": None, "effort": None, "item_type": "story",
    "location": "backlog", "pi_id": None, "swimlane_id": None, "group_id": None,
    "project_id": PROJECT_ID,
}


def _last_call_body(mock_backend, path_fragment: str) -> dict:
    matching = [c for c in mock_backend.calls if path_fragment in str(c.request.url)]
    assert matching, f"No calls matched path fragment '{path_fragment}'"
    return json.loads(matching[-1].request.content)


def _lock_mocks(mock_backend):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )


def _states_mock(mock_backend, states=None):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/states/").mock(
        return_value=httpx.Response(200, json=FEATURE_STATES if states is None else states)
    )


async def test_list_states(mock_backend, mock_ctx, patch_get_http_request):
    _states_mock(mock_backend)
    result = await list_states(project_id=PROJECT_ID, ctx=mock_ctx)
    assert [s["value"] for s in result["items"]] == ["In Progress", "Committed", "Active"]


async def test_create_feature_with_known_state(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(201, json=FEATURE_RESP)
    )
    await create_feature(project_id=PROJECT_ID, title="Auth", state="In Progress", ctx=mock_ctx)
    assert _last_call_body(mock_backend, "/features")["state_id"] == "st-1"


async def test_state_name_matches_case_insensitively(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(201, json=FEATURE_RESP)
    )
    await create_feature(project_id=PROJECT_ID, title="Auth", state="in progress", ctx=mock_ctx)
    assert _last_call_body(mock_backend, "/features")["state_id"] == "st-1"


async def test_unknown_state_is_rejected_with_valid_values(
    mock_backend, mock_ctx, patch_get_http_request
):
    _states_mock(mock_backend)
    with pytest.raises(ValueError, match="No State named 'Shipped'"):
        await create_feature(project_id=PROJECT_ID, title="Auth", state="Shipped", ctx=mock_ctx)


async def test_rejection_lists_the_available_states(mock_backend, mock_ctx, patch_get_http_request):
    _states_mock(mock_backend)
    with pytest.raises(ValueError, match="'In Progress'"):
        await create_feature(project_id=PROJECT_ID, title="Auth", state="Shipped", ctx=mock_ctx)


async def test_rejection_when_the_list_is_empty(mock_backend, mock_ctx, patch_get_http_request):
    _states_mock(mock_backend, states=[])
    with pytest.raises(ValueError, match="the list is empty"):
        await create_feature(project_id=PROJECT_ID, title="Auth", state="Anything", ctx=mock_ctx)


async def test_feature_state_cannot_come_from_the_story_list(
    mock_backend, mock_ctx, patch_get_http_request
):
    """'Committed' exists, but only in the story list."""
    _states_mock(mock_backend)
    with pytest.raises(ValueError, match="No State named 'Committed'"):
        await create_feature(project_id=PROJECT_ID, title="Auth", state="Committed", ctx=mock_ctx)


async def test_update_feature_clears_state_with_null(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json=FEATURE_RESP)
    )
    await update_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, state=None, ctx=mock_ctx)
    assert _last_call_body(mock_backend, f"/features/{FEATURE_ID}")["state_id"] is None


async def test_update_feature_leaves_state_alone_when_omitted(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json=FEATURE_RESP)
    )
    await update_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, title="New", ctx=mock_ctx)
    assert "state_id" not in _last_call_body(mock_backend, f"/features/{FEATURE_ID}")


async def test_create_bug_uses_the_bug_state_list(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(201, json={**PBI_RESP, "item_type": "bug"})
    )
    await create_pbi(
        project_id=PROJECT_ID, feature_id=FEATURE_ID, title="Crash",
        item_type="bug", state="Active", ctx=mock_ctx,
    )
    assert _last_call_body(mock_backend, "/pbis")["state_id"] == "st-3"


async def test_bug_cannot_take_a_story_state(mock_backend, mock_ctx, patch_get_http_request):
    _states_mock(mock_backend)
    with pytest.raises(ValueError, match="No State named 'Committed'"):
        await create_pbi(
            project_id=PROJECT_ID, feature_id=FEATURE_ID, title="Crash",
            item_type="bug", state="Committed", ctx=mock_ctx,
        )


async def test_update_pbi_resolves_against_the_current_type(
    mock_backend, mock_ctx, patch_get_http_request
):
    """With no item_type in the call, the PBI is fetched to learn which list applies."""
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.get(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(200, json=PBI_RESP)
    )
    mock_backend.patch(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(200, json=PBI_RESP)
    )
    await update_pbi(pbi_id=PBI_ID, project_id=PROJECT_ID, state="Committed", ctx=mock_ctx)
    assert _last_call_body(mock_backend, f"/pbis/{PBI_ID}")["state_id"] == "st-2"


async def test_update_pbi_resolves_against_the_new_type(
    mock_backend, mock_ctx, patch_get_http_request
):
    """When item_type changes in the same call, the new list applies — no fetch needed."""
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.patch(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(200, json={**PBI_RESP, "item_type": "bug"})
    )
    await update_pbi(
        pbi_id=PBI_ID, project_id=PROJECT_ID, item_type="bug", state="Active", ctx=mock_ctx,
    )
    body = _last_call_body(mock_backend, f"/pbis/{PBI_ID}")
    assert body["state_id"] == "st-3"
    assert body["item_type"] == "bug"


# ── The State List write tools ───────────────────────────────────────────────

STATES_PATH = f"/api/v1/projects/{PROJECT_ID}/states/"


async def test_create_state_posts_to_the_states_endpoint(
    mock_backend, mock_ctx, patch_get_http_request
):
    """The one path by which an agent may extend the vocabulary."""
    _lock_mocks(mock_backend)
    mock_backend.post(STATES_PATH).mock(
        return_value=httpx.Response(201, json={**FEATURE_STATES[0], "value": "Shipped"})
    )
    result = await create_state(
        project_id=PROJECT_ID, item_type="feature", value="Shipped", ctx=mock_ctx
    )
    assert result["value"] == "Shipped"
    assert _last_call_body(mock_backend, "/states/") == {
        "item_type": "feature",
        "value": "Shipped",
    }


async def test_create_state_accepts_a_name_update_feature_would_reject(
    mock_backend, mock_ctx, patch_get_http_request
):
    """The asymmetry is deliberate: on an item write a new name is a typo, here it is intent."""
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    with pytest.raises(ValueError, match="No State named 'Shipped'"):
        await update_feature(
            feature_id=FEATURE_ID, project_id=PROJECT_ID, state="Shipped", ctx=mock_ctx
        )

    mock_backend.post(STATES_PATH).mock(
        return_value=httpx.Response(201, json={**FEATURE_STATES[0], "value": "Shipped"})
    )
    result = await create_state(
        project_id=PROJECT_ID, item_type="feature", value="Shipped", ctx=mock_ctx
    )
    assert result["value"] == "Shipped"


async def test_rename_state_patches_the_entry(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"{STATES_PATH}st-1").mock(
        return_value=httpx.Response(200, json={**FEATURE_STATES[0], "value": "In Progress"})
    )
    await rename_state(
        project_id=PROJECT_ID, state_id="st-1", value="In Progress", ctx=mock_ctx
    )
    assert _last_call_body(mock_backend, "/states/st-1") == {"value": "In Progress"}


async def test_reorder_states_names_the_list_it_reorders(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    mock_backend.post(f"{STATES_PATH}reorder").mock(
        return_value=httpx.Response(200, json=[FEATURE_STATES[0]])
    )
    await reorder_states(
        project_id=PROJECT_ID, item_type="story", order=["st-2", "st-1"], ctx=mock_ctx
    )
    assert _last_call_body(mock_backend, "/states/reorder") == {
        "item_type": "story",
        "order": ["st-2", "st-1"],
    }


async def test_delete_state_deletes_the_entry(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    route = mock_backend.delete(f"{STATES_PATH}st-1").mock(
        return_value=httpx.Response(204)
    )
    await delete_state(project_id=PROJECT_ID, state_id="st-1", ctx=mock_ctx)
    assert route.called


async def test_state_writes_take_the_edit_lock(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(STATES_PATH).mock(
        return_value=httpx.Response(201, json=FEATURE_STATES[0])
    )
    await create_state(project_id=PROJECT_ID, item_type="feature", value="New", ctx=mock_ctx)

    paths = [str(c.request.url) for c in mock_backend.calls]
    assert any("edit-lock/acquire" in p for p in paths)
    assert any("edit-lock/release" in p for p in paths)


# ── Categories and completion dates ──────────────────────────────────────────


async def test_create_state_passes_category(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(STATES_PATH).mock(
        return_value=httpx.Response(201, json={**FEATURE_STATES[1], "category": "done"})
    )
    await create_state(
        project_id=PROJECT_ID, item_type="story", value="Closed", category="done", ctx=mock_ctx
    )
    assert _last_call_body(mock_backend, "/states/") == {
        "item_type": "story",
        "value": "Closed",
        "category": "done",
    }


async def test_set_state_category_resolves_by_name_and_sends_only_category(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    route = mock_backend.patch(f"{STATES_PATH}st-2").mock(
        return_value=httpx.Response(200, json={**FEATURE_STATES[1], "category": "done"})
    )
    result = await set_state_category(
        project_id=PROJECT_ID, item_type="story", state="committed", category="done",
        ctx=mock_ctx,
    )
    assert route.called
    assert result["category"] == "done"
    assert _last_call_body(mock_backend, "/states/st-2") == {"category": "done"}


async def test_set_state_category_clears_with_none(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.patch(f"{STATES_PATH}st-3").mock(
        return_value=httpx.Response(200, json=FEATURE_STATES[2])
    )
    await set_state_category(
        project_id=PROJECT_ID, item_type="bug", state="Active", category=None, ctx=mock_ctx,
    )
    assert _last_call_body(mock_backend, "/states/st-3") == {"category": None}


async def test_set_state_category_rejects_unknown_names_without_patching(
    mock_backend, mock_ctx, patch_get_http_request
):
    """'Committed' exists, but in the story list — the bug list does not have it.

    Resolution fails before the edit lock is taken, so nothing but the list read happens.
    """
    _states_mock(mock_backend)
    with pytest.raises(ValueError, match="No State named 'Committed'.*'Active'"):
        await set_state_category(
            project_id=PROJECT_ID, item_type="bug", state="Committed", category="done",
            ctx=mock_ctx,
        )
    assert [c.request.method for c in mock_backend.calls] == ["GET"]


async def test_set_state_category_rejects_a_blank_name(
    mock_backend, mock_ctx, patch_get_http_request
):
    """On item writes a blank name means "no State"; here there is nothing to categorise."""
    with pytest.raises(ValueError, match="State name is required"):
        await set_state_category(
            project_id=PROJECT_ID, item_type="story", state="  ", category="done", ctx=mock_ctx,
        )
    assert not mock_backend.calls


async def test_set_state_category_takes_the_edit_lock(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.patch(f"{STATES_PATH}st-1").mock(
        return_value=httpx.Response(200, json=FEATURE_STATES[0])
    )
    await set_state_category(
        project_id=PROJECT_ID, item_type="feature", state="In Progress",
        category="in_progress", ctx=mock_ctx,
    )
    paths = [str(c.request.url) for c in mock_backend.calls]
    assert any("edit-lock/acquire" in p for p in paths)
    assert any("edit-lock/release" in p for p in paths)


async def test_update_pbi_passes_completed_on(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(200, json={**PBI_RESP, "completed_on": "2026-09-01"})
    )
    await update_pbi(
        pbi_id=PBI_ID, project_id=PROJECT_ID, completed_on=date(2026, 9, 1), ctx=mock_ctx,
    )
    assert _last_call_body(mock_backend, f"/pbis/{PBI_ID}") == {"completed_on": "2026-09-01"}


async def test_update_pbi_omits_completed_on_when_not_given(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(200, json=PBI_RESP)
    )
    await update_pbi(pbi_id=PBI_ID, project_id=PROJECT_ID, title="New", ctx=mock_ctx)
    assert "completed_on" not in _last_call_body(mock_backend, f"/pbis/{PBI_ID}")


async def test_update_pbi_completed_on_on_a_non_done_item_is_a_typed_error(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(422, json={"detail": {
            "error": "NOT_COMPLETED",
            "message": "completed_on is only accepted while the item is in a done State.",
        }})
    )
    completed_on = date(2026, 9, 1)
    with pytest.raises(MCPBackendError) as exc:
        await update_pbi(
            pbi_id=PBI_ID, project_id=PROJECT_ID, completed_on=completed_on, ctx=mock_ctx,
        )
    assert exc.value.status == 422
    assert exc.value.code == "VALIDATION_ERROR"
    assert "NOT_COMPLETED" in exc.value.message
