"""Integration tests for swimline tools against a mock backend."""
import json
import httpx
import pytest


def _last_call_body(mock_backend, path_fragment: str) -> dict:
    matching = [c for c in mock_backend.calls if path_fragment in str(c.request.url)]
    assert matching, f"No calls matched path fragment '{path_fragment}'"
    return json.loads(matching[-1].request.content)

from mcp_server.tools.swimlines import (
    create_swimline,
    update_swimline,
    delete_swimline,
    reorder_swimlines,
)

PROJECT_ID = "proj-uuid-1"
PI_ID = "pi-uuid-1"
SWIMLINE_ID = "sl-uuid-1"
SWIMLINE_ID_2 = "sl-uuid-2"

SWIMLINE_RESP = {
    "system_id": SWIMLINE_ID,
    "pi_id": PI_ID,
    "name": "Team Alpha",
    "order_index": 0,
    "effort": 0,
    "capacity": 100,
}


async def test_create_swimline_posts_correct_body(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"/api/v1/pis/{PI_ID}/swimlines").mock(
        return_value=httpx.Response(201, json=SWIMLINE_RESP)
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    result = await create_swimline(pi_id=PI_ID, project_id=PROJECT_ID, name="Team Alpha", ctx=mock_ctx)
    assert result["name"] == "Team Alpha"
    assert result["system_id"] == SWIMLINE_ID


async def test_create_swimline_with_order_index(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"/api/v1/pis/{PI_ID}/swimlines").mock(
        return_value=httpx.Response(201, json={**SWIMLINE_RESP, "order_index": 2})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    result = await create_swimline(pi_id=PI_ID, project_id=PROJECT_ID, name="Team Alpha", order_index=2, ctx=mock_ctx)
    assert result["order_index"] == 2
    body = _last_call_body(mock_backend, f"/pis/{PI_ID}/swimlines")
    assert body["order_index"] == 2


async def test_update_swimline_sends_partial_body(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.patch(f"/api/v1/swimlines/{SWIMLINE_ID}").mock(
        return_value=httpx.Response(200, json={**SWIMLINE_RESP, "name": "Team Beta"})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    result = await update_swimline(swimline_id=SWIMLINE_ID, project_id=PROJECT_ID, name="Team Beta", ctx=mock_ctx)
    assert result["name"] == "Team Beta"
    body = _last_call_body(mock_backend, f"/swimlines/{SWIMLINE_ID}")
    assert body == {"name": "Team Beta"}


async def test_update_swimline_omits_none_fields(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.patch(f"/api/v1/swimlines/{SWIMLINE_ID}").mock(
        return_value=httpx.Response(200, json=SWIMLINE_RESP)
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    await update_swimline(swimline_id=SWIMLINE_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    body = _last_call_body(mock_backend, f"/swimlines/{SWIMLINE_ID}")
    assert body == {}


async def test_delete_swimline_returns_empty(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.delete(f"/api/v1/swimlines/{SWIMLINE_ID}").mock(
        return_value=httpx.Response(204)
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    result = await delete_swimline(swimline_id=SWIMLINE_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert result == {}


async def test_reorder_swimlines_sends_order_list(mock_backend, mock_ctx, patch_get_http_request):
    order = [SWIMLINE_ID_2, SWIMLINE_ID]
    mock_backend.post(f"/api/v1/swimlines/{SWIMLINE_ID}/reorder").mock(
        return_value=httpx.Response(200, json=[
            {**SWIMLINE_RESP, "system_id": SWIMLINE_ID_2, "order_index": 0},
            {**SWIMLINE_RESP, "order_index": 1},
        ])
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    result = await reorder_swimlines(swimline_id=SWIMLINE_ID, project_id=PROJECT_ID, order=order, ctx=mock_ctx)
    body = _last_call_body(mock_backend, "/reorder")
    assert body["order"] == order
    assert result["items"][0]["system_id"] == SWIMLINE_ID_2
