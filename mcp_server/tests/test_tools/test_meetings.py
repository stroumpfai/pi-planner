"""The meeting tools (spec/teams.md §3.5, §8.2).

What these assert is the handful of places meetings differ from the absence tools
they otherwise mirror: one row carries many attendees rather than fanning out,
`all_members` is a flag rather than a list the agent assembles, attendance is
edited through the meeting and is left alone when unmentioned, and
`delete_meeting` joins `delete_absence` as the second and last destructive team
tool. The lock is absent here as everywhere in this module (§4.1).
"""
import httpx
import pytest

from mcp_server.backend import MCPBackendError
from mcp_server.tools.read import list_meetings
from mcp_server.tools.teams import (
    bulk_create_meetings,
    create_meeting,
    delete_meeting,
    update_meeting,
)

TEAM_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8"
MEMBER_ID = "9a8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d"
OTHER_MEMBER_ID = "0f1e2d3c-4b5a-4968-8776-554433221100"
MEETING_ID = "22223333-4444-5555-6666-777788889999"
MEETING_ETAG = '"2026-08-30T10:00:00.000001+00:00"'


def _member(system_id: str, name: str) -> dict:
    return {
        "system_id": system_id,
        "team_id": TEAM_ID,
        "name": name,
        "role": None,
        "organisation": None,
        "active_from": None,
        "active_to": None,
        "order_index": 0,
        "created_at": "2026-01-01T00:00:00Z",
        "modified_at": "2026-01-01T00:00:00Z",
        "etag": '"2026-01-01T00:00:00+00:00"',
        "effective_version": None,
        "version_dates": ["2026-01-01"],
        "absence_count": 0,
        "meeting_count": 0,
    }


MEMBERS = [_member(MEMBER_ID, "Aïcha Ben Salah"), _member(OTHER_MEMBER_ID, "Tomas Berg")]

MEETING = {
    "system_id": MEETING_ID,
    "team_id": TEAM_ID,
    "title": "Stand-up",
    "kind": "weekly",
    "start_date": "2026-09-01",
    "end_date": None,
    "weekday": 1,
    "interval_weeks": None,
    "half": "am",
    "duration_minutes": 15,
    "order_index": 0,
    "member_ids": [MEMBER_ID],
    "summary": "every Tuesday am, from 2026-09-01, ongoing",
    "occurrences": ["2026-09-01", "2026-09-08"],
    "created_at": "2026-08-01T00:00:00Z",
    "modified_at": "2026-08-30T10:00:00.000001Z",
    "etag": MEETING_ETAG,
}

MEETINGS_URL = f"/api/v1/teams/{TEAM_ID}/meetings"


def _members_mock(mock_backend, members=None):
    return mock_backend.get(path__startswith=f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(200, json=MEMBERS if members is None else members)
    )


def _list_mock(mock_backend, rows=None):
    return mock_backend.get(MEETINGS_URL).mock(
        return_value=httpx.Response(200, json=[MEETING] if rows is None else rows)
    )


def _body(mock_backend, method: str) -> dict:
    import json

    matching = [c for c in mock_backend.calls if c.request.method == method]
    return json.loads(matching[-1].request.content)


def _assert_no_lock_calls(mock_backend) -> None:
    """Team writes are outside the single-writer lock, by construction (§4.1)."""
    assert not [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]


# --- reading ----------------------------------------------------------------


