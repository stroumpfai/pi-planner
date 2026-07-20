"""Integration tests for project, PI, and sprint tools against a mock backend."""
import base64
import json
import httpx
import pytest

from mcp_server.tools.projects import (
    create_project,
    update_project,
    export_project,
    create_snapshot,
    restore_snapshot,
    create_pi,
    update_pi,
    update_sprint,
    export_pi_csv,
    export_pi_png,
)

PROJECT_ID = "proj-uuid-1"
PI_ID = "pi-uuid-1"
SPRINT_ID = "sprint-uuid-1"
SNAPSHOT_ID = "snap-uuid-1"

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

SNAPSHOT_RESP = {
    "system_id": SNAPSHOT_ID,
    "name": "Pre-refactor",
    "created_at": "2026-06-06T00:00:00Z",
    "created_by": "alice",
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
# create_snapshot
# ---------------------------------------------------------------------------


async def test_create_snapshot(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/snapshots").mock(
        return_value=httpx.Response(201, json=SNAPSHOT_RESP)
    )
    result = await create_snapshot(project_id=PROJECT_ID, name="Pre-refactor", ctx=mock_ctx)
    assert result["system_id"] == SNAPSHOT_ID
    assert result["name"] == "Pre-refactor"
    body = _last_call_body(mock_backend, f"/projects/{PROJECT_ID}/snapshots", method="POST")
    assert body == {"name": "Pre-refactor"}


async def test_create_snapshot_does_not_acquire_lock(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/snapshots").mock(
        return_value=httpx.Response(201, json=SNAPSHOT_RESP)
    )
    await create_snapshot(project_id=PROJECT_ID, name="Pre-refactor", ctx=mock_ctx)
    lock_calls = [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]
    assert lock_calls == []


# ---------------------------------------------------------------------------
# restore_snapshot
# ---------------------------------------------------------------------------


async def test_restore_snapshot(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(
        f"/api/v1/projects/{PROJECT_ID}/snapshots/{SNAPSHOT_ID}/restore"
    ).mock(return_value=httpx.Response(200, json=PROJECT_RESP))
    result = await restore_snapshot(project_id=PROJECT_ID, snapshot_id=SNAPSHOT_ID, ctx=mock_ctx)
    assert result["system_id"] == PROJECT_ID
    restore_calls = [
        c for c in mock_backend.calls
        if f"/snapshots/{SNAPSHOT_ID}/restore" in str(c.request.url)
    ]
    assert len(restore_calls) == 1
    assert restore_calls[0].request.method == "POST"


async def test_restore_snapshot_acquires_and_releases_lock(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(
        f"/api/v1/projects/{PROJECT_ID}/snapshots/{SNAPSHOT_ID}/restore"
    ).mock(return_value=httpx.Response(200, json=PROJECT_RESP))
    await restore_snapshot(project_id=PROJECT_ID, snapshot_id=SNAPSHOT_ID, ctx=mock_ctx)
    acquire_calls = [c for c in mock_backend.calls if "edit-lock/acquire" in str(c.request.url)]
    release_calls = [c for c in mock_backend.calls if "edit-lock/release" in str(c.request.url)]
    assert len(acquire_calls) == 1
    assert len(release_calls) == 1


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


# ---------------------------------------------------------------------------
# export_pi_csv
# ---------------------------------------------------------------------------


async def test_export_pi_csv_returns_text(mock_backend, mock_ctx, patch_get_http_request):
    csv_text = "id,title,effort\n101,Auth,5\n102,Login,3\n"
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/csv").mock(
        return_value=httpx.Response(200, text=csv_text, headers={"content-type": "text/csv"})
    )
    result = await export_pi_csv(pi_id=PI_ID, ctx=mock_ctx)
    assert result["csv"] == csv_text


async def test_export_pi_csv_does_not_acquire_lock(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/csv").mock(
        return_value=httpx.Response(200, text="id,title\n", headers={"content-type": "text/csv"})
    )
    await export_pi_csv(pi_id=PI_ID, ctx=mock_ctx)
    lock_calls = [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]
    assert lock_calls == []


# ---------------------------------------------------------------------------
# export_pi_png
# ---------------------------------------------------------------------------


async def test_export_pi_png_returns_base64(mock_backend, mock_ctx, patch_get_http_request):
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"  # realistic PNG header prefix
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/png").mock(
        return_value=httpx.Response(200, content=png_bytes, headers={"content-type": "image/png"})
    )
    result = await export_pi_png(pi_id=PI_ID, ctx=mock_ctx)
    assert result["png_base64"] == base64.b64encode(png_bytes).decode()


async def test_export_pi_png_does_not_acquire_lock(mock_backend, mock_ctx, patch_get_http_request):
    png_bytes = b"\x89PNG\r\n\x1a\n"
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/png").mock(
        return_value=httpx.Response(200, content=png_bytes, headers={"content-type": "image/png"})
    )
    await export_pi_png(pi_id=PI_ID, ctx=mock_ctx)
    lock_calls = [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]
    assert lock_calls == []


async def test_export_pi_png_defaults_all_options_false(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/png").mock(
        return_value=httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
    )
    await export_pi_png(pi_id=PI_ID, ctx=mock_ctx)
    params = mock_backend.calls.last.request.url.params
    assert params["layout"] == "roadmap"
    for name in (
        "show_pi_effort",
        "show_sprint_effort",
        "show_swimlane_effort",
        "show_events",
        "swimlane_text_center",
        "show_export_date",
    ):
        assert params[name] == "false"


async def test_export_pi_png_encodes_heatmap_layout(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/png").mock(
        return_value=httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
    )
    await export_pi_png(pi_id=PI_ID, ctx=mock_ctx, layout="heatmap")
    params = mock_backend.calls.last.request.url.params
    assert params["layout"] == "heatmap"


async def test_export_pi_png_encodes_composition_layout(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/png").mock(
        return_value=httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
    )
    await export_pi_png(pi_id=PI_ID, ctx=mock_ctx, layout="composition")
    params = mock_backend.calls.last.request.url.params
    assert params["layout"] == "composition"


async def test_export_pi_png_encodes_selected_options(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/png").mock(
        return_value=httpx.Response(200, content=b"\x89PNG", headers={"content-type": "image/png"})
    )
    await export_pi_png(
        pi_id=PI_ID,
        ctx=mock_ctx,
        show_pi_effort=True,
        show_sprint_effort=True,
        show_swimlane_effort=True,
        show_events=True,
        swimlane_text_center=True,
        show_export_date=True,
    )
    params = mock_backend.calls.last.request.url.params
    assert params["show_pi_effort"] == "true"
    assert params["show_sprint_effort"] == "true"
    assert params["show_swimlane_effort"] == "true"
    assert params["show_events"] == "true"
    assert params["swimlane_text_center"] == "true"
    assert params["show_export_date"] == "true"
