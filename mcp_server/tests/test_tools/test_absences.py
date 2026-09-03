"""The absence tools, including the bulk import path (spec/teams.md §3.4, §8.2.7).

Four properties are the point of the module and each is asserted directly:
members are addressed by name and unknown ones are refused, a write quotes the
ETag from its own read, `delete_absence` is the one destructive team tool, and
the bulk path **replaces** a window rather than appending to it.
"""
import httpx
import pytest

from mcp_server.backend import MCPBackendError
from mcp_server.tools.read import list_absences
from mcp_server.tools.teams import (
    bulk_create_absences,
    create_absence,
    delete_absence,
    preview_bulk_absences,
    update_absence,
)

TEAM_ID = "3f2a1b4c-5d6e-4f70-8192-a3b4c5d6e7f8"
MEMBER_ID = "9a8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d"
ABSENCE_ID = "11112222-3333-4444-5555-666677778888"
ABSENCE_ETAG = '"2026-08-30T10:00:00.000001+00:00"'

MEMBER = {
    "system_id": MEMBER_ID,
    "team_id": TEAM_ID,
    "name": "Aïcha Ben Salah",
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

ABSENCE = {
    "system_id": ABSENCE_ID,
    "team_id": TEAM_ID,
    "member_id": MEMBER_ID,
    "label": "Free Friday",
    "kind": "interval",
    "start_date": "2026-09-04",
    "end_date": None,
    "start_half": "am",
    "end_half": "pm",
    "weekday": 4,
    "halves": ["am"],
    "interval_weeks": 2,
    "summary": "every 2nd Friday am, from 2026-09-04, ongoing",
    "occurrences": [{"date": "2026-09-04", "halves": ["am"]}],
    "created_at": "2026-08-01T00:00:00Z",
    "modified_at": "2026-08-30T10:00:00.000001Z",
    "etag": ABSENCE_ETAG,
}

ABSENCES_URL = f"/api/v1/teams/{TEAM_ID}/absences"


def _members_mock(mock_backend, members=None):
    return mock_backend.get(path__startswith=f"/api/v1/teams/{TEAM_ID}/members").mock(
        return_value=httpx.Response(200, json=[MEMBER] if members is None else members)
    )


def _list_mock(mock_backend, rows=None):
    return mock_backend.get(ABSENCES_URL).mock(
        return_value=httpx.Response(200, json=[ABSENCE] if rows is None else rows)
    )


def _body(mock_backend, method: str) -> dict:
    import json

    matching = [c for c in mock_backend.calls if c.request.method == method]
    return json.loads(matching[-1].request.content)


def _assert_no_lock_calls(mock_backend) -> None:
    """Team writes are outside the single-writer lock, by construction (§4.1)."""
    assert not [c for c in mock_backend.calls if "edit-lock" in str(c.request.url)]


# --- reading ----------------------------------------------------------------


async def test_list_absences_returns_what_the_backend_gave(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    result = await list_absences(team_id=TEAM_ID, ctx=mock_ctx)
    assert result["items"][0]["summary"] == "every 2nd Friday am, from 2026-09-04, ongoing"
    _assert_no_lock_calls(mock_backend)


async def test_list_absences_passes_the_window_through(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    await list_absences(team_id=TEAM_ID, date_from="2026-09-01", date_to="2026-12-31", ctx=mock_ctx)
    params = mock_backend.calls[-1].request.url.params
    assert params["from"] == "2026-09-01"
    assert params["to"] == "2026-12-31"


# --- creating ---------------------------------------------------------------


async def test_create_absence_resolves_names_to_ids(mock_backend, mock_ctx, patch_get_http_request):
    _members_mock(mock_backend)
    mock_backend.post(ABSENCES_URL).mock(return_value=httpx.Response(201, json=[ABSENCE]))

    await create_absence(
        team_id=TEAM_ID,
        member_names=["Aïcha Ben Salah"],
        kind="range",
        start_date="2026-12-25",
        label="Christmas",
        ctx=mock_ctx,
    )
    body = _body(mock_backend, "POST")
    assert body["member_ids"] == [MEMBER_ID]
    assert body["kind"] == "range"
    assert body["label"] == "Christmas"
    # Nothing invented: an unset field is simply absent from the payload.
    assert "weekday" not in body
    _assert_no_lock_calls(mock_backend)


async def test_create_absence_rejects_an_unknown_name_and_lists_who_exists(
    mock_backend, mock_ctx, patch_get_http_request
):
    """Never created implicitly — a typo is far likelier than an intent to hire."""
    _members_mock(mock_backend)
    with pytest.raises(ValueError) as exc:
        await create_absence(
            team_id=TEAM_ID, member_names=["Anders Michel"], kind="range",
            start_date="2026-12-25", ctx=mock_ctx,
        )
    assert "Aïcha Ben Salah" in str(exc.value)
    assert not [c for c in mock_backend.calls if c.request.method == "POST"]


async def test_create_absence_sends_a_recurring_rule_whole(mock_backend, mock_ctx, patch_get_http_request):
    _members_mock(mock_backend)
    mock_backend.post(ABSENCES_URL).mock(return_value=httpx.Response(201, json=[ABSENCE]))

    await create_absence(
        team_id=TEAM_ID, member_names=["Aïcha Ben Salah"], kind="interval",
        start_date="2026-09-04", weekday=4, halves=["am"], interval_weeks=2, ctx=mock_ctx,
    )
    body = _body(mock_backend, "POST")
    assert body["weekday"] == 4
    assert body["halves"] == ["am"]
    assert body["interval_weeks"] == 2


async def test_create_absence_takes_no_if_match(mock_backend, mock_ctx, patch_get_http_request):
    """A create cannot clobber (§4.2)."""
    _members_mock(mock_backend)
    mock_backend.post(ABSENCES_URL).mock(return_value=httpx.Response(201, json=[ABSENCE]))
    await create_absence(
        team_id=TEAM_ID, member_names=["Aïcha Ben Salah"], kind="range",
        start_date="2026-12-25", ctx=mock_ctx,
    )
    assert "If-Match" not in mock_backend.calls[-1].request.headers


# --- updating and deleting --------------------------------------------------


async def test_update_absence_quotes_the_etag_from_its_own_read(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_mock(mock_backend)
    mock_backend.patch(f"{ABSENCES_URL}/{ABSENCE_ID}").mock(
        return_value=httpx.Response(200, json=ABSENCE)
    )
    await update_absence(team_id=TEAM_ID, absence_id=ABSENCE_ID, label="Fridays off", ctx=mock_ctx)

    patch_call = [c for c in mock_backend.calls if c.request.method == "PATCH"][-1]
    assert patch_call.request.headers["If-Match"] == ABSENCE_ETAG
    assert _body(mock_backend, "PATCH") == {"label": "Fridays off"}


async def test_update_absence_retries_once_on_a_stale_row(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    route = mock_backend.patch(f"{ABSENCES_URL}/{ABSENCE_ID}").mock(
        side_effect=[
            httpx.Response(412, json={"detail": {"error": "STALE", "message": "changed"}}),
            httpx.Response(200, json=ABSENCE),
        ]
    )
    result = await update_absence(team_id=TEAM_ID, absence_id=ABSENCE_ID, label="x", ctx=mock_ctx)
    assert result["system_id"] == ABSENCE_ID
    assert route.call_count == 2


async def test_update_absence_refuses_an_id_the_team_does_not_hold(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_mock(mock_backend, rows=[])
    with pytest.raises(ValueError) as exc:
        await update_absence(team_id=TEAM_ID, absence_id=ABSENCE_ID, label="x", ctx=mock_ctx)
    assert "list_absences" in str(exc.value)


async def test_delete_absence_removes_the_series(mock_backend, mock_ctx, patch_get_http_request):
    _list_mock(mock_backend)
    mock_backend.delete(f"{ABSENCES_URL}/{ABSENCE_ID}").mock(return_value=httpx.Response(204))

    assert await delete_absence(team_id=TEAM_ID, absence_id=ABSENCE_ID, ctx=mock_ctx) == {
        "deleted": ABSENCE_ID
    }
    delete_call = [c for c in mock_backend.calls if c.request.method == "DELETE"][-1]
    assert delete_call.request.headers["If-Match"] == ABSENCE_ETAG
    _assert_no_lock_calls(mock_backend)


async def test_delete_absence_surfaces_a_conflict_rather_than_swallowing_it(
    mock_backend, mock_ctx, patch_get_http_request
):
    _list_mock(mock_backend)
    mock_backend.delete(f"{ABSENCES_URL}/{ABSENCE_ID}").mock(
        return_value=httpx.Response(403, json={"detail": "Forbidden"})
    )
    with pytest.raises(MCPBackendError):
        await delete_absence(team_id=TEAM_ID, absence_id=ABSENCE_ID, ctx=mock_ctx)


# --- bulk -------------------------------------------------------------------


BULK_RESULT = {
    "dry_run": False,
    "window_from": "2026-12-01",
    "window_to": "2026-12-31",
    "created": 6,
    "deleted": 6,
    "unresolved_names": [],
    "absences": [],
}

ENTRIES = [
    {"member_names": ["Aïcha Ben Salah"], "kind": "range", "start_date": "2026-12-25",
     "label": "Christmas"},
]


async def test_bulk_create_replaces_a_window(mock_backend, mock_ctx, patch_get_http_request):
    """Re-reading the source page must not double every absence (§8.2.7)."""
    mock_backend.post(f"{ABSENCES_URL}/bulk").mock(return_value=httpx.Response(200, json=BULK_RESULT))

    result = await bulk_create_absences(
        team_id=TEAM_ID, window_from="2026-12-01", window_to="2026-12-31",
        entries=ENTRIES, ctx=mock_ctx,
    )
    assert result["created"] == 6
    body = _body(mock_backend, "POST")
    assert body["dry_run"] is False
    assert body["window_from"] == "2026-12-01"
    assert body["entries"] == ENTRIES
    _assert_no_lock_calls(mock_backend)


async def test_preview_writes_nothing_and_says_so(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post(f"{ABSENCES_URL}/bulk").mock(
        return_value=httpx.Response(200, json={**BULK_RESULT, "dry_run": True, "absences": []})
    )
    result = await preview_bulk_absences(
        team_id=TEAM_ID, window_from="2026-12-01", window_to="2026-12-31",
        entries=ENTRIES, ctx=mock_ctx,
    )
    assert result["dry_run"] is True
    assert _body(mock_backend, "POST")["dry_run"] is True


async def test_preview_reports_every_unresolved_name_at_once(
    mock_backend, mock_ctx, patch_get_http_request
):
    """Spelling variants arrive in groups; one per round-trip is unusable (§8.2.7)."""
    mock_backend.post(f"{ABSENCES_URL}/bulk").mock(
        return_value=httpx.Response(
            200,
            json={
                **BULK_RESULT,
                "dry_run": True,
                "created": 0,
                "deleted": 0,
                "unresolved_names": ["Anders Michel", "Katrin H"],
            },
        )
    )
    result = await preview_bulk_absences(
        team_id=TEAM_ID, window_from="2026-12-01", window_to="2026-12-31",
        entries=ENTRIES, ctx=mock_ctx,
    )
    assert result["unresolved_names"] == ["Anders Michel", "Katrin H"]
    assert result["created"] == 0
