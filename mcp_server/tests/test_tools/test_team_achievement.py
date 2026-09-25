"""Tests for get_team_achievement, the read tool over the Achievement grid
(spec/team-achievement.md §5.3, §8.3)."""
from datetime import date

import httpx
import pytest
from pydantic import ValidationError

from mcp_server.tools.read import get_team_achievement, read_mcp

TEAM_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8"
PROJECT_ID = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9"

ACHIEVEMENT = {
    "team_id": TEAM_ID,
    "anchor_project_id": PROJECT_ID,
    "sprints": [
        {"label": "Q3-2026.1", "start_date": "2026-06-30", "end_date": "2026-07-10"},
        {"label": "Q3-2026.2", "start_date": None, "end_date": None},
    ],
    "projects": [
        {
            "project_id": PROJECT_ID,
            "name": "Alpha",
            "effort_unit": "pts",
            "share_pct": 70,
            "available_source": "factor",
            "units_per_pd": 1.5,
            "in_pd_total": True,
            "committed": [24.0, None],
            "achieved": [21.0, None],
            "pd_given": [16.8, None],
            "velocity": [1.25, None],
            "achieved_items": [[], []],
            "outside_calendar_points": 3.0,
            "done_undated_count": 4,
            "item_types_without_done_state": ["bug"],
        }
    ],
    "team": {"achieved_pd": [14.0, None], "available_pd": [24.0, None], "realised": [0.583, None]},
}


def _achievement_mock(mock_backend):
    return mock_backend.get(f"/api/v1/teams/{TEAM_ID}/achievement").mock(
        return_value=httpx.Response(200, json=ACHIEVEMENT)
    )


async def test_get_team_achievement_returns_the_payload(mock_backend, mock_ctx, patch_get_http_request):
    _achievement_mock(mock_backend)
    result = await get_team_achievement(team_id=TEAM_ID, ctx=mock_ctx)

    assert result == ACHIEVEMENT
    # Nulls pass through as nulls: unknown is not zero (§5.5).
    assert result["projects"][0]["achieved"][1] is None
    # A read: one GET, no edit lock, no window unless asked for.
    assert [c.request.method for c in mock_backend.calls] == ["GET"]
    assert not mock_backend.calls[-1].request.url.params


async def test_get_team_achievement_passes_the_window_through(
    mock_backend, mock_ctx, patch_get_http_request
):
    route = _achievement_mock(mock_backend)
    await get_team_achievement(
        team_id=TEAM_ID, date_from=date(2026, 7, 1), date_to=date(2026, 9, 30), ctx=mock_ctx
    )
    assert route.called
    request = mock_backend.calls[-1].request
    assert request.url.path == f"/api/v1/teams/{TEAM_ID}/achievement"
    assert (request.url.params["from"], request.url.params["to"]) == ("2026-07-01", "2026-09-30")


async def test_get_team_achievement_rejects_a_malformed_team_id(
    mock_backend, mock_ctx, patch_get_http_request
):
    # Through the MCP layer, where agents call it: the schema refuses the id
    # before anything reaches the backend.
    with pytest.raises(ValidationError, match="team_id"):
        await read_mcp.call_tool("get_team_achievement", {"team_id": "../projects"})
    assert not mock_backend.calls
