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
from mcp_server.tools.read import (
    get_team,
    get_team_capacity,
    list_members,
    list_teams,
    preview_team_capacity,
)
from mcp_server.tools.teams import (
    add_pattern_version,
    assign_project,
    create_member,
    create_team,
    push_team_capacity,
    teams_mcp,
    update_assignment,
    update_member,
    update_team,
)

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
    assert "delete_team" not in names
    # Nor is a member deletable: the cascade takes their absences, attendance and
    # every pattern version with them (§8.2.6, §10).
    assert "delete_member" not in names


async def test_update_team_has_no_delete_parameter():
    tools = {t.name: t for t in await teams_mcp.list_tools()}
    assert "delete" not in tools["update_team"].parameters.get("properties", {})


# --- members ---------------------------------------------------------------
#
# Members are the one team record addressed by *name* (§8.2.4). The tests below
# watch the two consequences of that: an unknown name is rejected with the list
# of members who exist, and nothing creates a person implicitly.

MEMBER_ID = "9a8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d"
MEMBER_ETAG = '"2026-08-30T10:00:00.000001+00:00"'

VERSION = {
    "system_id": "1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b",
    "member_id": MEMBER_ID,
    "effective_from": "2026-01-01",
    "mon_am": True, "mon_pm": True,
    "tue_am": True, "tue_pm": True,
    "wed_am": True, "wed_pm": True,
    "thu_am": True, "thu_pm": True,
    "fri_am": True, "fri_pm": False,
    "sat_am": False, "sat_pm": False,
    "sun_am": False, "sun_pm": False,
    "hours_per_day": 8.0,
    "focus": 0.7,
    "note": "90%",
    "created_at": "2026-01-01T00:00:00Z",
    "modified_at": "2026-01-01T00:00:00Z",
    "etag": '"2026-01-01T00:00:00+00:00"',
}

MEMBER = {
    "system_id": MEMBER_ID,
    "team_id": TEAM_ID,
    "name": "Aïcha Ben Salah",
    "role": "SW-Arch",
    "organisation": "Dev",
    "active_from": None,
    "active_to": None,
    "order_index": 0,
    "created_at": "2026-01-01T00:00:00Z",
    "modified_at": "2026-08-30T10:00:00.000001Z",
    "etag": MEMBER_ETAG,
    "effective_version": VERSION,
    "version_dates": ["2026-01-01"],
    "absence_count": 0,
    "meeting_count": 0,
}


def _list_members_mock(mock_backend, members=None):
    return mock_backend.get(path__startswith=f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(200, json=[MEMBER] if members is None else members)
    )


async def test_list_members_returns_what_the_backend_gave(mock_backend, mock_ctx, patch_get_http_request):
    _list_members_mock(mock_backend)
    result = await list_members(team_id=TEAM_ID, ctx=mock_ctx)
    assert result["items"][0]["name"] == "Aïcha Ben Salah"
    _assert_no_lock_calls(mock_backend)


async def test_list_members_passes_the_as_of_date_through(mock_backend, mock_ctx, patch_get_http_request):
    _list_members_mock(mock_backend)
    await list_members(team_id=TEAM_ID, as_of="2026-09-15", ctx=mock_ctx)
    assert mock_backend.calls[-1].request.url.params["as_of"] == "2026-09-15"


async def test_create_member_sends_the_first_pattern_with_the_person(
    mock_backend, mock_ctx, patch_get_http_request
):
    # The two cannot be separated: a member with no pattern computes as zero
    # capacity and reads as a bug rather than as missing data (§3.3).
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(201, json=MEMBER)
    )
    await create_member(
        team_id=TEAM_ID,
        name="Aïcha Ben Salah",
        role="SW-Arch",
        working_days=["mon", "tue", "wed", "thu", "fri_am"],
        focus=0.7,
        ctx=mock_ctx,
    )
    body = _last_call_body(mock_backend, "POST")
    assert body["name"] == "Aïcha Ben Salah"
    assert body["role"] == "SW-Arch"
    assert body["pattern"]["fri_am"] is True
    assert body["pattern"]["fri_pm"] is False
    assert body["pattern"]["sat_am"] is False
    assert body["pattern"]["focus"] == 0.7
    _assert_no_lock_calls(mock_backend)


