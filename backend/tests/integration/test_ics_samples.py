"""The hand-test files in `docs/ics-samples/` do what their README says.

Each test is one row of that README's tables, run through the API the dialogs
call. A sample that drifts from its description fails here rather than
misleading whoever tries it by hand.
"""
from pathlib import Path

import pytest

_SAMPLES = Path(__file__).resolve().parents[3] / "docs" / "ics-samples"
_CALENDARS = "/api/v1/holiday-calendars"
_TEAMS = "/api/v1/teams"


def _sample(name: str) -> tuple[str, bytes, str]:
    return (name, (_SAMPLES / name).read_bytes(), "text/calendar")


# ── Holiday calendars ─────────────────────────────────────────────────────────

async def _holiday_import(client, calendar_id: str, name: str, *, dry_run: bool = True):
    return await client.post(
        f"{_CALENDARS}/{calendar_id}/import/ics",
        files={"file": _sample(name)},
        params={"dry_run": str(dry_run).lower(), "from_year": 2027, "to_year": 2028},
    )


@pytest.fixture
async def calendar(client) -> dict:
    resp = await client.post(_CALENDARS, json={"name": "Samples"})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_zurich_holidays_import_whole_halves_spans_and_a_yearly_rule(client, calendar):
    resp = await _holiday_import(client, calendar["system_id"], "01-holidays-zurich-2027.ics")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["created"], body["skipped"]) == (11, [])
    by_label: dict[str, list[tuple[str, str, str, str]]] = {}
    for e in body["entries"]:
        by_label.setdefault(e["label"], []).append(
            (e["start_date"], e["start_half"], e["end_date"], e["end_half"])
        )
    assert by_label["Sechseläuten (afternoon)"] == [("2027-04-19", "pm", "2027-04-19", "pm")]
    assert by_label["Heiligabend (afternoon)"] == [("2027-12-24", "pm", "2027-12-24", "pm")]
    assert by_label["Weihnachten / Stephanstag"] == [("2027-12-25", "am", "2027-12-26", "pm")]
    assert [s for s, *_ in by_label["Bundesfeiertag"]] == ["2027-08-01", "2028-08-01"]


async def test_zurich_holidays_imported_twice_add_nothing(client, calendar):
    first = await _holiday_import(client, calendar["system_id"], "01-holidays-zurich-2027.ics", dry_run=False)
    assert first.json()["created"] == 11
    again = (await _holiday_import(client, calendar["system_id"], "01-holidays-zurich-2027.ics")).json()
    assert (again["created"], again["duplicates"]) == (0, 11)


async def test_awkward_holidays_keep_four_and_skip_six(client, calendar):
    body = (await _holiday_import(client, calendar["system_id"], "02-holidays-awkward.ics")).json()
    assert body["created"] == 4
    assert body["truncated_labels"] == 1
    assert len(body["skipped"]) == 6
    by_label = {e["label"]: e for e in body["entries"]}
    morning = by_label["Morning off before the town festival"]
    assert (morning["start_half"], morning["end_half"]) == ("am", "am")
    exported = by_label["Exported by PI Planner"]
    assert (exported["start_half"], exported["end_date"], exported["end_half"]) == ("pm", "2027-12-31", "am")
    assert by_label["Company day"]["start_date"] == "2028-09-15"


async def test_a_file_that_is_not_a_calendar_is_refused(client, calendar):
    resp = await _holiday_import(client, calendar["system_id"], "99-not-a-calendar.ics")
    assert resp.status_code == 422


# ── Absences ──────────────────────────────────────────────────────────────────

@pytest.fixture
async def team(client) -> dict:
    resp = await client.post(_TEAMS, json={"name": "Samples"})
    assert resp.status_code == 201, resp.text
    team = resp.json()
    team["members"] = {}
    for name in ("Anna Keller", "Ben Okafor", "Michel Anders", "Chiara Rossi"):
        member = await client.post(
            f"{_TEAMS}/{team['system_id']}/members",
            json={"name": name, "pattern": {"effective_from": "2026-01-01"}},
        )
        assert member.status_code == 201, member.text
        team["members"][name] = member.json()["system_id"]
    return team


async def _absence_import(client, team: dict, name: str, *, dry_run: bool = True, **params):
    return await client.post(
        f"{_TEAMS}/{team['system_id']}/absences/import/ics",
        files={"file": _sample(name)},
        params={"dry_run": str(dry_run).lower(), **params},
    )


async def test_annas_calendar_ticks_leave_and_offers_the_rest(client, team):
    anna = team["members"]["Anna Keller"]
    body = (await _absence_import(client, team, "10-absences-anna.ics", member_id=anna)).json()
    assert (body["window_from"], body["window_to"]) == ("2027-01-06", "2027-07-23")
    ticked = {c["source_uid"] for c in body["candidates"] if c["selected_by_default"]}
    unticked = {c["source_uid"] for c in body["candidates"] if not c["selected_by_default"]}
    assert ticked == {
        "anna-summer@samples", "anna-doctor@samples", "anna-parttime@samples",
        "anna-fridays@samples", "anna-course@samples#MO", "anna-course@samples#TH",
    }
    assert unticked == {"anna-review@samples", "anna-birthday@samples#2027"}
    assert [s["summary"] for s in body["skipped"]] == ["Ski week (cancelled)"]


async def test_annas_updated_calendar_updates_adds_and_proposes_a_removal(client, team):
    anna = team["members"]["Anna Keller"]
    applied = (await _absence_import(client, team, "10-absences-anna.ics", dry_run=False, member_id=anna)).json()
    assert applied["created"] == 6

    body = (await _absence_import(client, team, "11-absences-anna-updated.ics", member_id=anna)).json()
    actions = {c["source_uid"]: c["action"] for c in body["candidates"]}
    assert actions == {
        "anna-summer@samples": "update",
        "anna-conference@samples": "create",
        "anna-parttime@samples": "unchanged",
        "anna-fridays@samples": "unchanged",
        "anna-course@samples#MO": "unchanged",
        "anna-course@samples#TH": "unchanged",
    }
    assert [r["label"] for r in body["removals"]] == ["Doctor's appointment"]


async def test_the_team_calendar_matches_by_attendee_and_by_full_name(client, team):
    members = {v: k for k, v in team["members"].items()}
    body = (await _absence_import(client, team, "12-absences-team.ics")).json()
    matched: dict[str, list[str | None]] = {}
    for c in body["candidates"]:
        matched.setdefault(c["source_uid"], []).append(members.get(c["member_id"]))
    assert matched == {
        "team-ben-vacation@samples": ["Ben Okafor"],
        "team-anna-vacation@samples": ["Anna Keller"],
        "team-michel-leave@samples": ["Michel Anders"],
        "team-offsite@samples": ["Anna Keller", "Chiara Rossi"],
        "team-first-name@samples": [None],
        "team-nobody@samples": [None],
    }


async def test_unsupported_absence_events_are_all_skipped(client, team):
    anna = team["members"]["Anna Keller"]
    body = (await _absence_import(client, team, "13-absences-unsupported.ics", member_id=anna)).json()
    assert body["candidates"] == []
    assert len(body["skipped"]) == 9


async def test_absences_refuse_a_file_that_is_not_a_calendar(client, team):
    resp = await _absence_import(client, team, "99-not-a-calendar.ics", member_id=team["members"]["Anna Keller"])
    assert resp.status_code == 422