async def test_list_meetings_returns_what_the_backend_gave(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    result = await list_meetings(team_id=TEAM_ID, ctx=mock_ctx)
    assert result["items"][0]["summary"] == "every Tuesday am, from 2026-09-01, ongoing"
    _assert_no_lock_calls(mock_backend)


async def test_list_meetings_passes_the_window_through(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    await list_meetings(team_id=TEAM_ID, date_from="2026-09-01", date_to="2026-09-30", ctx=mock_ctx)
    params = mock_backend.calls[-1].request.url.params
    assert params["from"] == "2026-09-01"
    assert params["to"] == "2026-09-30"


# --- creating ---------------------------------------------------------------


async def test_create_meeting_writes_one_row_with_its_attendees(mock_backend, mock_ctx, patch_get_http_request):
    """One row, many attendees — where an absence writes one record each (§3.5)."""
    _members_mock(mock_backend)
    mock_backend.post(MEETINGS_URL).mock(return_value=httpx.Response(201, json=MEETING))

    await create_meeting(
        team_id=TEAM_ID,
        title="Stand-up",
        kind="weekly",
        start_date="2026-09-01",
        duration_minutes=15,
        weekday=1,
        member_names=["Aïcha Ben Salah"],
        ctx=mock_ctx,
    )
    body = _body(mock_backend, "POST")
    assert body["member_ids"] == [MEMBER_ID]
    assert body["duration_minutes"] == 15
    assert body["half"] == "am"
    # Nothing invented: an unset field is simply absent from the payload.
    assert "interval_weeks" not in body
    _assert_no_lock_calls(mock_backend)


async def test_all_members_covers_the_team_without_listing_it(mock_backend, mock_ctx, patch_get_http_request):
    _members_mock(mock_backend)
    mock_backend.post(MEETINGS_URL).mock(return_value=httpx.Response(201, json=MEETING))

    await create_meeting(
        team_id=TEAM_ID,
        title="Stand-up",
        kind="weekly",
        start_date="2026-09-01",
        duration_minutes=15,
        weekday=1,
        all_members=True,
        ctx=mock_ctx,
    )
    assert _body(mock_backend, "POST")["member_ids"] == [MEMBER_ID, OTHER_MEMBER_ID]


async def test_a_meeting_may_start_with_nobody_in_it(mock_backend, mock_ctx, patch_get_http_request):
    """Schedule first, tick attendance afterwards — the matrix's own order (§11).

    No member lookup happens at all when nobody is named — the resolver is only
    reached by a name or by `all_members`.
    """
    mock_backend.post(MEETINGS_URL).mock(return_value=httpx.Response(201, json=MEETING))

    await create_meeting(
        team_id=TEAM_ID,
        title="Workshop",
        kind="range",
        start_date="2026-09-08",
        duration_minutes=480,
        ctx=mock_ctx,
    )
    assert _body(mock_backend, "POST")["member_ids"] == []


async def test_create_meeting_rejects_an_unknown_name_and_lists_who_exists(
    mock_backend, mock_ctx, patch_get_http_request
):
    _members_mock(mock_backend)
    with pytest.raises(ValueError) as err:
        await create_meeting(
            team_id=TEAM_ID,
            title="Sync",
            kind="range",
            start_date="2026-09-08",
            duration_minutes=30,
            member_names=["Anders Michel"],
            ctx=mock_ctx,
        )
    assert "Aïcha Ben Salah" in str(err.value)
    assert not [c for c in mock_backend.calls if c.request.method == "POST"]


# --- updating ---------------------------------------------------------------


async def test_update_meeting_quotes_the_etag_from_its_own_read(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    mock_backend.patch(f"{MEETINGS_URL}/{MEETING_ID}").mock(
        return_value=httpx.Response(200, json=MEETING)
    )

    await update_meeting(team_id=TEAM_ID, meeting_id=MEETING_ID, duration_minutes=30, ctx=mock_ctx)
    patch = [c for c in mock_backend.calls if c.request.method == "PATCH"][-1]
    assert patch.request.headers["If-Match"] == MEETING_ETAG
    _assert_no_lock_calls(mock_backend)


async def test_update_meeting_leaves_attendance_alone_when_unmentioned(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_mock(mock_backend)
    mock_backend.patch(f"{MEETINGS_URL}/{MEETING_ID}").mock(
        return_value=httpx.Response(200, json=MEETING)
    )

    await update_meeting(team_id=TEAM_ID, meeting_id=MEETING_ID, title="Daily", ctx=mock_ctx)
    body = _body(mock_backend, "PATCH")
    assert "member_ids" not in body
    assert body == {"title": "Daily"}


async def test_update_meeting_replaces_the_attendee_set_when_given(
    mock_backend, mock_ctx, patch_get_http_request
):
    _members_mock(mock_backend)
    _list_mock(mock_backend)
    mock_backend.patch(f"{MEETINGS_URL}/{MEETING_ID}").mock(
        return_value=httpx.Response(200, json=MEETING)
    )

    await update_meeting(
        team_id=TEAM_ID, meeting_id=MEETING_ID, member_names=["Tomas Berg"], ctx=mock_ctx
    )
    assert _body(mock_backend, "PATCH")["member_ids"] == [OTHER_MEMBER_ID]


async def test_update_meeting_retries_once_on_stale(mock_backend, mock_ctx, patch_get_http_request):
    """An agent holds no ETag between calls, so it re-reads and tries again (§8.2.3)."""
    _list_mock(mock_backend)
    mock_backend.patch(f"{MEETINGS_URL}/{MEETING_ID}").mock(
        side_effect=[
            httpx.Response(412, json={"detail": {"error": "STALE", "message": "moved"}}),
            httpx.Response(200, json=MEETING),
        ]
    )

    result = await update_meeting(
        team_id=TEAM_ID, meeting_id=MEETING_ID, title="Daily", ctx=mock_ctx
    )
    assert result["system_id"] == MEETING_ID
    assert len([c for c in mock_backend.calls if c.request.method == "PATCH"]) == 2


async def test_update_meeting_gives_up_after_a_second_stale(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    mock_backend.patch(f"{MEETINGS_URL}/{MEETING_ID}").mock(
        return_value=httpx.Response(412, json={"detail": {"error": "STALE", "message": "moved"}})
    )

    with pytest.raises(MCPBackendError) as err:
        await update_meeting(team_id=TEAM_ID, meeting_id=MEETING_ID, title="Daily", ctx=mock_ctx)
    assert err.value.code == "STALE"


async def test_an_unknown_meeting_id_names_the_tool_that_lists_them(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_mock(mock_backend, rows=[])
    with pytest.raises(ValueError) as err:
        await update_meeting(team_id=TEAM_ID, meeting_id=MEETING_ID, title="Daily", ctx=mock_ctx)
    assert "list_meetings" in str(err.value)


# --- deleting ---------------------------------------------------------------


async def test_delete_meeting_quotes_the_etag_and_reports_the_id(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_mock(mock_backend)
    mock_backend.delete(f"{MEETINGS_URL}/{MEETING_ID}").mock(return_value=httpx.Response(204))

    result = await delete_meeting(team_id=TEAM_ID, meeting_id=MEETING_ID, ctx=mock_ctx)
    assert result == {"deleted": MEETING_ID}
    deleted = [c for c in mock_backend.calls if c.request.method == "DELETE"][-1]
    assert deleted.request.headers["If-Match"] == MEETING_ETAG
    _assert_no_lock_calls(mock_backend)


# --- bulk -------------------------------------------------------------------


async def test_bulk_create_meetings_sends_the_window_and_the_entries(
    mock_backend, mock_ctx, patch_get_http_request
):
    """Replacement inside a window is what makes a re-read idempotent (§8.2.7)."""
    mock_backend.post(f"{MEETINGS_URL}/bulk").mock(
        return_value=httpx.Response(
            200,
            json={
                "dry_run": False,
                "window_from": "2026-09-01",
                "window_to": "2026-09-30",
                "created": 1,
                "deleted": 0,
                "unresolved_names": [],
                "meetings": [MEETING],
            },
        )
    )
    entries = [
        {
            "title": "Stand-up",
            "kind": "weekly",
            "start_date": "2026-09-01",
            "weekday": 1,
            "half": "am",
            "duration_minutes": 15,
            "all_members": True,
        }
    ]

    result = await bulk_create_meetings(
        team_id=TEAM_ID,
        window_from="2026-09-01",
        window_to="2026-09-30",
        entries=entries,
        ctx=mock_ctx,
    )
    body = _body(mock_backend, "POST")
    assert body["dry_run"] is False
    assert body["window_from"] == "2026-09-01"
    assert body["entries"] == entries
    assert result["created"] == 1
    _assert_no_lock_calls(mock_backend)


async def test_a_dry_run_writes_nothing_and_says_so(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"{MEETINGS_URL}/bulk").mock(
        return_value=httpx.Response(
            200,
            json={
                "dry_run": True,
                "window_from": "2026-09-01",
                "window_to": "2026-09-30",
                "created": 1,
                "deleted": 2,
                "unresolved_names": [],
                "meetings": [],
            },
        )
    )
    result = await bulk_create_meetings(
        team_id=TEAM_ID,
        window_from="2026-09-01",
        window_to="2026-09-30",
        entries=[],
        dry_run=True,
        ctx=mock_ctx,
    )
    assert _body(mock_backend, "POST")["dry_run"] is True
    assert result["meetings"] == []