async def test_create_member_leaves_the_pattern_empty_when_nothing_is_said(
    mock_backend, mock_ctx, patch_get_http_request
):
    """An omitted pattern is the backend's Mon–Fri default, not fourteen falses."""
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(201, json=MEMBER)
    )
    await create_member(team_id=TEAM_ID, name="Tomas Bergerat", ctx=mock_ctx)
    assert _last_call_body(mock_backend, "POST") == {"name": "Tomas Bergerat", "pattern": {}}


async def test_create_member_rejects_a_day_it_does_not_recognise(
    mock_backend, mock_ctx, patch_get_http_request
):
    with pytest.raises(ValueError) as exc:
        await create_member(
            team_id=TEAM_ID, name="Typo", working_days=["monday"], ctx=mock_ctx
        )
    assert "mon_am" in str(exc.value)


async def test_update_member_resolves_the_name_and_quotes_its_etag(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_members_mock(mock_backend)
    patch = mock_backend.patch(f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}").mock(
        return_value=httpx.Response(200, json={**MEMBER, "role": "Dev"})
    )
    result = await update_member(
        team_id=TEAM_ID, member_name="aïcha ben salah", role="Dev", ctx=mock_ctx
    )

    assert patch.called
    assert patch.calls[-1].request.headers["If-Match"] == MEMBER_ETAG
    assert _last_call_body(mock_backend, "PATCH") == {"role": "Dev"}
    assert result["role"] == "Dev"
    _assert_no_lock_calls(mock_backend)


async def test_an_unknown_member_name_is_rejected_with_the_ones_that_exist(
    mock_backend, mock_ctx, patch_get_http_request
):
    # The ADR-0003 rule: an unrecognised name is a typo far more often than an
    # intent to hire, so nothing is created implicitly (§8.2.4).
    _list_members_mock(mock_backend)
    with pytest.raises(ValueError) as exc:
        await update_member(team_id=TEAM_ID, member_name="Alice", role="Dev", ctx=mock_ctx)
    assert "Aïcha Ben Salah" in str(exc.value)
    assert "create_member" in str(exc.value)
    assert not [c for c in mock_backend.calls if c.request.method == "PATCH"]


async def test_update_member_cannot_write_hours_or_focus(mock_backend, mock_ctx, patch_get_http_request):
    """Contract terms are dated: they move through add_pattern_version only (§3.3)."""
    tools = {t.name: t for t in await teams_mcp.list_tools()}
    properties = tools["update_member"].parameters.get("properties", {})
    assert "hours_per_day" not in properties
    assert "focus" not in properties


async def test_update_member_retries_once_on_a_stale_row(mock_backend, mock_ctx, patch_get_http_request):
    _list_members_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}").mock(
        side_effect=[_stale_response(), httpx.Response(200, json=MEMBER)]
    )
    result = await update_member(team_id=TEAM_ID, member_name="Aïcha Ben Salah", role="Dev", ctx=mock_ctx)
    assert result["system_id"] == MEMBER_ID
    assert [c.request.method for c in mock_backend.calls] == ["GET", "PATCH", "GET", "PATCH"]


async def test_a_second_stale_failure_is_handed_back(mock_backend, mock_ctx, patch_get_http_request):
    _list_members_mock(mock_backend)
    mock_backend.patch(f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}").mock(
        side_effect=[_stale_response(), _stale_response()]
    )
    with pytest.raises(MCPBackendError) as exc:
        await update_member(team_id=TEAM_ID, member_name="Aïcha Ben Salah", role="Dev", ctx=mock_ctx)
    assert exc.value.code == "STALE"


async def test_add_pattern_version_carries_over_what_it_is_not_told(
    mock_backend, mock_ctx, patch_get_http_request
):
    """"Drop to 6 hours from September" is one argument and changes nothing else."""
    _list_members_mock(mock_backend)
    post = mock_backend.post(
        f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}/working-days"
    ).mock(return_value=httpx.Response(201, json={**VERSION, "hours_per_day": 6.0}))

    await add_pattern_version(
        team_id=TEAM_ID,
        member_name="Aïcha Ben Salah",
        effective_from="2026-09-01",
        hours_per_day=6.0,
        ctx=mock_ctx,
    )

    body = _last_call_body(mock_backend, "POST")
    assert post.called
    assert body["effective_from"] == "2026-09-01"
    assert body["hours_per_day"] == 6.0
    # Days and focus come from the version in force on that date, not from defaults.
    assert body["fri_am"] is True and body["fri_pm"] is False
    assert body["focus"] == 0.7
    _assert_no_lock_calls(mock_backend)


