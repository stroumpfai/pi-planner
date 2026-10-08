"""The holiday calendar tools (spec/public-holidays.md §9.3).

What matters, each asserted directly: calendars are addressed by name and an
unknown name is refused with the ones that exist, an entry write quotes the ETag
from its own read, the bulk and import paths default to a dry run, no tool takes
the edit lock, and there is no way to delete a calendar.
"""
import json

import httpx
import pytest

from mcp_server.tools.holidays import (
    create_holiday_calendar,
    create_holiday_entry,
    delete_holiday_entry,
    disable_team_calendar,
    enable_team_calendar,
    import_holiday_ics,
    replace_holiday_entries,
    set_holiday_exception,
    update_holiday_calendar,
    update_holiday_entry,
)
from mcp_server.tools.read import get_holiday_calendar, list_team_holidays

TEAM_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8"
CAL_ID = "aaaabbbb-cccc-4ddd-8eee-ffff00001111"
ENTRY_ID = "11112222-3333-4444-5555-666677778888"
MEMBER_ID = "9a8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d"
ENTRY_ETAG = '"2026-10-05T10:00:00.000001+00:00"'
CALENDARS_URL = "/api/v1/holiday-calendars"

CALENDAR = {
    "system_id": CAL_ID, "name": "Switzerland", "description": None, "entry_count": 1,
    "first_year": 2026, "last_year": 2026, "teams": [], "etag": '"c"',
    "created_at": "2026-01-01T00:00:00Z", "modified_at": "2026-01-01T00:00:00Z",
}
ENTRY = {
    "system_id": ENTRY_ID, "calendar_id": CAL_ID, "label": "Easter Monday",
    "start_date": "2026-04-06", "start_half": "am", "end_date": "2026-04-06", "end_half": "pm",
    "exception_days": [], "etag": ENTRY_ETAG,
    "created_at": "2026-01-01T00:00:00Z", "modified_at": "2026-01-01T00:00:00Z",
}


def _calendars(mock_backend):
    mock_backend.get(CALENDARS_URL).mock(return_value=httpx.Response(200, json=[CALENDAR]))


def _detail(mock_backend):
    mock_backend.get(f"{CALENDARS_URL}/{CAL_ID}").mock(
        return_value=httpx.Response(200, json={**CALENDAR, "entries": [ENTRY]})
    )


def _no_lock(mock_backend):
    assert not [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]


async def test_an_unknown_calendar_name_is_refused_with_the_known_ones(
    mock_backend, mock_ctx, patch_get_http_request
):
    _calendars(mock_backend)
    with pytest.raises(ValueError, match="Calendars: Switzerland"):
        await create_holiday_entry(
            calendar="Germany", label="X", start_date="2026-01-01", ctx=mock_ctx
        )


