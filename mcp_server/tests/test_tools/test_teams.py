"""Tests for the team read and write tools (spec/teams.md §8.2).

Three properties here are the point of the module, and each is asserted directly:
no team tool acquires the edit lock (§4.1), `update_team` reads the row and quotes
the ETag that read returned in `If-Match` (§4.2), and there is no `delete_team`
(§8.2.6).
"""
import json

import httpx
import pytest

from mcp_server.backend import MCPBackendError
from mcp_server.tools.read import get_team, list_teams
from mcp_server.tools.teams import create_team, teams_mcp, update_team

TEAM_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8"
ETAG = '"2026-08-30T09:15:00.123456+00:00"'
NEW_ETAG = '"2026-08-30T09:20:00.654321+00:00"'

TEAM = {
    "system_id": TEAM_ID,
    "name": "Platform",
    "description": None,
    "normal_day_hours": 8.0,
    "member_count": 3,
    "project_ids": ["proj-1"],
    "created_at": "2026-08-01T00:00:00Z",
    "modified_at": "2026-08-30T09:15:00.123456Z",
}


def _get_team_mock(mock_backend, etag=ETAG, team=None):
    return mock_backend.get(f"/api/v1/teams/{TEAM_ID}").mock(
        return_value=httpx.Response(200, json=team or TEAM, headers={"ETag": etag} if etag else {})
    )


def _stale_response() -> httpx.Response:
    return httpx.Response(
        412,
        json={
            "detail": {
                "error": "STALE",
                "message": "This row changed since you read it.",
                "current": TEAM,
            }
        },
    )


def _last_call_body(mock_backend, method: str) -> dict:
    matching = [c for c in mock_backend.calls if c.request.method == method]
    assert matching, f"No {method} calls were made"
    return json.loads(matching[-1].request.content)


def _assert_no_lock_calls(mock_backend) -> None:
    """Team writes are outside the single-writer lock (§4.1) — nothing acquires it."""
    lock_calls = [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]
    assert not lock_calls, f"A team tool touched the edit lock: {[str(c.request.url) for c in lock_calls]}"


# --- read tools ------------------------------------------------------------


async def test_list_teams_returns_what_the_backend_gave(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get("/api/v1/teams").mock(return_value=httpx.Response(200, json=[TEAM]))
    result = await list_teams(ctx=mock_ctx)
    # call_backend wraps list payloads as {"items": [...]} to keep returns dict-only.
    assert result["items"] == [TEAM]
    _assert_no_lock_calls(mock_backend)


async def test_get_team_returns_what_the_backend_gave(mock_backend, mock_ctx, patch_get_http_request):
    _get_team_mock(mock_backend)
    result = await get_team(team_id=TEAM_ID, ctx=mock_ctx)
    assert result["name"] == "Platform"
    assert result["member_count"] == 3
    _assert_no_lock_calls(mock_backend)


# --- create_team -----------------------------------------------------------


async def test_create_team_posts_the_name(mock_backend, mock_ctx, patch_get_http_request):
    route = mock_backend.post("/api/v1/teams").mock(return_value=httpx.Response(201, json=TEAM))
    result = await create_team(name="Platform", ctx=mock_ctx)
    assert route.called
    assert _last_call_body(mock_backend, "POST") == {"name": "Platform"}
    assert result["system_id"] == TEAM_ID


async def test_create_team_sends_the_optional_fields_when_given(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.post("/api/v1/teams").mock(return_value=httpx.Response(201, json=TEAM))
    await create_team(
        name="Platform", description="Runs the platform", normal_day_hours=7.5, ctx=mock_ctx
    )
    assert _last_call_body(mock_backend, "POST") == {
        "name": "Platform",
        "description": "Runs the platform",
        "normal_day_hours": 7.5,
    }


async def test_create_team_omits_unset_fields_so_the_backend_default_applies(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.post("/api/v1/teams").mock(return_value=httpx.Response(201, json=TEAM))
    await create_team(name="Platform", ctx=mock_ctx)
    assert "normal_day_hours" not in _last_call_body(mock_backend, "POST")


async def test_create_team_takes_no_lock_and_no_if_match(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.post("/api/v1/teams").mock(return_value=httpx.Response(201, json=TEAM))
    await create_team(name="Platform", ctx=mock_ctx)
    _assert_no_lock_calls(mock_backend)
    # A create cannot clobber, so it carries no precondition (§4.2).
    assert "If-Match" not in mock_backend.calls[-1].request.headers


async def test_create_team_surfaces_a_taken_name(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/teams").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {"error": "TEAM_NAME_TAKEN", "message": "A team named 'Platform' already exists"}},
        )
    )
    with pytest.raises(MCPBackendError) as exc:
        await create_team(name="Platform", ctx=mock_ctx)
    assert exc.value.code == "CONFLICT"
    assert "already exists" in exc.value.message


async def test_create_team_surfaces_the_instance_limit(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/teams").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {"error": "TEAM_LIMIT_REACHED", "message": "An instance holds at most 50 teams."}},
        )
    )
    with pytest.raises(MCPBackendError) as exc:
        await create_team(name="Platform", ctx=mock_ctx)
    assert exc.value.code == "CONFLICT"
    assert "50 teams" in exc.value.message


# --- update_team -----------------------------------------------------------


async def test_update_team_reads_first_and_quotes_that_etag(
    mock_backend, mock_ctx, patch_get_http_request
):
    read = _get_team_mock(mock_backend)
    patch = mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(
        return_value=httpx.Response(200, json={**TEAM, "name": "Platform Core"})
    )
    result = await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)

    assert read.called, "update_team must read the row before writing it"
    assert patch.called
    assert [c.request.method for c in mock_backend.calls] == ["GET", "PATCH"]
    assert patch.calls[-1].request.headers["If-Match"] == ETAG
    assert result["name"] == "Platform Core"


async def test_update_team_uses_the_response_header_not_modified_at(
    mock_backend, mock_ctx, patch_get_http_request
):
    """The ETag is whatever the read returned — never rebuilt from the payload."""
    _get_team_mock(mock_backend, etag='"an-opaque-backend-tag"')
    patch = mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(
        return_value=httpx.Response(200, json=TEAM)
    )
    await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)
    assert patch.calls[-1].request.headers["If-Match"] == '"an-opaque-backend-tag"'


