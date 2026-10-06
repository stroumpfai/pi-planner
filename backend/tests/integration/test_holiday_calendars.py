"""Shared holiday calendars, end to end (spec/public-holidays.md).

The engine's precedence and union rules are unit-tested in
`tests/unit/test_team_capacity.py`; these watch the calendars, the team's switch,
the exceptions, and the places a holiday shows up — capacity, the strip's feed,
the PI board's chips, and the cleanup.

The sprint is 6–17 April 2026: ten weekdays, so a full-time 8 h member has 80 h
and 10 PD. Easter Monday, 6 April, is its first day.
"""
import pytest

_TEAMS = "/api/v1/teams"
_CALENDARS = "/api/v1/holiday-calendars"
EASTER_MONDAY = "2026-04-06"


async def _calendar(client, name: str = "Switzerland") -> dict:
    resp = await client.post(_CALENDARS, json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _entry(client, calendar_id: str, label: str, start: str, end: str | None = None, **halves) -> dict:
    body = {"label": label, "start_date": start, **halves}
    if end is not None:
        body["end_date"] = end
    resp = await client.post(f"{_CALENDARS}/{calendar_id}/entries", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _enable(client, team_id: str, calendar_id: str) -> None:
    resp = await client.put(f"{_TEAMS}/{team_id}/holiday-calendars/{calendar_id}")
    assert resp.status_code == 204, resp.text


async def _member(client, team_id: str, name: str, **pattern) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01", **pattern}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _capacity_cell(client, team_id: str, member_index: int = 0) -> dict:
    resp = await client.get(f"{_TEAMS}/{team_id}/capacity")
    assert resp.status_code == 200, resp.text
    return resp.json()["members"][member_index]["cells"][0]


async def _exception(client, team_id: str, member_id: str, entry_id: str, day: str, *, works: bool = True):
    url = f"{_TEAMS}/{team_id}/members/{member_id}/holiday-exceptions/{entry_id}/{day}"
    return await (client.put(url) if works else client.delete(url))


@pytest.fixture
async def project(client) -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": "Portal"})
    return resp.json()


@pytest.fixture
async def pi(client, project) -> dict:
    """A PI whose first sprint is 6–17 April 2026; the other four stay undated."""
    pi = (await client.post(
        f"/api/v1/projects/{project['system_id']}/pis", json={"name": "PI 08"}
    )).json()
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    first = next(s for s in sprints if s["sprint_index"] == 0)
    resp = await client.patch(
        f"/api/v1/sprints/{first['system_id']}",
        json={"start_date": "2026-04-06", "end_date": "2026-04-17"},
    )
    assert resp.status_code == 200, resp.text
    return pi


@pytest.fixture
async def team(client, project, pi) -> dict:
    """A team serving the project, so its first column is the dated sprint."""
    team = (await client.post(_TEAMS, json={"name": "Platform"})).json()
    resp = await client.post(
        f"{_TEAMS}/{team['system_id']}/projects", json={"project_id": project["system_id"]}
    )
    assert resp.status_code == 201, resp.text
    return team


# ── Calendars ─────────────────────────────────────────────────────────────────

async def test_calendar_names_are_unique_ignoring_case(client):
    await _calendar(client, "Switzerland")
    clash = await client.post(_CALENDARS, json={"name": "  switzerland "})
    assert clash.status_code == 409
    assert clash.json()["detail"]["error"] == "CALENDAR_NAME_TAKEN"


async def test_a_calendar_lists_its_years_entries_and_teams(client, team):
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "New Year", "2026-01-01")
    await _entry(client, calendar["system_id"], "New Year", "2027-01-01")
    await _enable(client, team["system_id"], calendar["system_id"])

    listed = (await client.get(_CALENDARS)).json()
    assert listed[0]["entry_count"] == 2
    assert (listed[0]["first_year"], listed[0]["last_year"]) == (2026, 2027)
    assert [t["name"] for t in listed[0]["teams"]] == ["Platform"]

    one_year = (await client.get(f"{_CALENDARS}/{calendar['system_id']}", params={"year": 2027})).json()
    assert [e["start_date"] for e in one_year["entries"]] == ["2027-01-01"]


async def test_renaming_needs_the_current_etag(client):
    calendar = await _calendar(client)
    url = f"{_CALENDARS}/{calendar['system_id']}"
    ok = await client.patch(url, json={"name": "CH"}, headers={"If-Match": calendar["etag"]})
    assert ok.status_code == 200, ok.text
    stale = await client.patch(url, json={"name": "CH-2"}, headers={"If-Match": calendar["etag"]})
    assert stale.status_code == 412


async def test_a_reader_reads_calendars_but_cannot_write_them(client, reader_client):
    await _calendar(client)
    assert (await reader_client.get(_CALENDARS)).status_code == 200
    assert (await reader_client.post(_CALENDARS, json={"name": "Nope"})).status_code == 403


async def test_an_entry_cannot_end_before_it_starts(client):
    calendar = await _calendar(client)
    resp = await client.post(
        f"{_CALENDARS}/{calendar['system_id']}/entries",
        json={"label": "Backwards", "start_date": "2026-04-06", "end_date": "2026-04-05"},
    )
    assert resp.status_code == 422


# ── Capacity ──────────────────────────────────────────────────────────────────

async def test_an_enabled_holiday_removes_capacity_and_is_reported_apart(client, team):
    await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)

    before = await _capacity_cell(client, team["system_id"])
    assert before["person_days"] == pytest.approx(10.0)

    await _enable(client, team["system_id"], calendar["system_id"])
    after = await _capacity_cell(client, team["system_id"])
    assert after["absent_half_days"] == 2
    assert after["holiday_half_days"] == 2
    assert after["person_days"] == pytest.approx(9.0)


