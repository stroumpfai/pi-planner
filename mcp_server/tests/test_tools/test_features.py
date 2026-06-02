"""Integration tests for feature and PBI tools against a mock backend."""
import json
import httpx
import pytest


def _last_call_body(mock_backend, path_fragment: str) -> dict:
    """Return the parsed JSON body of the most recent call matching the path fragment."""
    matching = [c for c in mock_backend.calls if path_fragment in str(c.request.url)]
    assert matching, f"No calls matched path fragment '{path_fragment}'"
    return json.loads(matching[-1].request.content)

from mcp_server.tools.features import (
    create_feature,
    update_feature,
    move_feature,
    delete_feature,
    create_pbi,
    update_pbi,
    place_pbi_in_sprint,
    remove_pbi_from_sprint,
)

PROJECT_ID = "proj-uuid-1"
FEATURE_ID = "feat-uuid-1"
PBI_ID = "pbi-uuid-1"
SWIMLINE_ID = "sl-uuid-1"

FEATURE_RESP = {
    "system_id": FEATURE_ID,
    "id": None,
    "title": "Auth service",
    "description": None,
    "effort": 0,
    "location": "backlog",
    "pi_id": None,
    "swimlane_id": None,
    "project_id": PROJECT_ID,
}

PBI_RESP = {
    "system_id": PBI_ID,
    "id": None,
    "parent_feature_system_id": FEATURE_ID,
    "title": "Login flow",
    "description": None,
    "effort": 5,
    "item_type": "story",
    "location": "backlog",
    "pi_id": None,
    "swimlane_id": None,
    "group_id": None,
    "project_id": PROJECT_ID,
}

GROUP_RESP = {
    "system_id": "group-uuid-1",
    "swimline_id": SWIMLINE_ID,
    "feature_system_id": FEATURE_ID,
    "name": "Login flow",
    "sprint_index": 0,
    "order_index": None,
    "is_implicit": True,
    "story_system_id": PBI_ID,
}


def _lock_mocks(mock_backend):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )


async def test_create_feature_minimal(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(201, json=FEATURE_RESP)
    )
    result = await create_feature(project_id=PROJECT_ID, title="Auth service", ctx=mock_ctx)
    assert result["system_id"] == FEATURE_ID
    body = _last_call_body(mock_backend, "/features")
    assert body["title"] == "Auth service"
    assert "id" not in body


async def test_create_feature_with_user_id(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(201, json={**FEATURE_RESP, "id": 101})
    )
    result = await create_feature(project_id=PROJECT_ID, title="Auth service", user_id=101, ctx=mock_ctx)
    assert result["id"] == 101
    body = _last_call_body(mock_backend, "/features")
    assert body["id"] == 101


async def test_update_feature_partial(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json={**FEATURE_RESP, "title": "Updated title"})
    )
    result = await update_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, title="Updated title", ctx=mock_ctx)
    assert result["title"] == "Updated title"
    body = _last_call_body(mock_backend, f"/features/{FEATURE_ID}")
    assert body == {"title": "Updated title"}


async def test_update_feature_omits_none_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json=FEATURE_RESP)
    )
    await update_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    body = _last_call_body(mock_backend, f"/features/{FEATURE_ID}")
    assert body == {}


async def test_move_feature_to_swimlane(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json={**FEATURE_RESP, "location": "pi", "swimlane_id": SWIMLINE_ID})
    )
    result = await move_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, swimlane_id=SWIMLINE_ID, ctx=mock_ctx)
    assert result["location"] == "pi"
    body = _last_call_body(mock_backend, f"/features/{FEATURE_ID}")
    assert body == {"swimlane_id": SWIMLINE_ID}


async def test_move_feature_to_backlog(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json=FEATURE_RESP)
    )
    await move_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, location="backlog", ctx=mock_ctx)
    body = _last_call_body(mock_backend, f"/features/{FEATURE_ID}")
    assert body == {"location": "backlog"}


async def test_delete_feature_returns_empty(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.delete(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(204)
    )
    result = await delete_feature(feature_id=FEATURE_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert result == {}


async def test_create_pbi_under_feature(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(201, json=PBI_RESP)
    )
    result = await create_pbi(
        project_id=PROJECT_ID, feature_id=FEATURE_ID, title="Login flow", effort=5, ctx=mock_ctx
    )
    assert result["system_id"] == PBI_ID
    body = _last_call_body(mock_backend, "/pbis")
    assert body["parent_feature_system_id"] == FEATURE_ID
    assert body["effort"] == 5
    assert body["item_type"] == "story"


async def test_create_pbi_bug_type(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(201, json={**PBI_RESP, "item_type": "bug"})
    )
    result = await create_pbi(
        project_id=PROJECT_ID, feature_id=FEATURE_ID, title="Fix crash", item_type="bug", ctx=mock_ctx
    )
    assert result["item_type"] == "bug"
    body = _last_call_body(mock_backend, "/pbis")
    assert body["item_type"] == "bug"


async def test_update_pbi_partial(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pbis/{PBI_ID}").mock(
        return_value=httpx.Response(200, json={**PBI_RESP, "effort": 8})
    )
    result = await update_pbi(pbi_id=PBI_ID, project_id=PROJECT_ID, effort=8, ctx=mock_ctx)
    assert result["effort"] == 8
    body = _last_call_body(mock_backend, f"/pbis/{PBI_ID}")
    assert body == {"effort": 8}


async def test_place_pbi_in_sprint(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/pbis/{PBI_ID}/place").mock(
        return_value=httpx.Response(200, json={"story": PBI_RESP, "group": GROUP_RESP})
    )
    result = await place_pbi_in_sprint(pbi_id=PBI_ID, project_id=PROJECT_ID, sprint_index=0, ctx=mock_ctx)
    assert result["group"]["sprint_index"] == 0
    body = _last_call_body(mock_backend, f"/pbis/{PBI_ID}/place")
    assert body == {"sprint_index": 0}


async def test_remove_pbi_from_sprint(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.delete(f"/api/v1/pbis/{PBI_ID}/place").mock(
        return_value=httpx.Response(204)
    )
    result = await remove_pbi_from_sprint(pbi_id=PBI_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert result == {}
