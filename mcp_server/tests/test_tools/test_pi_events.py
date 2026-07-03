"""Integration tests for PI event tools against a mock backend."""
import json
import httpx
import pytest

from mcp_server.tools.pi_events import (
    create_pi_event,
    update_pi_event,
    delete_pi_event,
)

PROJECT_ID = "proj-uuid-1"
PI_ID = "pi-uuid-1"
EVENT_ID = "event-uuid-1"

EVENT_RESP = {
    "system_id": EVENT_ID,
    "pi_id": PI_ID,
    "name": "Release v2.0",
    "event_date": "2026-06-15",
    "event_type": "release",
    "created_at": "2026-06-01T00:00:00Z",
    "modified_at": "2026-06-01T00:00:00Z",
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
# create_pi_event
# ---------------------------------------------------------------------------


async def test_create_pi_event_happy_path(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/pis/{PI_ID}/events").mock(
        return_value=httpx.Response(201, json=EVENT_RESP)
    )
    result = await create_pi_event(
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        name="Release v2.0",
        event_date="2026-06-15",
        event_type="release",
        ctx=mock_ctx,
    )
    assert result["system_id"] == EVENT_ID
    assert result["name"] == "Release v2.0"
    assert result["event_type"] == "release"
    body = _last_call_body(mock_backend, f"/pis/{PI_ID}/events", method="POST")
    assert body == {"name": "Release v2.0", "event_date": "2026-06-15", "event_type": "release"}


async def test_create_pi_event_acquires_and_releases_lock(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.post(f"/api/v1/pis/{PI_ID}/events").mock(
        return_value=httpx.Response(201, json=EVENT_RESP)
    )
    await create_pi_event(
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        name="Milestone",
        event_date="2026-07-01",
        event_type="milestone",
        ctx=mock_ctx,
    )
    acquire_calls = [c for c in mock_backend.calls if "edit-lock/acquire" in str(c.request.url)]
    release_calls = [c for c in mock_backend.calls if "edit-lock/release" in str(c.request.url)]
    assert len(acquire_calls) == 1
    assert len(release_calls) == 1


async def test_create_pi_event_other_type(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    resp = {**EVENT_RESP, "event_type": "go_no_go", "name": "Go/No-Go"}
    mock_backend.post(f"/api/v1/pis/{PI_ID}/events").mock(
        return_value=httpx.Response(201, json=resp)
    )
    result = await create_pi_event(
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        name="Go/No-Go",
        event_date="2026-06-01",
        event_type="go_no_go",
        ctx=mock_ctx,
    )
    assert result["event_type"] == "go_no_go"
    body = _last_call_body(mock_backend, f"/pis/{PI_ID}/events", method="POST")
    assert body["event_type"] == "go_no_go"


# ---------------------------------------------------------------------------
# update_pi_event
# ---------------------------------------------------------------------------


async def test_update_pi_event_name_only(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    updated = {**EVENT_RESP, "name": "Release v2.1"}
    mock_backend.patch(f"/api/v1/pis/{PI_ID}/events/{EVENT_ID}").mock(
        return_value=httpx.Response(200, json=updated)
    )
    result = await update_pi_event(
        event_id=EVENT_ID,
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        name="Release v2.1",
        ctx=mock_ctx,
    )
    assert result["name"] == "Release v2.1"
    body = _last_call_body(mock_backend, f"/events/{EVENT_ID}", method="PATCH")
    assert body == {"name": "Release v2.1"}


async def test_update_pi_event_date_and_type(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    updated = {**EVENT_RESP, "event_date": "2026-07-01", "event_type": "deadline"}
    mock_backend.patch(f"/api/v1/pis/{PI_ID}/events/{EVENT_ID}").mock(
        return_value=httpx.Response(200, json=updated)
    )
    result = await update_pi_event(
        event_id=EVENT_ID,
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        event_date="2026-07-01",
        event_type="deadline",
        ctx=mock_ctx,
    )
    assert result["event_date"] == "2026-07-01"
    assert result["event_type"] == "deadline"
    body = _last_call_body(mock_backend, f"/events/{EVENT_ID}", method="PATCH")
    assert body == {"event_date": "2026-07-01", "event_type": "deadline"}


async def test_update_pi_event_omits_none_fields(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pis/{PI_ID}/events/{EVENT_ID}").mock(
        return_value=httpx.Response(200, json=EVENT_RESP)
    )
    await update_pi_event(
        event_id=EVENT_ID,
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        ctx=mock_ctx,
    )
    body = _last_call_body(mock_backend, f"/events/{EVENT_ID}", method="PATCH")
    assert body == {}


async def test_update_pi_event_acquires_lock(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.patch(f"/api/v1/pis/{PI_ID}/events/{EVENT_ID}").mock(
        return_value=httpx.Response(200, json=EVENT_RESP)
    )
    await update_pi_event(
        event_id=EVENT_ID,
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        name="Updated",
        ctx=mock_ctx,
    )
    acquire_calls = [c for c in mock_backend.calls if "edit-lock/acquire" in str(c.request.url)]
    assert len(acquire_calls) == 1


# ---------------------------------------------------------------------------
# delete_pi_event
# ---------------------------------------------------------------------------


async def test_delete_pi_event_happy_path(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.delete(f"/api/v1/pis/{PI_ID}/events/{EVENT_ID}").mock(
        return_value=httpx.Response(200, json={})
    )
    result = await delete_pi_event(
        event_id=EVENT_ID,
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        ctx=mock_ctx,
    )
    assert result == {}
    delete_calls = [
        c for c in mock_backend.calls
        if f"/events/{EVENT_ID}" in str(c.request.url) and c.request.method == "DELETE"
    ]
    assert len(delete_calls) == 1


async def test_delete_pi_event_acquires_and_releases_lock(mock_backend, mock_ctx, patch_get_http_request):
    _lock_mocks(mock_backend)
    mock_backend.delete(f"/api/v1/pis/{PI_ID}/events/{EVENT_ID}").mock(
        return_value=httpx.Response(200, json={})
    )
    await delete_pi_event(
        event_id=EVENT_ID,
        pi_id=PI_ID,
        project_id=PROJECT_ID,
        ctx=mock_ctx,
    )
    acquire_calls = [c for c in mock_backend.calls if "edit-lock/acquire" in str(c.request.url)]
    release_calls = [c for c in mock_backend.calls if "edit-lock/release" in str(c.request.url)]
    assert len(acquire_calls) == 1
    assert len(release_calls) == 1