async def test_a_disabled_calendar_costs_nothing(client, team):
    await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _enable(client, team["system_id"], calendar["system_id"])
    resp = await client.delete(f"{_TEAMS}/{team['system_id']}/holiday-calendars/{calendar['system_id']}")
    assert resp.status_code == 204

    cell = await _capacity_cell(client, team["system_id"])
    assert cell["holiday_half_days"] == 0
    assert cell["person_days"] == pytest.approx(10.0)


async def test_leave_on_a_holiday_counts_once_as_holiday(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    resp = await client.post(f"{_TEAMS}/{team['system_id']}/absences", json={
        "member_ids": [alice["system_id"]], "kind": "range",
        "start_date": EASTER_MONDAY, "end_date": "2026-04-07",
    })
    assert resp.status_code == 201, resp.text
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _enable(client, team["system_id"], calendar["system_id"])

    cell = await _capacity_cell(client, team["system_id"])
    assert cell["absent_half_days"] == 4      # Monday and Tuesday, once each
    assert cell["holiday_half_days"] == 2     # Monday is the holiday's, not the leave's
    assert cell["person_days"] == pytest.approx(8.0)


async def test_working_a_holiday_restores_that_day_and_survives_a_toggle(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    entry = await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _enable(client, team["system_id"], calendar["system_id"])

    resp = await _exception(client, team["system_id"], alice["system_id"], entry["system_id"], EASTER_MONDAY)
    assert resp.status_code == 204, resp.text
    assert (await _capacity_cell(client, team["system_id"]))["person_days"] == pytest.approx(10.0)

    switch = f"{_TEAMS}/{team['system_id']}/holiday-calendars/{calendar['system_id']}"
    await client.delete(switch)
    await client.put(switch)
    holidays = (await client.get(f"{_TEAMS}/{team['system_id']}/holidays",
                                 params={"from": "2026-04-01", "to": "2026-04-30"})).json()
    assert holidays["entries"][0]["exceptions"] == [{"member_id": alice["system_id"], "day": EASTER_MONDAY}]
    assert (await _capacity_cell(client, team["system_id"]))["person_days"] == pytest.approx(10.0)


async def test_an_exception_needs_the_calendar_enabled_and_a_day_of_the_holiday(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    entry = await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)

    not_enabled = await _exception(client, team["system_id"], alice["system_id"], entry["system_id"], EASTER_MONDAY)
    assert not_enabled.status_code == 409
    await _enable(client, team["system_id"], calendar["system_id"])
    wrong_day = await _exception(client, team["system_id"], alice["system_id"], entry["system_id"], "2026-04-07")
    assert wrong_day.status_code == 422


async def test_two_calendars_on_one_day_union(client, team):
    await _member(client, team["system_id"], "Alice")
    national = await _calendar(client, "National")
    company = await _calendar(client, "Company")
    await _entry(client, national["system_id"], "Easter Monday", EASTER_MONDAY)
    await _entry(client, company["system_id"], "Office closed", EASTER_MONDAY)
    await _enable(client, team["system_id"], national["system_id"])
    await _enable(client, team["system_id"], company["system_id"])

    cell = await _capacity_cell(client, team["system_id"])
    assert cell["holiday_half_days"] == 2
    holidays = (await client.get(f"{_TEAMS}/{team['system_id']}/holidays",
                                 params={"from": "2026-04-01", "to": "2026-04-30"})).json()
    assert sorted(e["calendar_name"] for e in holidays["entries"]) == ["Company", "National"]


async def test_a_half_day_holiday_costs_half_a_day(client, team):
    await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Afternoon off", "2026-04-08", start_half="pm")
    await _enable(client, team["system_id"], calendar["system_id"])
    cell = await _capacity_cell(client, team["system_id"])
    assert cell["holiday_half_days"] == 1
    assert cell["person_days"] == pytest.approx(9.5)


async def test_moving_an_entry_drops_exceptions_it_no_longer_covers(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    entry = await _entry(client, calendar["system_id"], "Shutdown", "2026-04-06", "2026-04-08")
    await _enable(client, team["system_id"], calendar["system_id"])
    await _exception(client, team["system_id"], alice["system_id"], entry["system_id"], "2026-04-08")

    url = f"{_CALENDARS}/{calendar['system_id']}/entries/{entry['system_id']}"
    resp = await client.patch(url, json={"end_date": "2026-04-07"}, headers={"If-Match": entry["etag"]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["exception_days"] == []


# ── Bulk replace ──────────────────────────────────────────────────────────────

async def test_bulk_replace_keeps_exceptions_on_unchanged_entries(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    easter = await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _entry(client, calendar["system_id"], "Old holiday", "2026-04-09")
    await _enable(client, team["system_id"], calendar["system_id"])
    await _exception(client, team["system_id"], alice["system_id"], easter["system_id"], EASTER_MONDAY)

    body = {
        "window_from": "2026-01-01", "window_to": "2026-12-31",
        "entries": [
            {"label": "easter monday", "start_date": EASTER_MONDAY},
            {"label": "May Day", "start_date": "2026-05-01"},
        ],
    }
    url = f"{_CALENDARS}/{calendar['system_id']}/entries"
    preview = (await client.put(url, json={**body, "dry_run": True})).json()
    assert preview == {
        "dry_run": True, "created": 2, "deleted": 2, "exceptions_kept": 1, "exceptions_dropped": 0,
    }
    assert (await client.get(f"{_CALENDARS}/{calendar['system_id']}")).json()["entry_count"] == 2

    resp = await client.put(url, json=body)
    assert resp.status_code == 200, resp.text
    holidays = (await client.get(f"{_TEAMS}/{team['system_id']}/holidays",
                                 params={"from": "2026-04-01", "to": "2026-04-30"})).json()
    assert [e["label"] for e in holidays["entries"]] == ["easter monday"]
    assert holidays["entries"][0]["exceptions"] == [{"member_id": alice["system_id"], "day": EASTER_MONDAY}]


async def test_bulk_replace_refuses_an_entry_outside_its_window(client):
    calendar = await _calendar(client)
    resp = await client.put(f"{_CALENDARS}/{calendar['system_id']}/entries", json={
        "window_from": "2026-01-01", "window_to": "2026-12-31",
        "entries": [{"label": "Next year", "start_date": "2027-01-01"}],
    })
    assert resp.status_code == 422


# ── Copy year ─────────────────────────────────────────────────────────────────

async def test_copy_year_proposes_the_same_dates_and_flags_weekends(client):
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Christmas", "2026-12-25")   # a Friday
    await _entry(client, calendar["system_id"], "National day", "2026-08-01")  # 2027-08-01 is a Sunday
    url = f"{_CALENDARS}/{calendar['system_id']}/copy-year"

    preview = (await client.get(url, params={"from_year": 2026})).json()
    by_label = {p["label"]: p for p in preview["proposals"]}
    assert by_label["Christmas"]["start_date"] == "2027-12-25"
    assert by_label["National day"]["on_weekend"] is True

    reviewed = [
        {k: p[k] for k in ("label", "start_date", "start_half", "end_date", "end_half")}
        for p in preview["proposals"]
    ]
    first = (await client.post(url, json={"entries": reviewed})).json()
    assert first == {"created": 2, "duplicates": 0}
    again = (await client.post(url, json={"entries": reviewed})).json()
    assert again == {"created": 0, "duplicates": 2}


# ── Deleting ──────────────────────────────────────────────────────────────────

async def test_deleting_a_calendar_removes_it_from_every_team(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    entry = await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _enable(client, team["system_id"], calendar["system_id"])
    await _exception(client, team["system_id"], alice["system_id"], entry["system_id"], EASTER_MONDAY)

    resp = await client.delete(f"{_CALENDARS}/{calendar['system_id']}", headers={"If-Match": calendar["etag"]})
    assert resp.status_code == 204, resp.text
    holidays = (await client.get(f"{_TEAMS}/{team['system_id']}/holidays")).json()
    assert holidays["enabled_calendar_ids"] == []
    assert (await _capacity_cell(client, team["system_id"]))["person_days"] == pytest.approx(10.0)


async def test_deleting_a_member_or_team_leaves_no_holiday_rows(client, db):
    """SQLite runs without foreign-key enforcement, so the routes delete these explicitly."""
    from sqlalchemy import func, select

    from app.models.holiday import HolidayException, TeamHolidayCalendar

    team = (await client.post(_TEAMS, json={"name": "Solo"})).json()
    tid = team["system_id"]
    alice = await _member(client, tid, "Alice")
    calendar = await _calendar(client)
    entry = await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _enable(client, tid, calendar["system_id"])
    await _exception(client, tid, alice["system_id"], entry["system_id"], EASTER_MONDAY)

    member_url = f"{_TEAMS}/{tid}/members/{alice['system_id']}"
    resp = await client.delete(member_url, headers={"If-Match": alice["etag"]})
    assert resp.status_code in (200, 204), resp.text
    assert await db.scalar(select(func.count()).select_from(HolidayException)) == 0

    etag = (await client.get(f"{_TEAMS}/{tid}")).headers["ETag"]
    resp = await client.delete(f"{_TEAMS}/{tid}", headers={"If-Match": etag})
    assert resp.status_code == 204, resp.text
    assert await db.scalar(select(func.count()).select_from(TeamHolidayCalendar)) == 0


# ── Cleanup of old everyone-absences ──────────────────────────────────────────

async def test_cleanup_offers_shared_absences_a_holiday_now_covers(client, team):
    alice = await _member(client, team["system_id"], "Alice")
    bob = await _member(client, team["system_id"], "Bob")
    absences = f"{_TEAMS}/{team['system_id']}/absences"
    shared = (await client.post(absences, json={
        "member_ids": [alice["system_id"], bob["system_id"]], "kind": "range",
        "label": "Easter Monday", "start_date": EASTER_MONDAY,
    })).json()
    await client.post(absences, json={
        "member_ids": [alice["system_id"]], "kind": "range", "label": "Own leave", "start_date": EASTER_MONDAY,
    })
    url = f"{_TEAMS}/{team['system_id']}/holiday-cleanup"
    assert (await client.get(url)).json() == {"groups": []}  # nothing enabled yet

    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Ostermontag", EASTER_MONDAY)
    await _enable(client, team["system_id"], calendar["system_id"])
    groups = (await client.get(url)).json()["groups"]
    assert [g["label"] for g in groups] == ["Easter Monday"]   # one-member leave is not offered
    assert sorted(m["name"] for m in groups[0]["members"]) == ["Alice", "Bob"]

    resp = await client.post(url, json={"absence_ids": [a["system_id"] for a in shared]})
    assert resp.json() == {"deleted": 2}
    refused = await client.post(url, json={"absence_ids": [shared[0]["system_id"]]})
    assert refused.status_code == 409


# ── PI board chips ────────────────────────────────────────────────────────────

async def test_a_sprint_lists_holidays_that_cost_working_time(client, team, pi):
    await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client)
    await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _entry(client, calendar["system_id"], "Saturday fair", "2026-04-11")
    await _enable(client, team["system_id"], calendar["system_id"])

    data = (await client.get(f"/api/v1/pis/{pi['system_id']}/holidays")).json()
    first, *rest = data["sprints"]
    assert [h["label"] for h in first["holidays"]] == ["Easter Monday"]
    assert all(s["holidays"] == [] for s in rest)   # undated sprints get nothing


async def test_a_pi_with_no_team_has_no_chips(client, project, pi):
    data = (await client.get(f"/api/v1/pis/{pi['system_id']}/holidays")).json()
    assert data["team_id"] is None
    assert all(s["holidays"] == [] for s in data["sprints"])


# ── .ics import and export ────────────────────────────────────────────────────

_ICS = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n"
    "BEGIN:VEVENT\r\nUID:a@test\r\nSUMMARY:Christmas\r\nDTSTART;VALUE=DATE:20201225\r\n"
    "RRULE:FREQ=YEARLY\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nUID:b@test\r\nSUMMARY:Stand-up\r\nDTSTART:20260105T090000\r\n"
    "DTEND:20260105T091500\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\n"
    "END:VCALENDAR\r\n"
).encode()


async def test_ics_import_previews_merges_and_skips_duplicates(client):
    calendar = await _calendar(client)
    url = f"{_CALENDARS}/{calendar['system_id']}/import/ics"
    files = {"file": ("holidays.ics", _ICS, "text/calendar")}
    params = {"from_year": 2026, "to_year": 2027}

    preview = (await client.post(url, files=files, params={**params, "dry_run": "true"})).json()
    assert (preview["created"], preview["duplicates"]) == (2, 0)
    assert [s["summary"] for s in preview["skipped"]] == ["Stand-up"]
    assert (await client.get(f"{_CALENDARS}/{calendar['system_id']}")).json()["entry_count"] == 0

    done = (await client.post(url, files=files, params=params)).json()
    assert done["created"] == 2
    again = (await client.post(url, files=files, params=params)).json()
    assert (again["created"], again["duplicates"]) == (0, 2)


async def test_ics_import_refuses_an_unreadable_file(client):
    calendar = await _calendar(client)
    resp = await client.post(
        f"{_CALENDARS}/{calendar['system_id']}/import/ics",
        files={"file": ("x.ics", b"not a calendar", "text/calendar")},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_ICS"


async def test_ics_import_refuses_a_file_over_the_size_cap(client):
    from app.services.ics import MAX_ICS_BYTES

    calendar = await _calendar(client)
    resp = await client.post(
        f"{_CALENDARS}/{calendar['system_id']}/import/ics",
        files={"file": ("x.ics", b"x" * (MAX_ICS_BYTES + 1), "text/calendar")},
    )
    assert resp.status_code == 413
    assert resp.json()["detail"]["error"] == "ICS_TOO_LARGE"


async def test_ics_export_is_a_calendar_download(client, reader_client):
    calendar = await _calendar(client, "Switzerland")
    await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    resp = await reader_client.get(f"{_CALENDARS}/{calendar['system_id']}/export/ics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    assert 'filename="Switzerland.ics"' in resp.headers["content-disposition"]
    assert "SUMMARY:Easter Monday" in resp.text


# ── Team JSON export and import (1.1) ─────────────────────────────────────────

def _upload(payload: dict) -> tuple:
    import json
    return ("file", ("team.json", json.dumps(payload).encode(), "application/json"))


async def _exported_team_with_holidays(client) -> tuple[dict, dict]:
    team = (await client.post(_TEAMS, json={"name": "Exported"})).json()
    alice = await _member(client, team["system_id"], "Alice")
    calendar = await _calendar(client, "Switzerland")
    entry = await _entry(client, calendar["system_id"], "Easter Monday", EASTER_MONDAY)
    await _enable(client, team["system_id"], calendar["system_id"])
    await _exception(client, team["system_id"], alice["system_id"], entry["system_id"], EASTER_MONDAY)
    exported = (await client.get(f"{_TEAMS}/{team['system_id']}/export")).json()
    return exported, calendar


async def test_export_carries_enabled_calendars_with_entries_and_exceptions(client):
    exported, _ = await _exported_team_with_holidays(client)
    assert exported["version"] == "1.1"
    team = exported["team"]
    assert team["holiday_calendars"] == [{
        "name": "Switzerland", "description": None,
        "entries": [{"label": "Easter Monday", "start_date": EASTER_MONDAY, "start_half": "am",
                     "end_date": EASTER_MONDAY, "end_half": "pm"}],
    }]
    assert team["holiday_exceptions"][0]["calendar"] == "Switzerland"
    assert team["holiday_exceptions"][0]["entry"] == {"label": "Easter Monday", "start_date": EASTER_MONDAY}


async def test_import_reuses_an_existing_calendar_and_never_edits_it(client):
    exported, calendar = await _exported_team_with_holidays(client)
    exported["team"]["holiday_calendars"][0]["entries"].append(
        {"label": "Made up", "start_date": "2026-04-09"}
    )
    resp = await client.post(_TEAMS + "/import", files=[_upload(exported)])
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert any("1 entry in the file differ" in note for note in data["import_notes"])

    detail = (await client.get(f"{_CALENDARS}/{calendar['system_id']}")).json()
    assert detail["entry_count"] == 1
    assert sorted(t["name"] for t in detail["teams"]) == ["Exported", "Exported (imported)"]
    holidays = (await client.get(f"{_TEAMS}/{data['system_id']}/holidays",
                                 params={"from": "2026-04-01", "to": "2026-04-30"})).json()
    assert len(holidays["entries"][0]["exceptions"]) == 1


async def test_import_refuses_unknown_calendars_unless_asked_to_create_them(client):
    exported, calendar = await _exported_team_with_holidays(client)
    resp = await client.delete(f"{_CALENDARS}/{calendar['system_id']}", headers={"If-Match": calendar["etag"]})
    assert resp.status_code == 204

    refused = await client.post(_TEAMS + "/import", files=[_upload(exported)])
    assert refused.status_code == 409
    assert refused.json()["detail"]["calendars"] == ["Switzerland"]
    assert len((await client.get(_TEAMS)).json()) == 1   # nothing half-imported

    created = await client.post(
        _TEAMS + "/import", files=[_upload(exported)], params={"create_missing_calendars": "true"}
    )
    assert created.status_code == 201, created.text
    calendars = (await client.get(_CALENDARS)).json()
    assert [(c["name"], c["entry_count"]) for c in calendars] == [("Switzerland", 1)]


async def test_a_1_0_file_imports_with_no_calendars(client):
    payload = {"version": "1.0", "team": {"name": "Old file", "members": [], "absences": [], "meetings": []}}
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 201, resp.text
    holidays = (await client.get(f"{_TEAMS}/{resp.json()['system_id']}/holidays")).json()
    assert holidays["enabled_calendar_ids"] == []
