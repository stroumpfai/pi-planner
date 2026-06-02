"""Integration tests for group management tools against a mock backend."""
import json
import httpx
import pytest


def _last_call_body(mock_backend, path_fragment: str) -> dict:
    matching = [c for c in mock_backend.calls if path_fragment in str(c.request.url)]
    assert matching, f"No calls matched path fragment '{path_fragment}'"
    return json.loads(matching[-1].request.content)

from mcp_server.tools.groups import create_group, update_group, delete_group

PROJECT_ID = "proj-uuid-1"
SWIMLINE_ID = "sl-uuid-1"
FEATURE_ID = "feat-uuid-1"
GROUP_ID = "group-uuid-1"
PBI_ID_1 = "pbi-uuid-1"
PBI_ID_2 = "pbi-uuid-2"

GROUP_RESP = {
    "system_id": GROUP_ID,
    "swimline_id": SWIMLINE_ID,
    "feature_system_id": FEATURE_ID,
    "name": "Sprint 1 Stories",
    "sprint_index": 0,
    "order_index": None,
    "is_implicit": False,
    "story_system_id": None,
}


def _lock_mocks(mock_backend):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )


async def test_create_group_minimal(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/swimlines/{SWIMLINE_ID}/groups").mock(
        return_value=httpx.Response(201, json=GROUP_RESP)
    )
    result = await create_group(
        swimline_id=SWIMLINE_ID, project_id=PROJECT_ID,
        name="Sprint 1 Stories", feature_id=FEATURE_ID, ctx=mock_ctx,
    )
    assert result["system_id"] == GROUP_ID
    body = _last_call_body(mock_backend, f"/swimlines/{SWIMLINE_ID}/groups")
    assert body["name"] == "Sprint 1 Stories"
    assert body["feature_system_id"] == FEATURE_ID
    assert body["pbi_ids"] == []


async def test_create_group_with_pbis(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/swimlines/{SWIMLINE_ID}/groups").mock(
        return_value=httpx.Response(201, json={**GROUP_RESP, "sprint_index": 1})
    )
    await create_group(
        swimline_id=SWIMLINE_ID, project_id=PROJECT_ID,
        name="Sprint 1 Stories", feature_id=FEATURE_ID,
        sprint_index=1, pbi_ids=[PBI_ID_1, PBI_ID_2], ctx=mock_ctx,
    )
    body = _last_call_body(mock_backend, f"/swimlines/{SWIMLINE_ID}/groups")
    assert body["sprint_index"] == 1
    assert body["pbi_ids"] == [PBI_ID_1, PBI_ID_2]


async def test_update_group_rename(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/groups/{GROUP_ID}").mock(
        return_value=httpx.Response(200, json={**GROUP_RESP, "name": "Renamed Group"})
    )
    result = await update_group(group_id=GROUP_ID, project_id=PROJECT_ID, name="Renamed Group", ctx=mock_ctx)
    assert result["name"] == "Renamed Group"
    body = _last_call_body(mock_backend, f"/groups/{GROUP_ID}")
    assert body == {"name": "Renamed Group"}


async def test_update_group_move_sprint(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/groups/{GROUP_ID}").mock(
        return_value=httpx.Response(200, json={**GROUP_RESP, "sprint_index": 3})
    )
    result = await update_group(group_id=GROUP_ID, project_id=PROJECT_ID, sprint_index=3, ctx=mock_ctx)
    assert result["sprint_index"] == 3
    body = _last_call_body(mock_backend, f"/groups/{GROUP_ID}")
    assert body == {"sprint_index": 3}


async def test_update_group_omits_none_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/groups/{GROUP_ID}").mock(
        return_value=httpx.Response(200, json=GROUP_RESP)
    )
    await update_group(group_id=GROUP_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    body = _last_call_body(mock_backend, f"/groups/{GROUP_ID}")
    assert body == {}


async def test_delete_group_returns_empty(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.delete(f"/api/v1/groups/{GROUP_ID}").mock(
        return_value=httpx.Response(204)
    )
    result = await delete_group(group_id=GROUP_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert result == {}
