"""Integration tests for read tools against a mock backend."""
import httpx
import pytest

from mcp_server.tools.read import (
    list_projects,
    get_project,
    list_pis,
    get_pi,
    list_sprints,
    list_swimlines,
    list_features,
    get_feature,
    list_pbis,
    list_groups,
    get_edit_lock_status,
)


PROJECT_ID = "proj-uuid-1"
PI_ID = "pi-uuid-1"
SWIMLINE_ID = "sl-uuid-1"
FEATURE_ID = "feat-uuid-1"


async def test_list_projects_returns_data(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get("/api/v1/projects/").mock(
        return_value=httpx.Response(200, json=[{"system_id": PROJECT_ID, "name": "Alpha"}])
    )
    result = await list_projects(ctx=mock_ctx)
    assert result["items"][0]["system_id"] == PROJECT_ID


async def test_get_project_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}").mock(
        return_value=httpx.Response(200, json={"system_id": PROJECT_ID, "name": "Alpha"})
    )
    result = await get_project(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["name"] == "Alpha"


async def test_list_pis_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pis").mock(
        return_value=httpx.Response(200, json=[{"system_id": PI_ID}])
    )
    result = await list_pis(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["items"][0]["system_id"] == PI_ID


async def test_get_pi_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}").mock(
        return_value=httpx.Response(200, json={"system_id": PI_ID, "state": "draft"})
    )
    result = await get_pi(pi_id=PI_ID, ctx=mock_ctx)
    assert result["state"] == "draft"


async def test_list_sprints_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/sprints").mock(
        return_value=httpx.Response(200, json=[{"sprint_index": 0}])
    )
    result = await list_sprints(pi_id=PI_ID, ctx=mock_ctx)
    assert result["items"][0]["sprint_index"] == 0


async def test_list_swimlines_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/swimlines").mock(
        return_value=httpx.Response(200, json=[{"system_id": SWIMLINE_ID}])
    )
    result = await list_swimlines(pi_id=PI_ID, ctx=mock_ctx)
    assert result["items"][0]["system_id"] == SWIMLINE_ID


async def test_list_features_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(200, json=[{"system_id": FEATURE_ID}])
    )
    result = await list_features(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["items"][0]["system_id"] == FEATURE_ID


async def test_get_feature_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/features/{FEATURE_ID}").mock(
        return_value=httpx.Response(200, json={"system_id": FEATURE_ID, "title": "Auth"})
    )
    result = await get_feature(feature_id=FEATURE_ID, ctx=mock_ctx)
    assert result["title"] == "Auth"


async def test_list_pbis_without_filter(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(200, json=[])
    )
    result = await list_pbis(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result == {"items": []}


async def test_list_pbis_with_feature_filter(mock_backend, mock_ctx, patch_get_http_request):
    route = mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(200, json=[{"feature_id": FEATURE_ID}])
    )
    result = await list_pbis(project_id=PROJECT_ID, feature_id=FEATURE_ID, ctx=mock_ctx)
    assert result["items"][0]["feature_id"] == FEATURE_ID
    # Verify query param was sent
    assert "feature_id" in str(route.calls.last.request.url)


async def test_list_groups_calls_correct_path(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/swimlines/{SWIMLINE_ID}/groups").mock(
        return_value=httpx.Response(200, json=[])
    )
    result = await list_groups(swimline_id=SWIMLINE_ID, ctx=mock_ctx)
    assert result == {"items": []}


async def test_get_edit_lock_status_no_lock(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/edit-lock").mock(
        return_value=httpx.Response(200, json={"is_locked": False})
    )
    result = await get_edit_lock_status(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["is_locked"] is False


async def test_get_edit_lock_status_locked(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/edit-lock").mock(
        return_value=httpx.Response(
            200,
            json={
                "is_locked": True,
                "locked_by_username": "alice",
                "expires_at": "2026-06-01T12:00:00Z",
            },
        )
    )
    result = await get_edit_lock_status(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["is_locked"] is True
    assert result["locked_by_username"] == "alice"