async def test_add_pattern_version_reads_the_pattern_of_the_date_it_changes(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_members_mock(mock_backend)
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}/working-days").mock(
        return_value=httpx.Response(201, json=VERSION)
    )
    await add_pattern_version(
        team_id=TEAM_ID, member_name="Aïcha Ben Salah", effective_from="2026-09-01", ctx=mock_ctx
    )
    assert mock_backend.calls[0].request.url.params["as_of"] == "2026-09-01"


async def test_add_pattern_version_replaces_the_days_when_told(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_members_mock(mock_backend)
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}/working-days").mock(
        return_value=httpx.Response(201, json=VERSION)
    )
    await add_pattern_version(
        team_id=TEAM_ID,
        member_name="Aïcha Ben Salah",
        effective_from="2026-09-01",
        working_days=["tue", "wed", "thu"],
        ctx=mock_ctx,
    )
    body = _last_call_body(mock_backend, "POST")
    assert (body["mon_am"], body["fri_am"]) == (False, False)
    assert (body["tue_am"], body["thu_pm"]) == (True, True)


async def test_add_pattern_version_takes_no_if_match(mock_backend, mock_ctx, patch_get_http_request):
    """Posting onto an existing date edits that version; the body is the whole
    pattern, so there is no half of someone else's edit to keep (§3.3)."""
    _list_members_mock(mock_backend)
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}/working-days").mock(
        return_value=httpx.Response(201, json=VERSION)
    )
    await add_pattern_version(
        team_id=TEAM_ID, member_name="Aïcha Ben Salah", effective_from="2026-09-01", ctx=mock_ctx
    )
    post = [c for c in mock_backend.calls if c.request.method == "POST"][-1]
    assert "If-Match" not in post.request.headers


# --- capacity and assignment ------------------------------------------------

PROJECT_ID = "7c6d5e4f-3a2b-4c1d-9e8f-0a1b2c3d4e5f"

CAPACITY = {
    "team_id": TEAM_ID,
    "normal_day_hours": 8.0,
    "anchor_project_id": PROJECT_ID,
    "sprints": [
        {
            "sprint_id": "s-1", "pi_id": "pi-1", "pi_name": "Q2-2026", "pi_state": "draft",
            "sprint_number": 1, "label": "Q2-2026.1",
            "start_date": "2026-04-06", "end_date": "2026-04-17",
            "computable": True, "available": 12,
        },
        {
            "sprint_id": "s-2", "pi_id": "pi-1", "pi_name": "Q2-2026", "pi_state": "draft",
            "sprint_number": 2, "label": "Q2-2026.2",
            "start_date": None, "end_date": None,
            "computable": False, "available": 0,
        },
    ],
    "members": [{"member_id": MEMBER_ID, "name": "Aïcha Ben Salah", "cells": [None, None]}],
    "team": [{"person_days": 13.15, "net_hours": 105.2}, None],
    "projects": [
        {
            "project_id": PROJECT_ID, "name": "ISK Portal", "effort_unit": "pts",
            "share_pct": 70, "available_source": "factor", "units_per_pd": 1.5,
            "person_days": [9.205, None], "units": [13.8075, None],
            "proposed_available": [14, None],
        }
    ],
}

ASSIGNMENT = {
    "system_id": "a-1",
    "team_id": TEAM_ID,
    "project_id": PROJECT_ID,
    "project_name": "ISK Portal",
    "effort_unit": "pts",
    "share_pct": 70,
    "available_source": "factor",
    "units_per_pd": 1.5,
    "is_anchor": True,
    "created_at": "2026-01-01T00:00:00Z",
    "modified_at": "2026-08-30T09:15:00.123456Z",
    "etag": '"assignment-tag"',
}


def _capacity_mock(mock_backend, payload=None):
    return mock_backend.get(path__startswith=f"/api/v1/teams/{TEAM_ID}/capacity").mock(
        return_value=httpx.Response(200, json=payload or CAPACITY)
    )


