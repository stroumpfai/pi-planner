"""Integration tests for compound workflow tools against a mock backend."""
import json
import httpx
import pytest

from mcp_server.tools.workflows import (
    bulk_create_features,
    bulk_create_pbis,
    plan_pi_backlog,
    set_sprint_capacities,
    propose_pbi_sprint_plan,
    apply_pbi_sprint_plan,
    summarize_project,
)

PROJECT_ID = "proj-uuid-1"
PI_ID = "pi-uuid-1"
SWIMLINE_ID = "sl-uuid-1"
FEATURE_ID_1 = "feat-uuid-1"
FEATURE_ID_2 = "feat-uuid-2"
PBI_ID_1 = "00000000-0000-0000-0000-000000000001"
PBI_ID_2 = "00000000-0000-0000-0000-000000000002"

SPRINT_LIST = [
    {"system_id": f"sprint-{i}", "sprint_index": i, "capacity": 50, "effort": 0}
    for i in range(5)
]

FEATURE_RESP_1 = {
    "system_id": FEATURE_ID_1, "id": None, "title": "Feature 1", "description": None,
    "effort": 0, "location": "backlog", "pi_id": None, "swimlane_id": None, "project_id": PROJECT_ID,
}
FEATURE_RESP_2 = {
    "system_id": FEATURE_ID_2, "id": None, "title": "Feature 2", "description": None,
    "effort": 0, "location": "backlog", "pi_id": None, "swimlane_id": None, "project_id": PROJECT_ID,
}
PBI_RESP_1 = {
    "system_id": PBI_ID_1, "id": None, "parent_feature_system_id": FEATURE_ID_1,
    "title": "PBI 1", "description": None, "effort": 20, "item_type": "story",
    "location": "pi", "pi_id": PI_ID, "swimlane_id": SWIMLINE_ID, "group_id": None, "project_id": PROJECT_ID,
}
PBI_RESP_2 = {
    "system_id": PBI_ID_2, "id": None, "parent_feature_system_id": FEATURE_ID_1,
    "title": "PBI 2", "description": None, "effort": 15, "item_type": "story",
    "location": "pi", "pi_id": PI_ID, "swimlane_id": SWIMLINE_ID, "group_id": None, "project_id": PROJECT_ID,
}
GROUP_RESP = {
    "system_id": "group-uuid-1", "swimline_id": SWIMLINE_ID,
    "feature_system_id": FEATURE_ID_1, "name": "PBI 1",
    "sprint_index": 0, "order_index": None, "is_implicit": True, "story_system_id": PBI_ID_1,
}


def _lock_mocks(mock_backend):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )


async def test_bulk_create_features_creates_all(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        side_effect=[
            httpx.Response(201, json=FEATURE_RESP_1),
            httpx.Response(201, json=FEATURE_RESP_2),
        ]
    )
    from mcp_server.tools.workflows import FeatureInput
    features = [FeatureInput(title="Feature 1"), FeatureInput(title="Feature 2")]
    result = await bulk_create_features(project_id=PROJECT_ID, features=features, ctx=mock_ctx)
    assert result["count"] == 2
    assert len(result["created"]) == 2


async def test_bulk_create_features_holds_single_lock(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        side_effect=[
            httpx.Response(201, json=FEATURE_RESP_1),
            httpx.Response(201, json=FEATURE_RESP_2),
        ]
    )
    from mcp_server.tools.workflows import FeatureInput
    features = [FeatureInput(title="Feature 1"), FeatureInput(title="Feature 2")]
    await bulk_create_features(project_id=PROJECT_ID, features=features, ctx=mock_ctx)
    acquire_calls = [
        c for c in mock_backend.calls
        if "edit-lock/acquire" in str(c.request.url)
    ]
    release_calls = [
        c for c in mock_backend.calls
        if "edit-lock/release" in str(c.request.url)
    ]
    assert len(acquire_calls) == 1
    assert len(release_calls) == 1


async def test_bulk_create_pbis(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        side_effect=[
            httpx.Response(201, json=PBI_RESP_1),
            httpx.Response(201, json=PBI_RESP_2),
        ]
    )
    from mcp_server.tools.workflows import PBIInput
    pbis = [PBIInput(title="PBI 1", effort=20), PBIInput(title="PBI 2", effort=15)]
    result = await bulk_create_pbis(project_id=PROJECT_ID, feature_id=FEATURE_ID_1, pbis=pbis, ctx=mock_ctx)
    assert result["count"] == 2
    assert result["created"][0]["system_id"] == PBI_ID_1


async def test_plan_pi_backlog_moves_features(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID_1}").mock(
        return_value=httpx.Response(200, json={**FEATURE_RESP_1, "location": "pi", "swimlane_id": SWIMLINE_ID})
    )
    mock_backend.patch(f"/api/v1/features/{FEATURE_ID_2}").mock(
        return_value=httpx.Response(200, json={**FEATURE_RESP_2, "location": "pi", "swimlane_id": SWIMLINE_ID})
    )
    result = await plan_pi_backlog(
        project_id=PROJECT_ID, swimline_id=SWIMLINE_ID,
        feature_ids=[FEATURE_ID_1, FEATURE_ID_2], ctx=mock_ctx,
    )
    assert result["count"] == 2
    assert result["moved"][0]["location"] == "pi"