async def test_update_team_sends_only_the_supplied_fields(
    mock_backend, mock_ctx, patch_get_http_request
):
    _get_team_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(return_value=httpx.Response(200, json=TEAM))
    await update_team(team_id=TEAM_ID, normal_day_hours=7.5, ctx=mock_ctx)
    assert _last_call_body(mock_backend, "PATCH") == {"normal_day_hours": 7.5}


async def test_update_team_sends_a_new_description(mock_backend, mock_ctx, patch_get_http_request):
    _get_team_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(return_value=httpx.Response(200, json=TEAM))
    await update_team(team_id=TEAM_ID, description="Runs the platform", ctx=mock_ctx)
    assert _last_call_body(mock_backend, "PATCH") == {"description": "Runs the platform"}


async def test_update_team_takes_no_lock(mock_backend, mock_ctx, patch_get_http_request):
    _get_team_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(return_value=httpx.Response(200, json=TEAM))
    await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)
    _assert_no_lock_calls(mock_backend)


async def test_update_team_retries_once_from_a_fresh_read_on_stale(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.get(f"/api/v1/teams/{TEAM_ID}").mock(
        side_effect=[
            httpx.Response(200, json=TEAM, headers={"ETag": ETAG}),
            httpx.Response(200, json=TEAM, headers={"ETag": NEW_ETAG}),
        ]
    )
    patch = mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(
        side_effect=[_stale_response(), httpx.Response(200, json=TEAM)]
    )
    result = await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)

    assert [c.request.headers["If-Match"] for c in patch.calls] == [ETAG, NEW_ETAG]
    assert result["system_id"] == TEAM_ID


async def test_update_team_surfaces_a_second_stale_rather_than_looping(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.get(f"/api/v1/teams/{TEAM_ID}").mock(
        side_effect=[
            httpx.Response(200, json=TEAM, headers={"ETag": ETAG}),
            httpx.Response(200, json=TEAM, headers={"ETag": NEW_ETAG}),
        ]
    )
    patch = mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(
        side_effect=[_stale_response(), _stale_response()]
    )
    with pytest.raises(MCPBackendError) as exc:
        await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)

    assert exc.value.status == 412
    assert exc.value.code == "STALE"
    assert "Re-read it and reapply" in exc.value.message
    assert len(patch.calls) == 2, "a second STALE must be returned, not retried again"


async def test_update_team_surfaces_a_missing_if_match_as_its_own_code(
    mock_backend, mock_ctx, patch_get_http_request
):
    """The backend answers a PATCH with no If-Match with 428, not 412."""
    _get_team_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(
        return_value=httpx.Response(
            428,
            json={"detail": {"error": "IF_MATCH_REQUIRED", "message": "This write must carry If-Match."}},
        )
    )
    with pytest.raises(MCPBackendError) as exc:
        await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)
    assert exc.value.code == "IF_MATCH_REQUIRED"


async def test_update_team_refuses_to_write_when_the_read_carried_no_etag(
    mock_backend, mock_ctx, patch_get_http_request
):
    _get_team_mock(mock_backend, etag=None)
    with pytest.raises(MCPBackendError) as exc:
        await update_team(team_id=TEAM_ID, name="Platform Core", ctx=mock_ctx)
    assert exc.value.code == "IF_MATCH_REQUIRED"
    # No blind write when the ETag is unknown — the read is the only call made.
    assert [c.request.method for c in mock_backend.calls] == ["GET"]


async def test_update_team_surfaces_a_taken_name(mock_backend, mock_ctx, patch_get_http_request):
    _get_team_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {"error": "TEAM_NAME_TAKEN", "message": "A team named 'Ops' already exists"}},
        )
    )
    with pytest.raises(MCPBackendError) as exc:
        await update_team(team_id=TEAM_ID, name="Ops", ctx=mock_ctx)
    assert exc.value.code == "CONFLICT"


# --- what the module deliberately does not expose --------------------------


async def test_there_is_no_delete_team_tool():
    """Containers are not deletable by agents (§8.2.6) — as with projects and PIs."""
    names = {t.name for t in await teams_mcp.list_tools()}
    assert names == {"create_team", "update_team"}


async def test_update_team_has_no_delete_parameter():
    tools = {t.name: t for t in await teams_mcp.list_tools()}
    assert "delete" not in tools["update_team"].parameters.get("properties", {})