async def test_get_team_capacity_returns_the_report(mock_backend, mock_ctx, patch_get_http_request):
    _capacity_mock(mock_backend)
    result = await get_team_capacity(team_id=TEAM_ID, ctx=mock_ctx)
    assert result["anchor_project_id"] == PROJECT_ID
    assert result["sprints"][0]["label"] == "Q2-2026.1"
    _assert_no_lock_calls(mock_backend)


async def test_get_team_capacity_passes_the_window_through(mock_backend, mock_ctx, patch_get_http_request):
    _capacity_mock(mock_backend)
    await get_team_capacity(team_id=TEAM_ID, date_from="2026-04-01", date_to="2026-06-30", ctx=mock_ctx)
    params = mock_backend.calls[-1].request.url.params
    assert (params["from"], params["to"]) == ("2026-04-01", "2026-06-30")


async def test_preview_reads_and_writes_nothing(mock_backend, mock_ctx, patch_get_http_request):
    # "What would this do" must be answerable without a write capability (§8.2).
    _capacity_mock(mock_backend)
    result = await preview_team_capacity(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)

    assert [c.request.method for c in mock_backend.calls] == ["GET"]
    assert result["project_name"] == "ISK Portal"
    first = result["sprints"][0]
    assert first["current_available"] == 12
    assert first["share_adjusted_person_days"] == 9.205
    # The integer it would write, beside the float behind it (§6.4).
    assert first["proposed_available"] == 14
    assert first["in_project_units"] == 13.8075