async def test_set_sprint_capacities_updates_all_five(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.get(f"/api/v1/pis/{PI_ID}/sprints").mock(
        return_value=httpx.Response(200, json=SPRINT_LIST)
    )
    for i in range(5):
        mock_backend.patch(f"/api/v1/sprints/sprint-{i}").mock(
            return_value=httpx.Response(200, json={**SPRINT_LIST[i], "capacity": 40 + i})
        )
    result = await set_sprint_capacities(
        project_id=PROJECT_ID, pi_id=PI_ID, capacities=[40, 41, 42, 43, 44], ctx=mock_ctx
    )
    assert len(result["sprints"]) == 5
    patch_calls = [c for c in mock_backend.calls if c.request.method == "PATCH"]
    assert len(patch_calls) == 5


async def test_propose_pbi_sprint_plan_no_writes(mock_backend, mock_ctx, patch_get_http_request):
    """propose_pbi_sprint_plan must make no writes — no lock acquired, no POST/PATCH/DELETE."""
    mock_backend.get(f"/api/v1/pis/{PI_ID}/sprints").mock(
        return_value=httpx.Response(200, json=SPRINT_LIST)
    )
    pi_features = [{**FEATURE_RESP_1, "pi_id": PI_ID, "location": "pi"}]
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(200, json=pi_features)
    )
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(200, json=[PBI_RESP_1, PBI_RESP_2])
    )
    result = await propose_pbi_sprint_plan(project_id=PROJECT_ID, pi_id=PI_ID, ctx=mock_ctx)
    assert "assignments" in result
    assert "sprint_summary" in result

    # Verify no writes were made
    write_calls = [
        c for c in mock_backend.calls
        if c.request.method in ("POST", "PATCH", "DELETE")
    ]
    assert write_calls == [], f"Expected no write calls but got: {write_calls}"


async def test_propose_pbi_sprint_plan_assigns_by_effort(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/sprints").mock(
        return_value=httpx.Response(200, json=SPRINT_LIST)  # 50 capacity each
    )
    pi_features = [{**FEATURE_RESP_1, "pi_id": PI_ID, "location": "pi"}]
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(200, json=pi_features)
    )
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(200, json=[PBI_RESP_1, PBI_RESP_2])  # efforts 20 and 15
    )
    result = await propose_pbi_sprint_plan(project_id=PROJECT_ID, pi_id=PI_ID, ctx=mock_ctx)
    assert len(result["assignments"]) == 2
    assert result["unassigned"] == []


async def test_apply_pbi_sprint_plan(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/pbis/{PBI_ID_1}/place").mock(
        return_value=httpx.Response(200, json={"story": PBI_RESP_1, "group": GROUP_RESP})
    )
    mock_backend.post(f"/api/v1/pbis/{PBI_ID_2}/place").mock(
        return_value=httpx.Response(200, json={"story": PBI_RESP_2, "group": {**GROUP_RESP, "sprint_index": 1}})
    )
    from mcp_server.tools.workflows import SprintAssignment
    assignments = [
        SprintAssignment(pbi_id=PBI_ID_1, sprint_index=0),
        SprintAssignment(pbi_id=PBI_ID_2, sprint_index=1),
    ]
    result = await apply_pbi_sprint_plan(project_id=PROJECT_ID, assignments=assignments, ctx=mock_ctx)
    assert result["placed"] == 2
    assert result["errors"] == []


async def test_apply_pbi_sprint_plan_partial_failure(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/pbis/{PBI_ID_1}/place").mock(
        return_value=httpx.Response(200, json={"story": PBI_RESP_1, "group": GROUP_RESP})
    )
    mock_backend.post(f"/api/v1/pbis/{PBI_ID_2}/place").mock(
        return_value=httpx.Response(409, json={"detail": {"error": "STORY_ALREADY_GROUPED", "message": "Already in a group"}})
    )
    from mcp_server.tools.workflows import SprintAssignment
    assignments = [
        SprintAssignment(pbi_id=PBI_ID_1, sprint_index=0),
        SprintAssignment(pbi_id=PBI_ID_2, sprint_index=1),
    ]
    result = await apply_pbi_sprint_plan(project_id=PROJECT_ID, assignments=assignments, ctx=mock_ctx)
    assert result["placed"] == 1
    assert len(result["errors"]) == 1
    assert result["errors"][0]["pbi_id"] == PBI_ID_2


async def test_summarize_project_read_only(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}").mock(
        return_value=httpx.Response(200, json={"system_id": PROJECT_ID, "name": "ISK", "effort_unit": "sp"})
    )
    active_pi = {"system_id": PI_ID, "name": "PI 5", "state": "in_progress", "start_date": "2026-09-13"}
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pis").mock(
        return_value=httpx.Response(200, json=[active_pi])
    )
    mock_backend.get(f"/api/v1/pis/{PI_ID}/sprints").mock(
        return_value=httpx.Response(200, json=SPRINT_LIST)
    )
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/features").mock(
        return_value=httpx.Response(200, json=[FEATURE_RESP_1, FEATURE_RESP_2])
    )
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/pbis").mock(
        return_value=httpx.Response(200, json=[PBI_RESP_1])
    )
    result = await summarize_project(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["project"]["name"] == "ISK"
    assert result["active_pi"]["name"] == "PI 5"
    assert len(result["sprints"]) == 5
    assert result["features"]["total"] == 2
    assert result["pbis"]["total"] == 1

    write_calls = [
        c for c in mock_backend.calls
        if c.request.method in ("POST", "PATCH", "DELETE")
    ]
    assert write_calls == []
