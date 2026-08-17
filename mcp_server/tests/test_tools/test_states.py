"""Tests for State resolution in the MCP write tools.

Agents pass a State by name; unknown names are rejected rather than creating vocabulary.
"""
import json
import httpx
import pytest

from mcp_server.tools.features import create_feature, create_pbi, update_feature, update_pbi
from mcp_server.tools.read import list_states

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
    assert _last_call_body(mock_backend, "/features")["state_value"] == "In Progress"


async def test_state_name_matches_case_insensitively(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    _states_mock(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(201, json=FEATURE_RESP)
    )
    await create_feature(project_id=PROJECT_ID, title="Auth", state="in progress", ctx=mock_ctx)
    assert _last_call_body(mock_backend, "/features")["state_value"] == "in progress"


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
    assert _last_call_body(mock_backend, f"/features/{FEATURE_ID}")["state_value"] is None


async def test_update_feature_leaves_state_alone_when_omitted(
    mock_backend, mock_ctx, patch_get_http_request
):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json=FEATURE_RESP)
    )
    await update_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, title="New", ctx=mock_ctx)
    assert "state_value" not in _last_call_body(mock_backend, f"/features/{FEATURE_ID}")


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
    assert _last_call_body(mock_backend, "/pbis")["state_value"] == "Active"


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
    assert _last_call_body(mock_backend, f"/pbis/{PBI_ID}")["state_value"] == "Committed"


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
    assert body["state_value"] == "Active"
    assert body["item_type"] == "bug"