async def test_preview_leaves_an_undated_sprint_unproposed(mock_backend, mock_ctx, patch_get_http_request):
    _capacity_mock(mock_backend)
    result = await preview_team_capacity(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    second = result["sprints"][1]
    assert second["proposed_available"] is None
    assert second["team_person_days"] is None


async def test_preview_of_a_project_the_team_does_not_serve_says_what_it_does(
    mock_backend, mock_ctx, patch_get_http_request
):
    _capacity_mock(mock_backend)
    with pytest.raises(ValueError) as exc:
        await preview_team_capacity(
            team_id=TEAM_ID, project_id="00000000-0000-4000-8000-000000000000", ctx=mock_ctx
        )
    assert "ISK Portal" in str(exc.value)
    assert "assign_project" in str(exc.value)


async def test_assign_project_posts_the_share_and_factor(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/projects").mock(
        return_value=httpx.Response(201, json=ASSIGNMENT)
    )
    await assign_project(
        team_id=TEAM_ID, project_id=PROJECT_ID, share_pct=70,
        available_source="factor", units_per_pd=1.5, ctx=mock_ctx,
    )
    assert _last_call_body(mock_backend, "POST") == {
        "project_id": PROJECT_ID,
        "share_pct": 70,
        "available_source": "factor",
        "units_per_pd": 1.5,
    }
    _assert_no_lock_calls(mock_backend)


async def test_assign_project_omits_unset_fields_so_the_defaults_apply(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/projects").mock(
        return_value=httpx.Response(201, json=ASSIGNMENT)
    )
    await assign_project(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert _last_call_body(mock_backend, "POST") == {"project_id": PROJECT_ID}


async def test_assign_project_surfaces_a_project_another_team_holds(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.post(f"/api/v1/teams/{TEAM_ID}/projects").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {
                "error": "PROJECT_ALREADY_ASSIGNED",
                "message": "'ISK Portal' is already served by 'Frontline'.",
            }},
        )
    )
    with pytest.raises(MCPBackendError) as exc:
        await assign_project(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert exc.value.code == "CONFLICT"
    assert "Frontline" in exc.value.message


async def test_update_assignment_quotes_the_etag_of_the_row_it_read(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.get(f"/api/v1/teams/{TEAM_ID}/projects").mock(
        return_value=httpx.Response(200, json=[ASSIGNMENT])
    )
    patch = mock_backend.patch(f"/api/v1/teams/{TEAM_ID}/projects/{PROJECT_ID}").mock(
        return_value=httpx.Response(200, json={**ASSIGNMENT, "share_pct": 50})
    )
    result = await update_assignment(team_id=TEAM_ID, project_id=PROJECT_ID, share_pct=50, ctx=mock_ctx)

    assert patch.calls[-1].request.headers["If-Match"] == '"assignment-tag"'
    assert _last_call_body(mock_backend, "PATCH") == {"share_pct": 50}
    assert result["share_pct"] == 50
    _assert_no_lock_calls(mock_backend)


async def test_update_assignment_rejects_a_project_the_team_does_not_serve(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.get(f"/api/v1/teams/{TEAM_ID}/projects").mock(
        return_value=httpx.Response(200, json=[])
    )
    with pytest.raises(ValueError) as exc:
        await update_assignment(team_id=TEAM_ID, project_id=PROJECT_ID, share_pct=50, ctx=mock_ctx)
    assert "assign_project" in str(exc.value)


async def test_there_is_no_unassign_tool(mock_backend, mock_ctx, patch_get_http_request):
    """Removing a team from a project is a human act, like every other container removal."""
    names = {t.name for t in await teams_mcp.list_tools()}
    assert "unassign_project" not in names
    assert "delete_assignment" not in names


# --- push_team_capacity: the one team tool that writes project data ----------


PUSH_RESULT = {
    "project_id": PROJECT_ID,
    "project_name": "ISK Portal",
    "status": "updated",
    "updated_sprints": 3,
    "total_delta": 6,
    "message": None,
    "locked_by": None,
    "locked_until": None,
}


def _served_mock(mock_backend, rows=None):
    return mock_backend.get(f"/api/v1/teams/{TEAM_ID}/projects").mock(
        return_value=httpx.Response(200, json=rows if rows is not None else [ASSIGNMENT])
    )


async def test_push_acquires_and_releases_the_project_lock(
    mock_backend, mock_ctx, patch_get_http_request
):
    """The exception to the module's rule (§8.2, WP-7H).

    Every other team tool is outside the single-writer lock by construction. This
    one writes sprint Available — an ordinary project write wearing a team's name
    — so acquiring makes an agent's push atomic against a human editor.
    """
    _served_mock(mock_backend)
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={"locked_by_username": "testuser"})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/team-capacity/apply").mock(
        return_value=httpx.Response(200, json=PUSH_RESULT)
    )

    result = await push_team_capacity(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)

    assert result["updated_sprints"] == 3
    lock_calls = [str(c.request.url) for c in mock_backend.calls if "edit-lock" in str(c.request.url)]
    assert any("acquire" in url for url in lock_calls)
    assert any("release" in url for url in lock_calls)


async def test_push_passes_a_window_through_as_query_parameters(
    mock_backend, mock_ctx, patch_get_http_request
):
    _served_mock(mock_backend)
    mock_backend.post(path__startswith=f"/api/v1/projects/{PROJECT_ID}/edit-lock").mock(
        return_value=httpx.Response(200, json={})
    )
    route = mock_backend.post(
        path__startswith=f"/api/v1/projects/{PROJECT_ID}/team-capacity/apply"
    ).mock(return_value=httpx.Response(200, json=PUSH_RESULT))

    await push_team_capacity(
        team_id=TEAM_ID,
        project_id=PROJECT_ID,
        date_from="2026-04-06",
        date_to="2026-05-01",
        ctx=mock_ctx,
    )

    url = str(route.calls.last.request.url)
    assert "from=2026-04-06" in url and "to=2026-05-01" in url


async def test_push_refuses_a_project_the_team_does_not_serve(
    mock_backend, mock_ctx, patch_get_http_request
):
    """A wrong team_id would otherwise push the right numbers from the wrong name."""
    _served_mock(mock_backend, rows=[])

    with pytest.raises(ValueError, match="does not serve project"):
        await push_team_capacity(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)

    # And nothing was locked or written on the way to finding out.
    assert not [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]


async def test_push_surfaces_a_manual_project_as_a_conflict(
    mock_backend, mock_ctx, patch_get_http_request
):
    """Silently doing nothing would look like a bug (§6.7)."""
    _served_mock(mock_backend)
    mock_backend.post(path__startswith=f"/api/v1/projects/{PROJECT_ID}/edit-lock").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{PROJECT_ID}/team-capacity/apply").mock(
        return_value=httpx.Response(
            409,
            json={
                "detail": {
                    "error": "AVAILABLE_SOURCE_IS_MANUAL",
                    "message": "'ISK Portal' types its Available by hand.",
                }
            },
        )
    )

    with pytest.raises(MCPBackendError) as excinfo:
        await push_team_capacity(team_id=TEAM_ID, project_id=PROJECT_ID, ctx=mock_ctx)
    assert "by hand" in str(excinfo.value)
