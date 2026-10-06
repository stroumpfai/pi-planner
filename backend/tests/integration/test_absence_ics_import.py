"""Importing absences from a calendar file (spec/teams.md §7.4.1, ADR 0011).

The mapping from events to rules is unit-tested in `tests/unit/test_absence_ics.py`.
What these tests watch is the import around it: the preview that writes nothing,
the upsert on the event's UID, removals fenced by window and by member, the
choices an apply sends being checked against the file, and — the reason the
feature exists — the capacity figure going down.
"""
import json
from datetime import date

import pytest

from app.models.team import Absence
from app.schemas import MAX_ABSENCES_PER_MEMBER
from app.services.events import broadcaster, team_channel
from app.services.ics import MAX_ICS_BYTES

_TEAMS = "/api/v1/teams"


def _url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/absences"


def _import_url(team_id: str) -> str:
    return f"{_url(team_id)}/import/ics"


def _ics(*events: str) -> bytes:
    body = "\r\n".join(events)
    return (
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
        f"{body}\r\nEND:VCALENDAR\r\n"
    ).encode()


def _event(uid: str, summary: str, *lines: str) -> str:
    return "\r\n".join(["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{summary}", *lines, "END:VEVENT"])


def _day(uid: str, summary: str, day: str, *lines: str) -> str:
    return _event(uid, summary, f"DTSTART;VALUE=DATE:{day}", *lines)


_WEEK = _event("week@x", "Vacation", "DTSTART;VALUE=DATE:20261102", "DTEND;VALUE=DATE:20261107")
_MEETING = _event("meet@x", "Sprint review", "DTSTART:20261110T100000", "DTEND:20261110T110000")
_FRIDAYS = _event("fri@x", "Off Fridays", "DTSTART;VALUE=DATE:20261106", "RRULE:FREQ=WEEKLY;INTERVAL=2")


async def _import(client, team_id: str, content: bytes, *, form: dict | None = None, **params):
    return await client.post(
        _import_url(team_id),
        files={"file": ("cal.ics", content, "text/calendar")},
        data={key: json.dumps(value) for key, value in (form or {}).items()},
        params=params,
    )