async def test_create_entry_resolves_the_name_case_insensitively(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    post = mock_backend.post(f"{CALENDARS_URL}/{CAL_ID}/entries").mock(
        return_value=httpx.Response(201, json=ENTRY)
    )
    await create_holiday_entry(
        calendar="  switzerland ", label="Christmas Eve", start_date="2026-12-24",
        start_half="pm", ctx=mock_ctx,
    )
    body = json.loads(post.calls[0].request.content)
    assert body == {"label": "Christmas Eve", "start_date": "2026-12-24", "start_half": "pm"}
    _no_lock(mock_backend)


async def test_update_and_delete_quote_the_entry_etag_they_read(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    _detail(mock_backend)
    patch = mock_backend.patch(f"{CALENDARS_URL}/{CAL_ID}/entries/{ENTRY_ID}").mock(
        return_value=httpx.Response(200, json=ENTRY)
    )
    delete = mock_backend.delete(f"{CALENDARS_URL}/{CAL_ID}/entries/{ENTRY_ID}").mock(
        return_value=httpx.Response(204)
    )
    await update_holiday_entry(calendar="Switzerland", entry_id=ENTRY_ID, label="Ostermontag", ctx=mock_ctx)
    assert patch.calls[0].request.headers["If-Match"] == ENTRY_ETAG
    result = await delete_holiday_entry(calendar="Switzerland", entry_id=ENTRY_ID, ctx=mock_ctx)
    assert delete.calls[0].request.headers["If-Match"] == ENTRY_ETAG
    assert result["label"] == "Easter Monday"


async def test_bulk_replace_defaults_to_a_dry_run(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    put = mock_backend.put(f"{CALENDARS_URL}/{CAL_ID}/entries").mock(
        return_value=httpx.Response(200, json={"dry_run": True, "created": 1, "deleted": 0,
                                               "exceptions_kept": 0, "exceptions_dropped": 0})
    )
    await replace_holiday_entries(
        calendar="Switzerland", window_from="2026-01-01", window_to="2026-12-31",
        entries=[{"label": "May Day", "start_date": "2026-05-01"}], ctx=mock_ctx,
    )
    assert json.loads(put.calls[0].request.content)["dry_run"] is True


async def test_ics_import_uploads_the_text_as_a_file_and_previews(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    post = mock_backend.post(f"{CALENDARS_URL}/{CAL_ID}/import/ics").mock(
        return_value=httpx.Response(200, json={"dry_run": True, "created": 0, "duplicates": 0,
                                               "skipped": [], "truncated_labels": 0, "entries": []})
    )
    await import_holiday_ics(calendar="Switzerland", ics_content="BEGIN:VCALENDAR\nEND:VCALENDAR", ctx=mock_ctx)
    request = post.calls[0].request
    assert request.url.params["dry_run"] == "true"
    assert b"BEGIN:VCALENDAR" in request.content
    assert "multipart/form-data" in request.headers["content-type"]


async def test_enable_calendar_puts_the_switch_without_a_lock(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    put = mock_backend.put(f"/api/v1/teams/{TEAM_ID}/holiday-calendars/{CAL_ID}").mock(
        return_value=httpx.Response(204)
    )
    result = await enable_team_calendar(team_id=TEAM_ID, calendar="Switzerland", ctx=mock_ctx)
    assert put.called
    assert result == {"team_id": TEAM_ID, "calendar": "Switzerland", "enabled": True}
    _no_lock(mock_backend)


async def test_set_exception_resolves_the_member_by_name(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get(f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(200, json=[{"system_id": MEMBER_ID, "name": "Aïcha Ben Salah"}])
    )
    url = f"/api/v1/teams/{TEAM_ID}/members/{MEMBER_ID}/holiday-exceptions/{ENTRY_ID}/2026-04-06"
    put = mock_backend.put(url).mock(return_value=httpx.Response(204))
    delete = mock_backend.delete(url).mock(return_value=httpx.Response(204))
    await set_holiday_exception(
        team_id=TEAM_ID, member_name="Aïcha Ben Salah", entry_id=ENTRY_ID, day="2026-04-06",
        works=True, ctx=mock_ctx,
    )
    await set_holiday_exception(
        team_id=TEAM_ID, member_name="Aïcha Ben Salah", entry_id=ENTRY_ID, day="2026-04-06",
        works=False, ctx=mock_ctx,
    )
    assert put.called and delete.called


async def test_read_tools_resolve_names_and_pass_windows(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    _detail(mock_backend)
    detail = await get_holiday_calendar(calendar="Switzerland", year=2026, ctx=mock_ctx)
    assert detail["entries"][0]["label"] == "Easter Monday"

    mock_backend.get(f"/api/v1/teams/{TEAM_ID}/holidays").mock(
        return_value=httpx.Response(200, json={"team_id": TEAM_ID, "enabled_calendar_ids": [], "entries": []})
    )
    await list_team_holidays(team_id=TEAM_ID, date_from="2026-04-01", date_to="2026-04-30", ctx=mock_ctx)
    params = mock_backend.calls[-1].request.url.params
    assert (params["from"], params["to"]) == ("2026-04-01", "2026-04-30")


def _writes(mock_backend):
    return [c for c in mock_backend.calls if c.request.method != "GET"]


async def test_with_no_calendars_at_all_the_refusal_says_none_yet_and_how_to_create_one(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.get(CALENDARS_URL).mock(return_value=httpx.Response(200, json=[]))
    with pytest.raises(ValueError) as excinfo:
        await create_holiday_entry(calendar="Germany", label="X", start_date="2026-01-01", ctx=mock_ctx)
    message = str(excinfo.value)
    assert "No holiday calendar named 'Germany'" in message
    assert "Calendars: none yet." in message
    assert "Create one with create_holiday_calendar" in message
    assert _writes(mock_backend) == []


async def test_create_calendar_posts_name_and_description(mock_backend, mock_ctx, patch_get_http_request):
    post = mock_backend.post(CALENDARS_URL).mock(return_value=httpx.Response(201, json=CALENDAR))
    result = await create_holiday_calendar(name="Switzerland", description="Federal", ctx=mock_ctx)
    assert result["system_id"] == CAL_ID
    assert json.loads(post.calls[0].request.content) == {"name": "Switzerland", "description": "Federal"}
    _no_lock(mock_backend)


async def test_update_calendar_renames_and_quotes_the_calendar_etag(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    patch = mock_backend.patch(f"{CALENDARS_URL}/{CAL_ID}").mock(
        return_value=httpx.Response(200, json={**CALENDAR, "name": "Schweiz"})
    )
    result = await update_holiday_calendar(
        calendar="Switzerland", new_name="Schweiz", description="Bundesfeiertage", ctx=mock_ctx
    )
    assert result["name"] == "Schweiz"
    request = patch.calls[0].request
    assert json.loads(request.content) == {"name": "Schweiz", "description": "Bundesfeiertage"}
    assert request.headers["If-Match"] == CALENDAR["etag"]
    _no_lock(mock_backend)


async def test_update_calendar_sends_only_the_field_given(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    patch = mock_backend.patch(f"{CALENDARS_URL}/{CAL_ID}").mock(return_value=httpx.Response(200, json=CALENDAR))
    await update_holiday_calendar(calendar="Switzerland", description="Federal only", ctx=mock_ctx)
    assert json.loads(patch.calls[0].request.content) == {"description": "Federal only"}


async def test_update_calendar_with_nothing_to_change_is_refused_without_a_write(
    mock_backend, mock_ctx, patch_get_http_request
):
    _calendars(mock_backend)
    with pytest.raises(ValueError, match="Nothing to change: pass new_name and/or description"):
        await update_holiday_calendar(calendar="Switzerland", ctx=mock_ctx)
    assert _writes(mock_backend) == []


async def test_create_entry_sends_every_optional_field_given(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    post = mock_backend.post(f"{CALENDARS_URL}/{CAL_ID}/entries").mock(
        return_value=httpx.Response(201, json=ENTRY)
    )
    await create_holiday_entry(
        calendar="Switzerland", label="Christmas", start_date="2026-12-24", end_date="2026-12-26",
        start_half="pm", end_half="am", ctx=mock_ctx,
    )
    assert json.loads(post.calls[0].request.content) == {
        "label": "Christmas", "start_date": "2026-12-24", "end_date": "2026-12-26",
        "start_half": "pm", "end_half": "am",
    }


async def test_update_entry_sends_only_the_fields_given(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    _detail(mock_backend)
    patch = mock_backend.patch(f"{CALENDARS_URL}/{CAL_ID}/entries/{ENTRY_ID}").mock(
        return_value=httpx.Response(200, json=ENTRY)
    )
    await update_holiday_entry(
        calendar="Switzerland", entry_id=ENTRY_ID, end_date="2026-04-07", end_half="am", ctx=mock_ctx
    )
    assert json.loads(patch.calls[0].request.content) == {"end_date": "2026-04-07", "end_half": "am"}


async def test_update_entry_with_nothing_to_change_is_refused_without_a_write(
    mock_backend, mock_ctx, patch_get_http_request
):
    _calendars(mock_backend)
    _detail(mock_backend)
    with pytest.raises(ValueError, match="^Nothing to change\\.$"):
        await update_holiday_entry(calendar="Switzerland", entry_id=ENTRY_ID, ctx=mock_ctx)
    assert _writes(mock_backend) == []


async def test_an_entry_not_in_the_calendar_is_refused_before_any_write(
    mock_backend, mock_ctx, patch_get_http_request
):
    other = "99998888-7777-4666-8555-444433332222"
    _calendars(mock_backend)
    _detail(mock_backend)
    with pytest.raises(ValueError, match=f"No entry {other} in this calendar.*get_holiday_calendar"):
        await update_holiday_entry(calendar="Switzerland", entry_id=other, label="X", ctx=mock_ctx)
    with pytest.raises(ValueError, match=f"No entry {other} in this calendar"):
        await delete_holiday_entry(calendar="Switzerland", entry_id=other, ctx=mock_ctx)
    assert _writes(mock_backend) == []


async def test_ics_import_passes_the_year_window_and_a_real_run(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    post = mock_backend.post(f"{CALENDARS_URL}/{CAL_ID}/import/ics").mock(
        return_value=httpx.Response(200, json={"dry_run": False, "created": 2, "duplicates": 0,
                                               "skipped": [], "truncated_labels": 0, "entries": []})
    )
    await import_holiday_ics(
        calendar="Switzerland", ics_content="BEGIN:VCALENDAR\nEND:VCALENDAR",
        from_year=2027, to_year=2029, dry_run=False, ctx=mock_ctx,
    )
    params = post.calls[0].request.url.params
    assert dict(params) == {"dry_run": "false", "from_year": "2027", "to_year": "2029"}


async def test_ics_import_sends_only_the_year_bound_given(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    post = mock_backend.post(f"{CALENDARS_URL}/{CAL_ID}/import/ics").mock(
        return_value=httpx.Response(200, json={"dry_run": True, "created": 0, "duplicates": 0,
                                               "skipped": [], "truncated_labels": 0, "entries": []})
    )
    await import_holiday_ics(calendar="Switzerland", ics_content="BEGIN:VCALENDAR", to_year=2030, ctx=mock_ctx)
    assert dict(post.calls[0].request.url.params) == {"dry_run": "true", "to_year": "2030"}


async def test_disable_calendar_deletes_the_switch_without_a_lock(mock_backend, mock_ctx, patch_get_http_request):
    _calendars(mock_backend)
    delete = mock_backend.delete(f"/api/v1/teams/{TEAM_ID}/holiday-calendars/{CAL_ID}").mock(
        return_value=httpx.Response(204)
    )
    result = await disable_team_calendar(team_id=TEAM_ID, calendar="switzerland", ctx=mock_ctx)
    assert delete.call_count == 1
    assert [c.request.method for c in _writes(mock_backend)] == ["DELETE"]
    assert result == {"team_id": TEAM_ID, "calendar": "Switzerland", "enabled": False}
    _no_lock(mock_backend)
