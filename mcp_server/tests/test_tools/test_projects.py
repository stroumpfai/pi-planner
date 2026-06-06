"""Integration tests for project, PI, and sprint tools against a mock backend."""
import json
import httpx
import pytest

from mcp_server.tools.projects import (
    create_project,
    update_project,
    export_project,
    create_pi,
    update_pi,
    update_sprint,
)

PROJECT_ID = "proj-uuid-1"
PI_ID = "pi-uuid-1"
SPRINT_ID = "sprint-uuid-1"

PROJECT_RESP = {
    "system_id": PROJECT_ID,
    "name": "Alpha",
    "description": None,
    "effort_unit": "pts",
}

PI_RESP = {
    "system_id": PI_ID,
    "project_id": PROJECT_ID,
    "name": "PI-1",
    "description": None,
    "state": "draft",
    "start_date": None,
    "end_date": None,
}

SPRINT_RESP = {
    "system_id": SPRINT_ID,
    "pi_id": PI_ID,
    "sprint_index": 0,
    "capacity": 20,
    "start_date": None,
    "end_date": None,
}

EXPORT_RESP = {
    "version": "1.0",
    "exported_at": "2026-06-06T00:00:00Z",
    "project": {**PROJECT_RESP, "pis": []},
}


def _last_call_body(mock_backend, path_fragment: str, method: str | None = None) -> dict:
    matching = [c for c in mock_backend.calls if path_fragment in str(c.request.url)]
    if method:
        matching = [c for c in matching if c.request.method == method.upper()]
    assert matching, f"No {method or 'any'} calls matched path fragment '{path_fragment}'"
    return json.loads(matching[-1].request.content)


def _lock_mocks(mock_backend):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )


# ---------------------------------------------------------------------------
# create_project
# ---------------------------------------------------------------------------


async def test_create_project_minimal(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/").mock(
        return_value=httpx.Response(201, json=PROJECT_RESP)
    )
    result = await create_project(name="Alpha", ctx=mock_ctx)
    assert result["system_id"] == PROJECT_ID
    body = _last_call_body(mock_backend, "/projects/")
    assert body["name"] == "Alpha"
    assert body.get("description") is None


async def test_create_project_with_description(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/").mock(
        return_value=httpx.Response(201, json={**PROJECT_RESP, "description": "My project"})
    )
    result = await create_project(name="Alpha", description="My project", ctx=mock_ctx)
    assert result["description"] == "My project"
    body = _last_call_body(mock_backend, "/projects/")
    assert body["description"] == "My project"


# ---------------------------------------------------------------------------
# update_project
# ---------------------------------------------------------------------------


async def test_update_project_name_only(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/projects/{PROJECT_ID}").mock(
        return_value=httpx.Response(200, json={**PROJECT_RESP, "name": "Beta"})
    )
    result = await update_project(project_id=PROJECT_ID, name="Beta", ctx=mock_ctx)
    assert result["name"] == "Beta"
    body = _last_call_body(mock_backend, f"/projects/{PROJECT_ID}", method="PATCH")
    assert body == {"name": "Beta"}


async def test_update_project_all_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/projects/{PROJECT_ID}").mock(
        return_value=httpx.Response(200, json={**PROJECT_RESP, "name": "Beta", "description": "desc", "effort_unit": "days"})
    )
    result = await update_project(
        project_id=PROJECT_ID, name="Beta", description="desc", effort_unit="days", ctx=mock_ctx
    )
    assert result["effort_unit"] == "days"
    body = _last_call_body(mock_backend, f"/projects/{PROJECT_ID}", method="PATCH")
    assert body == {"name": "Beta", "description": "desc", "effort_unit": "days"}


async def test_update_project_omits_none_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/projects/{PROJECT_ID}").mock(
        return_value=httpx.Response(200, json=PROJECT_RESP)
    )
    await update_project(project_id=PROJECT_ID, ctx=mock_ctx)
    body = _last_call_body(mock_backend, f"/projects/{PROJECT_ID}", method="PATCH")
    assert body == {}


# ---------------------------------------------------------------------------
# export_project
# ---------------------------------------------------------------------------


async def test_export_project(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/export").mock(
        return_value=httpx.Response(200, json=EXPORT_RESP)
    )
    result = await export_project(project_id=PROJECT_ID, ctx=mock_ctx)
    assert result["version"] == "1.0"
    assert result["project"]["system_id"] == PROJECT_ID


# ---------------------------------------------------------------------------
# create_pi
# ---------------------------------------------------------------------------


async def test_create_pi_minimal(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/pis").mock(
        return_value=httpx.Response(201, json=PI_RESP)
    )
    result = await create_pi(project_id=PROJECT_ID, name="PI-1", ctx=mock_ctx)
    assert result["system_id"] == PI_ID
    body = _last_call_body(mock_backend, "/pis")
    assert body["name"] == "PI-1"
    assert body["state"] == "draft"
    assert "start_date" not in body
    assert "end_date" not in body


async def test_create_pi_with_dates_and_state(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/pis").mock(
        return_value=httpx.Response(201, json={**PI_RESP, "state": "in_progress", "start_date": "2026-01-01", "end_date": "2026-03-31"})
    )
    result = await create_pi(
        project_id=PROJECT_ID,
        name="PI-1",
        state="in_progress",
        start_date="2026-01-01",
        end_date="2026-03-31",
        ctx=mock_ctx,
    )
    assert result["state"] == "in_progress"
    body = _last_call_body(mock_backend, "/pis")
    assert body["start_date"] == "2026-01-01"
    assert body["end_date"] == "2026-03-31"


# ---------------------------------------------------------------------------
# update_pi
# ---------------------------------------------------------------------------


async def test_update_pi_state_transition(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pis/{PI_ID}").mock(
        return_value=httpx.Response(200, json={**PI_RESP, "state": "in_progress"})
    )
    result = await update_pi(pi_id=PI_ID, project_id=PROJECT_ID, state="in_progress", ctx=mock_ctx)
    assert result["state"] == "in_progress"
    body = _last_call_body(mock_backend, f"/pis/{PI_ID}")
    assert body == {"state": "in_progress"}


async def test_update_pi_omits_none_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pis/{PI_ID}").mock(
        return_value=httpx.Response(200, json=PI_RESP)
    )
    await update_pi(pi_id=PI_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    body = _last_call_body(mock_backend, f"/pis/{PI_ID}")
    assert body == {}


# ---------------------------------------------------------------------------
# update_sprint
# ---------------------------------------------------------------------------


async def test_update_sprint_capacity(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/sprints/{SPRINT_ID}").mock(
        return_value=httpx.Response(200, json=SPRINT_RESP)
    )
    result = await update_sprint(sprint_id=SPRINT_ID, project_id=PROJECT_ID, capacity=20, ctx=mock_ctx)
    assert result["capacity"] == 20
    body = _last_call_body(mock_backend, f"/sprints/{SPRINT_ID}")
    assert body == {"capacity": 20}


async def test_update_sprint_all_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/sprints/{SPRINT_ID}").mock(
        return_value=httpx.Response(200, json={**SPRINT_RESP, "start_date": "2026-01-06", "end_date": "2026-01-19"})
    )
    result = await update_sprint(
        sprint_id=SPRINT_ID,
        project_id=PROJECT_ID,
        capacity=20,
        start_date="2026-01-06",
        end_date="2026-01-19",
        ctx=mock_ctx,
    )
    assert result["start_date"] == "2026-01-06"
    body = _last_call_body(mock_backend, f"/sprints/{SPRINT_ID}")
    assert body == {"capacity": 20, "start_date": "2026-01-06", "end_date": "2026-01-19"}
