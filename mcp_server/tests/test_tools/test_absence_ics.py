"""import_absence_ics: an .ics file as absences (spec/teams.md §7.4.1).

The backend does the reading; what the tool owns is the conversation around it.
It previews by default, resolves names, turns the agent's include/exclude/assign
choices into an apply that names every row, refuses events nobody owns — all of
them at once — and never takes the edit lock.
"""
import json
import re

import httpx
import pytest

from mcp_server.tools.teams import import_absence_ics

TEAM_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8"
ANNA_ID = "9a8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d"
BEN_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
IMPORT_URL = f"/api/v1/teams/{TEAM_ID}/absences/import/ics"
ICS = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"

MEMBERS = [{"system_id": ANNA_ID, "name": "Anna Keller"}, {"system_id": BEN_ID, "name": "Ben Ott"}]


def _candidate(uid: str, member_id: str | None, *, selected: bool | None = None, title: str = "Vacation") -> dict:
    # As the backend does: an event nobody matched starts unticked.
    return {
        "source_uid": uid, "title": title, "rule_summary": "2026-11-02, both halves",
        "member_id": member_id, "match": "picked" if member_id else "none", "repeats": "single",
        "selected_by_default": (member_id is not None) if selected is None else selected,
        "action": "create" if member_id else None,
    }


PREVIEW = {
    "dry_run": True, "window_from": "2026-11-01", "window_to": "2026-11-30",
    "candidates": [
        _candidate("week@x", ANNA_ID),
        _candidate("meet@x", ANNA_ID, selected=False, title="Sprint review"),
    ],
    "removals": [{"system_id": "old-row"}],
    "skipped": [],
}


def _mock(mock_backend, preview: dict = PREVIEW, *, members: bool = True):
    # The fixture fails a test that leaves a route uncalled, so the member list
    # is only mocked where a name is resolved.
    if members:
        mock_backend.get(path__startswith=f"/api/v1/teams/{TEAM_ID}/members").mock(
            return_value=httpx.Response(200, json=MEMBERS)
        )

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.params["dry_run"] == "true":
            return httpx.Response(200, json=preview)
        return httpx.Response(200, json={**preview, "dry_run": False, "created": 1})

    return mock_backend.post(IMPORT_URL).mock(side_effect=respond)


def _form_field(request: httpx.Request, name: str):
    match = re.search(rb'name="' + name.encode() + rb'"\r\n\r\n(.*?)\r\n--', request.content, re.S)
    return json.loads(match.group(1)) if match else None


def _apply_request(route) -> httpx.Request:
    [request] = [c.request for c in route.calls if c.request.url.params["dry_run"] == "false"]
    return request


def _assert_no_lock_calls(mock_backend) -> None:
    assert not [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]


async def test_it_previews_by_default_and_writes_nothing(mock_backend, mock_ctx, patch_get_http_request):
    route = _mock(mock_backend)
    result = await import_absence_ics(team_id=TEAM_ID, ics_content=ICS, member_name="anna keller", ctx=mock_ctx)

    assert result["dry_run"] is True
    [call] = route.calls
    assert call.request.url.params["member_id"] == ANNA_ID
    assert b"BEGIN:VCALENDAR" in call.request.content
    _assert_no_lock_calls(mock_backend)


async def test_an_apply_sends_the_default_ticks_the_removals_and_the_preview_window(
    mock_backend, mock_ctx, patch_get_http_request
):
    route = _mock(mock_backend)
    await import_absence_ics(team_id=TEAM_ID, ics_content=ICS, member_name="Anna Keller", dry_run=False, ctx=mock_ctx)

    request = _apply_request(route)
    assert _form_field(request, "selections") == [{"source_uid": "week@x", "member_id": ANNA_ID}]
    assert _form_field(request, "removals") == ["old-row"]
    assert (request.url.params["window_from"], request.url.params["window_to"]) == ("2026-11-01", "2026-11-30")
    _assert_no_lock_calls(mock_backend)


async def test_include_exclude_and_keep_removed_shape_the_apply(mock_backend, mock_ctx, patch_get_http_request):
    route = _mock(mock_backend)
    await import_absence_ics(
        team_id=TEAM_ID, ics_content=ICS, member_name="Anna Keller", dry_run=False,
        include_uids=["week@x", "meet@x"], exclude_uids=["week@x"], keep_removed=True, ctx=mock_ctx,
    )
    request = _apply_request(route)
    assert _form_field(request, "selections") == [{"source_uid": "meet@x", "member_id": ANNA_ID}]
    assert _form_field(request, "removals") == []


async def test_unowned_events_are_left_out_by_default(mock_backend, mock_ctx, patch_get_http_request):
    preview = {**PREVIEW, "candidates": [_candidate("week@x", ANNA_ID), _candidate("a@x", None)]}
    route = _mock(mock_backend, preview, members=False)
    await import_absence_ics(team_id=TEAM_ID, ics_content=ICS, dry_run=False, ctx=mock_ctx)
    assert _form_field(_apply_request(route), "selections") == [{"source_uid": "week@x", "member_id": ANNA_ID}]


async def test_every_included_unowned_event_is_refused_together_and_nothing_is_written(
    mock_backend, mock_ctx, patch_get_http_request
):
    preview = {**PREVIEW, "candidates": [
        _candidate("a@x", None, title="Somebody away"), _candidate("b@x", None, title="Offsite"),
    ]}
    route = _mock(mock_backend, preview)
    with pytest.raises(ValueError) as err:
        await import_absence_ics(
            team_id=TEAM_ID, ics_content=ICS, dry_run=False, include_uids=["a@x", "b@x"], ctx=mock_ctx,
        )

    message = str(err.value)
    assert "Somebody away" in message and "Offsite" in message
    assert "'Anna Keller'" in message  # who does exist
    assert all(c.request.url.params["dry_run"] == "true" for c in route.calls)


async def test_assign_gives_an_unowned_event_a_member_by_name(mock_backend, mock_ctx, patch_get_http_request):
    preview = {**PREVIEW, "candidates": [_candidate("a@x", None), _candidate("b@x", None)]}
    route = _mock(mock_backend, preview)
    await import_absence_ics(
        team_id=TEAM_ID, ics_content=ICS, dry_run=False,
        assign={"a@x": "Ben Ott"}, exclude_uids=["b@x"], ctx=mock_ctx,
    )
    assert _form_field(_apply_request(route), "selections") == [{"source_uid": "a@x", "member_id": BEN_ID}]


async def test_an_unknown_member_name_is_refused_before_any_upload(mock_backend, mock_ctx, patch_get_http_request):
    # Only the member list is mocked: an upload would hit an unmocked route and fail.
    mock_backend.get(path__startswith=f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(200, json=MEMBERS)
    )
    with pytest.raises(ValueError, match="No member named 'Carla'"):
        await import_absence_ics(team_id=TEAM_ID, ics_content=ICS, member_name="Carla", ctx=mock_ctx)
