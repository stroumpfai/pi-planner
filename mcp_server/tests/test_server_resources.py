"""Tests for MCP resources exposed directly on the root server (server.py)."""

import httpx

from mcp_server.server import pi_dashboard, snapshot_diff

PI_ID = "pi-uuid-1"
PROJECT_ID = "proj-uuid-1"
_DASH_HTML = "<!doctype html><html><body>dashboard</body></html>"
_DIFF_HTML = "<!doctype html><html><body>diff</body></html>"


async def test_pi_dashboard_resource_returns_html(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/pis/{PI_ID}/export/html").mock(
        return_value=httpx.Response(200, text=_DASH_HTML, headers={"content-type": "text/html"})
    )
    html = await pi_dashboard(pi_id=PI_ID, ctx=mock_ctx)
    assert html == _DASH_HTML
    # Resource renders a static snapshot — no auto-refresh script requested.
    assert mock_backend.calls.last.request.url.params["refresh_seconds"] == "0"


async def test_snapshot_diff_resource_returns_html(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/projects/{PROJECT_ID}/snapshots/diff/html").mock(
        return_value=httpx.Response(200, text=_DIFF_HTML, headers={"content-type": "text/html"})
    )
    html = await snapshot_diff(project_id=PROJECT_ID, ctx=mock_ctx)
    assert html == _DIFF_HTML
    # Static snapshot — no auto-refresh, latest snapshot / whole project.
    assert mock_backend.calls.last.request.url.params["refresh_seconds"] == "0"