async def _preview(client, team_id: str, content: bytes, **params) -> dict:
    resp = await _import(client, team_id, content, **params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dry_run"] is True
    return body


async def _apply(client, team_id: str, content: bytes, *, form: dict | None = None, **params) -> dict:
    resp = await _import(client, team_id, content, form=form, dry_run="false", **params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _member(client, team_id: str, name: str) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01"}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _absences(client, team_id: str) -> list[dict]:
    resp = await client.get(_url(team_id), params={"from": "2026-01-01", "to": "2027-12-31"})
    assert resp.status_code == 200
    return resp.json()


@pytest.fixture
async def team(client) -> dict:
    resp = await client.post(_TEAMS, json={"name": "Platform"})
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture
async def anna(client, team) -> dict:
    return await _member(client, team["system_id"], "Anna Keller")


@pytest.fixture
async def ben(client, team) -> dict:
    return await _member(client, team["system_id"], "Ben Ott")


# ── Preview ───────────────────────────────────────────────────────────────────

async def test_a_preview_writes_nothing_and_lists_what_it_would(client, team, anna):
    tid = team["system_id"]
    body = await _preview(client, tid, _ics(_WEEK, _MEETING, _FRIDAYS), member_id=anna["system_id"])

    assert await _absences(client, tid) == []
    by_uid = {c["source_uid"]: c for c in body["candidates"]}
    assert by_uid["week@x"]["action"] == "create"
    assert by_uid["week@x"]["match"] == "picked"
    assert by_uid["week@x"]["rule_summary"] == "2026-11-02 – 2026-11-06, from am to pm"
    assert by_uid["meet@x"]["selected_by_default"] is False
    assert by_uid["fri@x"]["rule"]["kind"] == "interval"
    assert (by_uid["week@x"]["repeats"], by_uid["fri@x"]["repeats"]) == ("single", "weekly")
    # The default ticks: the week and the Fridays, not the meeting.
    assert (body["created"], body["updated"], body["deleted"]) == (2, 0, 0)
    # The window is the file's span, handed back for the apply to send again.
    assert (body["window_from"], body["window_to"]) == ("2026-11-02", "2026-11-10")


async def test_skipped_events_are_reported_with_their_reason(client, team, anna):
    body = await _preview(
        client, team["system_id"],
        _ics(_WEEK, _day("daily@x", "Gym", "20261102", "RRULE:FREQ=DAILY")),
        member_id=anna["system_id"],
    )
    assert [s["summary"] for s in body["skipped"]] == ["Gym"]


async def test_an_unreadable_file_is_refused(client, team, anna):
    resp = await _import(client, team["system_id"], b"not a calendar", member_id=anna["system_id"])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_ICS"


async def test_a_file_over_the_size_cap_is_refused(client, team, anna):
    resp = await _import(client, team["system_id"], b"x" * (MAX_ICS_BYTES + 1), member_id=anna["system_id"])
    assert resp.status_code == 413
    assert resp.json()["detail"]["error"] == "ICS_TOO_LARGE"


async def test_half_a_window_is_refused(client, team, anna):
    resp = await _import(client, team["system_id"], _ics(_WEEK), member_id=anna["system_id"],
                         window_from="2026-11-01")
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_WINDOW"


# ── Apply, and re-import ──────────────────────────────────────────────────────

async def test_an_apply_without_choices_writes_the_default_ticks(client, team, anna):
    tid = team["system_id"]
    result = await _apply(client, tid, _ics(_WEEK, _MEETING, _FRIDAYS), member_id=anna["system_id"])

    assert (result["created"], result["updated"], result["deleted"]) == (2, 0, 0)
    rows = await _absences(client, tid)
    assert sorted(r["source_uid"] for r in rows) == ["fri@x", "week@x"]
    assert all(r["member_id"] == anna["system_id"] for r in rows)


async def test_an_apply_writes_exactly_the_ticked_rows(client, team, anna):
    tid = team["system_id"]
    result = await _apply(
        client, tid, _ics(_WEEK, _MEETING, _FRIDAYS), member_id=anna["system_id"],
        form={"selections": [{"source_uid": "meet@x", "member_id": anna["system_id"]}]},
    )
    assert result["created"] == 1
    assert [r["source_uid"] for r in await _absences(client, tid)] == ["meet@x"]


async def test_reimporting_the_same_file_changes_nothing(client, team, anna):
    tid = team["system_id"]
    content = _ics(_WEEK, _FRIDAYS)
    await _apply(client, tid, content, member_id=anna["system_id"])
    before = await _absences(client, tid)

    preview = await _preview(client, tid, content, member_id=anna["system_id"])
    assert {c["action"] for c in preview["candidates"]} == {"unchanged"}
    result = await _apply(client, tid, content, member_id=anna["system_id"])

    assert (result["created"], result["updated"], result["unchanged"], result["deleted"]) == (0, 0, 2, 0)
    assert [r["modified_at"] for r in await _absences(client, tid)] == [r["modified_at"] for r in before]


async def test_a_moved_event_updates_its_row(client, team, anna):
    tid = team["system_id"]
    await _apply(client, tid, _ics(_WEEK), member_id=anna["system_id"])
    [original] = await _absences(client, tid)

    moved = _event("week@x", "Vacation", "DTSTART;VALUE=DATE:20261109", "DTEND;VALUE=DATE:20261114")
    preview = await _preview(client, tid, _ics(moved), member_id=anna["system_id"])
    [candidate] = preview["candidates"]
    assert candidate["action"] == "update"
    assert candidate["previous"]["start_date"] == "2026-11-02"

    await _apply(client, tid, _ics(moved), member_id=anna["system_id"])
    [row] = await _absences(client, tid)
    assert row["system_id"] == original["system_id"]
    assert (row["start_date"], row["end_date"]) == ("2026-11-09", "2026-11-13")


async def test_an_event_gone_from_the_file_is_proposed_for_removal(client, team, anna):
    tid = team["system_id"]
    await _apply(client, tid, _ics(_WEEK, _day("dr@x", "Doctor", "20261104")), member_id=anna["system_id"])
    gone = next(r for r in await _absences(client, tid) if r["source_uid"] == "dr@x")

    preview = await _preview(client, tid, _ics(_WEEK), member_id=anna["system_id"],
                             window_from="2026-11-01", window_to="2026-11-30")
    assert [r["system_id"] for r in preview["removals"]] == [gone["system_id"]]

    # Unticked: kept.
    kept = await _apply(client, tid, _ics(_WEEK), member_id=anna["system_id"],
                        window_from="2026-11-01", window_to="2026-11-30", form={"removals": []})
    assert kept["deleted"] == 0
    assert len(await _absences(client, tid)) == 2

    # Ticked: deleted.
    done = await _apply(client, tid, _ics(_WEEK), member_id=anna["system_id"],
                        window_from="2026-11-01", window_to="2026-11-30",
                        form={"removals": [gone["system_id"]]})
    assert done["deleted"] == 1
    assert [r["source_uid"] for r in await _absences(client, tid)] == ["week@x"]


async def test_a_hand_entered_absence_is_never_proposed_for_removal(client, team, anna):
    tid = team["system_id"]
    resp = await client.post(_url(tid), json={
        "member_ids": [anna["system_id"]], "kind": "range", "start_date": "2026-11-20",
    })
    assert resp.status_code == 201
    preview = await _preview(client, tid, _ics(_WEEK), member_id=anna["system_id"],
                             window_from="2026-11-01", window_to="2026-11-30")
    assert preview["removals"] == []


async def test_removal_is_fenced_by_the_window(client, team, anna):
    tid = team["system_id"]
    await _apply(client, tid, _ics(_day("old@x", "Old", "20260615")), member_id=anna["system_id"])
    preview = await _preview(client, tid, _ics(_WEEK), member_id=anna["system_id"])
    # The default window is November, the file's own span; June is outside it.
    assert preview["removals"] == []


async def test_removal_is_fenced_by_the_members_this_import_involves(client, team, anna, ben):
    tid = team["system_id"]
    await _apply(client, tid, _ics(_day("ben@x", "Ben off", "20261104")), member_id=ben["system_id"])
    preview = await _preview(client, tid, _ics(_WEEK), member_id=anna["system_id"],
                             window_from="2026-11-01", window_to="2026-11-30")
    assert preview["removals"] == []


async def test_a_removal_outside_the_proposed_set_is_refused_as_stale(client, team, anna):
    tid = team["system_id"]
    resp = await _import(client, tid, _ics(_WEEK), member_id=anna["system_id"], dry_run="false",
                         form={"removals": ["not-a-proposed-row"]})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "IMPORT_STALE"
    assert await _absences(client, tid) == []


async def test_a_selection_naming_an_event_not_in_the_file_is_refused(client, team, anna):
    tid = team["system_id"]
    resp = await _import(client, tid, _ics(_WEEK), member_id=anna["system_id"], dry_run="false",
                         form={"selections": [{"source_uid": "ghost@x", "member_id": anna["system_id"]}]})
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "UNKNOWN_EVENT"
    assert resp.json()["detail"]["source_uids"] == ["ghost@x"]


async def test_a_hand_edit_survives_until_the_next_import_of_its_event(client, team, anna):
    tid = team["system_id"]
    await _apply(client, tid, _ics(_WEEK), member_id=anna["system_id"])
    [row] = await _absences(client, tid)
    resp = await client.patch(f"{_url(tid)}/{row['system_id']}", json={"label": "Edited"},
                              headers={"If-Match": row["etag"]})
    assert resp.status_code == 200
    assert resp.json()["source_uid"] == "week@x"

    preview = await _preview(client, tid, _ics(_WEEK), member_id=anna["system_id"])
    assert preview["candidates"][0]["action"] == "update"


# ── Team files, matched by name ───────────────────────────────────────────────

async def test_a_team_file_matches_attendees_and_titles(client, team, anna, ben):
    tid = team["system_id"]
    content = _ics(
        _day("a@x", "Vacation", "20261102", "ATTENDEE;CN=Anna Keller:mailto:a@example.com"),
        _day("b@x", "Ott Ben – leave", "20261103"),
        _day("c@x", "Someone else", "20261104"),
    )
    preview = await _preview(client, tid, content)
    by_uid = {c["source_uid"]: c for c in preview["candidates"]}
    assert (by_uid["a@x"]["member_id"], by_uid["a@x"]["match"]) == (anna["system_id"], "attendee")
    assert (by_uid["b@x"]["member_id"], by_uid["b@x"]["match"]) == (ben["system_id"], "title")
    assert (by_uid["c@x"]["member_id"], by_uid["c@x"]["action"]) == (None, None)
    # Someone else's, most likely: offered for assigning, but unticked.
    assert by_uid["c@x"]["selected_by_default"] is False

    # The unresolved event is given to Ben by hand.
    result = await _apply(client, tid, content, form={"selections": [
        {"source_uid": "a@x", "member_id": anna["system_id"]},
        {"source_uid": "b@x", "member_id": ben["system_id"]},
        {"source_uid": "c@x", "member_id": ben["system_id"]},
    ]})
    assert result["created"] == 3
    owners = {r["source_uid"]: r["member_id"] for r in await _absences(client, tid)}
    assert owners == {"a@x": anna["system_id"], "b@x": ben["system_id"], "c@x": ben["system_id"]}


async def test_a_yearly_event_is_offered_unticked_and_left_out_by_default(client, team, anna):
    tid = team["system_id"]
    birthday = _day("bday@x", "Birthday", "20200315", "RRULE:FREQ=YEARLY")
    body = await _preview(client, tid, _ics(_WEEK, birthday), member_id=anna["system_id"])
    yearly = [c for c in body["candidates"] if c["repeats"] == "yearly"]
    assert yearly and not any(c["selected_by_default"] for c in yearly)

    await _apply(client, tid, _ics(_WEEK, birthday), member_id=anna["system_id"])
    assert [r["source_uid"] for r in await _absences(client, tid)] == ["week@x"]


async def test_an_apply_without_choices_leaves_unresolved_events_out(client, team, anna):
    tid = team["system_id"]
    result = await _apply(client, tid, _ics(_day("c@x", "Someone else", "20261104")))
    assert result["created"] == 0
    assert await _absences(client, tid) == []


async def test_an_event_naming_two_members_is_one_row_each(client, team, anna, ben):
    tid = team["system_id"]
    content = _ics(_day("off@x", "Offsite", "20261105",
                        "ATTENDEE;CN=Anna Keller:mailto:a@example.com",
                        "ATTENDEE;CN=Ben Ott:mailto:b@example.com"))
    result = await _apply(client, tid, content)
    assert result["created"] == 2
    assert sorted(r["member_id"] for r in await _absences(client, tid)) == sorted(
        [anna["system_id"], ben["system_id"]]
    )


# ── Guards ────────────────────────────────────────────────────────────────────

async def test_a_reader_cannot_import(client, reader_client, team, anna):
    resp = await _import(reader_client, team["system_id"], _ics(_WEEK), member_id=anna["system_id"])
    assert resp.status_code == 403


async def test_an_anonymous_caller_cannot_import(client, team, anna):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as anon:
        resp = await _import(anon, team["system_id"], _ics(_WEEK), member_id=anna["system_id"])
    assert resp.status_code == 401


async def test_an_unknown_team_is_404(client):
    resp = await _import(client, "no-such-team", _ics(_WEEK))
    assert resp.status_code == 404


async def test_a_member_from_another_team_is_404(client, team, anna):
    other = (await client.post(_TEAMS, json={"name": "Other"})).json()
    stranger = await _member(client, other["system_id"], "Carl Stranger")
    resp = await _import(client, team["system_id"], _ics(_WEEK), member_id=stranger["system_id"])
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "MEMBER_NOT_FOUND"

    resp = await _import(client, team["system_id"], _ics(_WEEK), dry_run="false",
                         form={"selections": [{"source_uid": "week@x", "member_id": stranger["system_id"]}]})
    assert resp.status_code == 404


async def test_the_absence_limit_is_enforced_net_of_removals(client, team, anna, db):
    tid = team["system_id"]
    db.add_all([
        Absence(team_id=tid, member_id=anna["system_id"], kind="range",
                start_date=date(2025, 1, 1), source_uid=f"old{i}")
        for i in range(MAX_ABSENCES_PER_MEMBER)
    ])
    await db.commit()

    # Full: one more is refused…
    resp = await _import(client, tid, _ics(_WEEK), member_id=anna["system_id"], dry_run="false")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ABSENCE_LIMIT_REACHED"

    # …unless the same import removes one.
    window = {"window_from": "2025-01-01", "window_to": "2026-12-31"}
    preview = await _preview(client, tid, _ics(_WEEK), member_id=anna["system_id"], **window)
    result = await _apply(client, tid, _ics(_WEEK), member_id=anna["system_id"], **window, form={
        "selections": [{"source_uid": "week@x", "member_id": anna["system_id"]}],
        "removals": [preview["removals"][0]["system_id"]],
    })
    assert (result["created"], result["deleted"]) == (1, 1)


# ── Events, and the number going down ─────────────────────────────────────────

async def test_an_apply_broadcasts_once_and_a_preview_never(client, team, anna):
    queue = broadcaster._subscribe(team_channel(team["system_id"]))
    await _preview(client, team["system_id"], _ics(_WEEK), member_id=anna["system_id"])
    assert queue.empty()

    await _apply(client, team["system_id"], _ics(_WEEK), member_id=anna["system_id"])
    event = await queue.get()
    assert event["type"] == "team:absence:bulk"
    assert queue.empty()


async def test_an_imported_absence_reduces_capacity_like_any_other(client, team, anna):
    tid = team["system_id"]
    project = (await client.post("/api/v1/projects/", json={"name": "ISK"})).json()
    pi = (await client.post(f"/api/v1/projects/{project['system_id']}/pis",
                            json={"name": "PI 7", "start_date": "2026-09-07"})).json()
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    first = next(s for s in sprints if s["sprint_index"] == 0)
    await client.patch(f"/api/v1/sprints/{first['system_id']}",
                       json={"start_date": "2026-09-07", "end_date": "2026-09-11"})
    await client.post(f"{_TEAMS}/{tid}/projects", json={"project_id": project["system_id"]})

    # Wednesday all day, and Thursday morning out of office.
    await _apply(client, tid, _ics(
        _day("wed@x", "Leave", "20260909"),
        _event("thu@x", "Doctor", "DTSTART:20260910T080000", "DTEND:20260910T120000",
               "X-MICROSOFT-CDO-BUSYSTATUS:OOF"),
    ), member_id=anna["system_id"])

    cell = (await client.get(f"{_TEAMS}/{tid}/capacity")).json()["members"][0]["cells"][0]
    assert cell["absent_half_days"] == 3
    assert cell["person_days"] == pytest.approx(3.5)
