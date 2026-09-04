"""Meetings, and the capacity they take away (spec/teams.md §3.5, §5.4, §7.5).

The clamp itself is unit-tested against hand-computed hours in
`tests/unit/test_team_capacity.py`; what these tests watch is everything around
it — the one-row-many-attendees shape that makes the view a matrix, attendance as
an ordinary conditional write, the column order the team sets, and the four cases
§11 names where a meeting's cost is not simply its length.
"""
import pytest

from app.schemas import MAX_MEETINGS_PER_TEAM
from app.services.events import broadcaster, team_channel

_TEAMS = "/api/v1/teams"


def _url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/meetings"


def _if_match(etag: str) -> dict[str, str]:
    return {"If-Match": etag}


async def _member(client, team_id: str, name: str, **pattern) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01", **pattern}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _meeting(client, team_id: str, member_ids: list[str], **rule) -> dict:
    body = {
        "title": "Sprint planning",
        "kind": "range",
        "start_date": "2026-09-07",
        "half": "am",
        "duration_minutes": 120,
        "member_ids": member_ids,
    }
    body.update(rule)
    resp = await client.post(_url(team_id), json=body, params={"from": "2026-01-01", "to": "2026-12-31"})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _capacity(client, team_id: str) -> dict:
    resp = await client.get(f"{_TEAMS}/{team_id}/capacity")
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture
async def team(client) -> dict:
    resp = await client.post(_TEAMS, json={"name": "Platform"})
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture
async def marta(client, team) -> dict:
    return await _member(client, team["system_id"], "Marta Lindqvist")


# ── Creating ──────────────────────────────────────────────────────────────────

async def test_a_new_team_has_no_meetings(client, team):
    resp = await client.get(_url(team["system_id"]))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_a_one_day_meeting_occurs_once_in_the_half_it_names(client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    assert row["occurrences"] == ["2026-09-07"]
    assert row["summary"] == "2026-09-07, am"
    assert row["member_ids"] == [marta["system_id"]]


async def test_several_attendees_share_one_row(client, team):
    """A meeting is a shared event, unlike an absence, which fans out (§3.5)."""
    marta = await _member(client, team["system_id"], "Marta")
    tomas = await _member(client, team["system_id"], "Tomas")

    row = await _meeting(client, team["system_id"], [marta["system_id"], tomas["system_id"]])
    assert sorted(row["member_ids"]) == sorted([marta["system_id"], tomas["system_id"]])
    assert len((await client.get(_url(team["system_id"]))).json()) == 1


async def test_a_meeting_with_no_attendees_is_allowed(client, team, marta):
    """A column with an empty matrix costs nothing (§11) — schedule first, tick later."""
    row = await _meeting(client, team["system_id"], [])
    assert row["member_ids"] == []


async def test_a_range_meeting_occurs_on_every_day_of_the_block(client, team, marta):
    """Each day in the range costs duration_minutes — it is not one long block (§11)."""
    row = await _meeting(
        client, team["system_id"], [marta["system_id"]],
        title="Workshop", start_date="2026-09-07", end_date="2026-09-09", duration_minutes=480,
    )
    assert row["occurrences"] == ["2026-09-07", "2026-09-08", "2026-09-09"]
    assert row["summary"] == "2026-09-07 – 2026-09-09, am each day"


async def test_a_recurring_meeting_is_one_row(client, team, marta):
    """A stand-up over a year is one weekly rule, not 250 records (§3.5)."""
    row = await _meeting(
        client, team["system_id"], [marta["system_id"]],
        title="Stand-up", kind="weekly", start_date="2026-09-01", weekday=1,
        duration_minutes=15,
    )
    assert row["summary"] == "every Tuesday am, from 2026-09-01, ongoing"
    assert len(row["occurrences"]) == 18
    assert len((await client.get(_url(team["system_id"]))).json()) == 1


async def test_an_interval_meeting_names_its_fortnight(client, team, marta):
    row = await _meeting(
        client, team["system_id"], [marta["system_id"]],
        title="Retro", kind="interval", start_date="2026-09-04", weekday=4, interval_weeks=2,
        half="pm", duration_minutes=60,
    )
    assert row["summary"] == "every 2nd Friday pm, from 2026-09-04, ongoing"
    assert row["occurrences"][:3] == ["2026-09-04", "2026-09-18", "2026-10-02"]


async def test_a_weekly_meeting_needs_a_weekday(client, team, marta):
    resp = await client.post(
        _url(team["system_id"]),
        json={
            "title": "Sync", "kind": "weekly", "start_date": "2026-09-01",
            "half": "am", "duration_minutes": 30, "member_ids": [],
        },
    )
    assert resp.status_code == 422


async def test_a_duration_off_the_five_minute_step_is_refused(client, team, marta):
    resp = await client.post(
        _url(team["system_id"]),
        json={
            "title": "Chat", "kind": "range", "start_date": "2026-09-07",
            "half": "am", "duration_minutes": 7, "member_ids": [],
        },
    )
    assert resp.status_code == 422


async def test_an_eight_hour_meeting_is_enterable(client, team, marta):
    """Length belongs to the meeting, not to the attendee's contract (§3.5)."""
    row = await _meeting(client, team["system_id"], [marta["system_id"]], duration_minutes=480)
    assert row["duration_minutes"] == 480


async def test_a_member_from_another_team_cannot_attend(client, team, marta):
    other = (await client.post(_TEAMS, json={"name": "Other"})).json()
    stranger = await _member(client, other["system_id"], "Stranger")

    resp = await client.post(
        _url(team["system_id"]),
        json={
            "title": "Sync", "kind": "range", "start_date": "2026-09-07",
            "half": "am", "duration_minutes": 30, "member_ids": [stranger["system_id"]],
        },
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "MEMBER_NOT_FOUND"


# ── Editing, attendance and preconditions ─────────────────────────────────────

async def test_ticking_a_cell_is_a_patch_of_the_attendee_set(client, team):
    marta = await _member(client, team["system_id"], "Marta")
    tomas = await _member(client, team["system_id"], "Tomas")
    row = await _meeting(client, team["system_id"], [marta["system_id"]])

    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"member_ids": [marta["system_id"], tomas["system_id"]]},
        headers=_if_match(row["etag"]),
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["member_ids"]) == 2
    # The schedule is untouched by an attendance write.
    assert resp.json()["start_date"] == row["start_date"]


async def test_omitting_member_ids_leaves_attendance_alone(client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"duration_minutes": 60},
        headers=_if_match(row["etag"]),
    )
    assert resp.json()["member_ids"] == [marta["system_id"]]
    assert resp.json()["duration_minutes"] == 60


async def test_editing_changes_the_whole_series(client, team, marta):
    """There is no per-occurrence exception; a patch moves every occurrence (§3.4)."""
    row = await _meeting(
        client, team["system_id"], [marta["system_id"]],
        title="Stand-up", kind="weekly", start_date="2026-09-01", weekday=1, duration_minutes=15,
    )
    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"weekday": 3},
        headers=_if_match(row["etag"]),
    )
    assert resp.json()["summary"] == "every Thursday am, from 2026-09-01, ongoing"


async def test_a_patch_that_would_leave_an_incoherent_rule_is_refused(client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"kind": "weekly"},
        headers=_if_match(row["etag"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_SCHEDULE"


async def test_a_stale_if_match_is_412_carrying_the_current_row(client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    first = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"title": "Planning"},
        headers=_if_match(row["etag"]),
    )
    assert first.status_code == 200

    second = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"title": "Something else"},
        headers=_if_match(row["etag"]),
    )
    assert second.status_code == 412
    assert second.json()["detail"]["error"] == "STALE"
    assert second.json()["detail"]["current"]["title"] == "Planning"


async def test_a_write_without_if_match_is_refused(client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}", json={"title": "Planning"}
    )
    assert resp.status_code == 428


async def test_deleting_removes_the_meeting_and_its_attendance(client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    resp = await client.delete(
        f"{_url(team['system_id'])}/{row['system_id']}", headers=_if_match(row["etag"])
    )
    assert resp.status_code == 204
    assert (await client.get(_url(team["system_id"]))).json() == []


async def test_a_meeting_of_another_team_is_not_reachable_through_this_one(client, team, marta):
    other = (await client.post(_TEAMS, json={"name": "Other"})).json()
    row = await _meeting(client, team["system_id"], [marta["system_id"]])

    resp = await client.get(f"{_url(other['system_id'])}/{row['system_id']}")
    assert resp.status_code in (404, 405)
    resp = await client.delete(
        f"{_url(other['system_id'])}/{row['system_id']}", headers=_if_match(row["etag"])
    )
    assert resp.status_code == 404


async def test_a_reader_cannot_write(reader_client, client, team, marta):
    row = await _meeting(client, team["system_id"], [marta["system_id"]])
    assert (await reader_client.get(_url(team["system_id"]))).status_code == 200
    resp = await reader_client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"title": "Nope"},
        headers=_if_match(row["etag"]),
    )
    assert resp.status_code == 403


async def test_a_write_broadcasts_on_the_team_channel(client, team, marta):
    queue = broadcaster._subscribe(team_channel(team["system_id"]))
    await _meeting(client, team["system_id"], [marta["system_id"]])
    assert (await queue.get())["type"] == "team:meeting:created"


# ── Column order ──────────────────────────────────────────────────────────────

async def test_new_meetings_join_at_the_right_hand_end(client, team, marta):
    first = await _meeting(client, team["system_id"], [], title="Stand-up")
    second = await _meeting(client, team["system_id"], [], title="Retro")
    assert [m["title"] for m in (await client.get(_url(team["system_id"]))).json()] == [
        first["title"], second["title"]
    ]


async def test_reordering_sets_the_column_order(client, team, marta):
    """Order is the team's, not chronological — a matrix has no time axis (§7.5)."""
    first = await _meeting(client, team["system_id"], [], title="Stand-up")
    second = await _meeting(client, team["system_id"], [], title="Retro")

    resp = await client.post(
        f"{_url(team['system_id'])}/reorder",
        json={"order": [second["system_id"], first["system_id"]]},
    )
    assert resp.status_code == 200, resp.text
    assert [m["title"] for m in resp.json()] == ["Retro", "Stand-up"]
    assert [m["title"] for m in (await client.get(_url(team["system_id"]))).json()] == [
        "Retro", "Stand-up"
    ]


# ── The number going down ─────────────────────────────────────────────────────

async def _team_with_a_sprint(client, team) -> dict:
    """A team serving one project whose only dated sprint is one working week."""
    project = (await client.post("/api/v1/projects/", json={"name": "ISK"})).json()
    pi = (
        await client.post(
            f"/api/v1/projects/{project['system_id']}/pis",
            json={"name": "PI 7", "start_date": "2026-09-07"},
        )
    ).json()
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    first = next(s for s in sprints if s["sprint_index"] == 0)
    await client.patch(
        f"/api/v1/sprints/{first['system_id']}",
        json={"start_date": "2026-09-07", "end_date": "2026-09-11"},
    )
    await client.post(
        f"{_TEAMS}/{team['system_id']}/projects", json={"project_id": project["system_id"]}
    )
    return project


async def test_a_meeting_reduces_the_capacity_figure(client, team, marta):
    await _team_with_a_sprint(client, team)
    before = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert before["person_days"] == pytest.approx(5.0)

    await _meeting(
        client, team["system_id"], [marta["system_id"]],
        kind="weekly", start_date="2026-09-01", weekday=0, duration_minutes=120,
    )

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["meeting_hours"] == pytest.approx(2.0)
    assert cell["hours_after_meetings"] == pytest.approx(38.0)
    assert cell["person_days"] == pytest.approx(4.75)


async def test_a_meeting_costs_nothing_for_someone_who_does_not_attend(client, team, marta):
    await _team_with_a_sprint(client, team)
    tomas = await _member(client, team["system_id"], "Tomas")
    await _meeting(client, team["system_id"], [tomas["system_id"]], duration_minutes=240)

    cells = {
        row["name"]: row["cells"][0]
        for row in (await _capacity(client, team["system_id"]))["members"]
    }
    assert cells["Marta Lindqvist"]["meeting_hours"] == pytest.approx(0.0)
    assert cells["Tomas"]["meeting_hours"] == pytest.approx(4.0)


async def test_ticking_attendance_moves_the_number(client, team, marta):
    await _team_with_a_sprint(client, team)
    row = await _meeting(client, team["system_id"], [], duration_minutes=120)
    assert (await _capacity(client, team["system_id"]))["members"][0]["cells"][0][
        "meeting_hours"
    ] == pytest.approx(0.0)

    await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"member_ids": [marta["system_id"]]},
        headers=_if_match(row["etag"]),
    )
    assert (await _capacity(client, team["system_id"]))["members"][0]["cells"][0][
        "meeting_hours"
    ] == pytest.approx(2.0)


async def test_a_workshop_longer_than_the_day_costs_the_day_and_stops(client, team):
    """8 h for a 6 h/day member: capacity reaches 0 and never goes below (§11)."""
    await _team_with_a_sprint(client, team)
    bob = await _member(client, team["system_id"], "Bob", hours_per_day=6.0)
    await _meeting(
        client, team["system_id"], [bob["system_id"]],
        title="Workshop", start_date="2026-09-08", duration_minutes=480,
    )

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    # Four other 6 h days survive; the workshop day costs 6 h, not 8.
    assert cell["meeting_hours"] == pytest.approx(6.0)
    assert cell["hours_after_meetings"] == pytest.approx(24.0)


async def test_a_meeting_on_an_absent_morning_costs_nothing(client, team, marta):
    """Absence beats meeting: the spill only reaches surviving hours (§5.4)."""
    await _team_with_a_sprint(client, team)
    await client.post(
        f"{_TEAMS}/{team['system_id']}/absences",
        json={
            "member_ids": [marta["system_id"]], "kind": "range",
            "start_date": "2026-09-08", "end_date": "2026-09-08", "start_half": "am",
            "end_half": "am",
        },
    )
    await _meeting(
        client, team["system_id"], [marta["system_id"]],
        start_date="2026-09-08", half="am", duration_minutes=120,
    )

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["absent_half_days"] == 1
    assert cell["meeting_hours"] == pytest.approx(0.0)


async def test_a_meeting_on_a_non_contracted_half_is_not_deducted(client, team):
    await _team_with_a_sprint(client, team)
    part_timer = await _member(client, team["system_id"], "Aicha", fri_am=False, fri_pm=False)
    await _meeting(
        client, team["system_id"], [part_timer["system_id"]],
        start_date="2026-09-11", duration_minutes=120,
    )

    cell = (await _capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["meeting_hours"] == pytest.approx(0.0)


# ── Bulk ──────────────────────────────────────────────────────────────────────

async def test_bulk_replaces_inside_the_window_and_is_idempotent(client, team):
    await _member(client, team["system_id"], "Marta")
    await _member(client, team["system_id"], "Tomas")
    body = {
        "window_from": "2026-09-01",
        "window_to": "2026-09-30",
        "entries": [
            {
                "title": "Stand-up", "kind": "weekly", "start_date": "2026-09-01",
                "weekday": 1, "half": "am", "duration_minutes": 15, "all_members": True,
            }
        ],
    }

    first = await client.post(f"{_url(team['system_id'])}/bulk", json=body)
    assert first.status_code == 200, first.text
    assert (first.json()["created"], first.json()["deleted"]) == (1, 0)
    assert len(first.json()["meetings"][0]["member_ids"]) == 2

    second = await client.post(f"{_url(team['system_id'])}/bulk", json=body)
    assert (second.json()["created"], second.json()["deleted"]) == (1, 1)
    assert len((await client.get(_url(team["system_id"]))).json()) == 1


async def test_bulk_reports_every_unknown_name_at_once_and_writes_nothing(client, team):
    await _member(client, team["system_id"], "Marta")
    resp = await client.post(
        f"{_url(team['system_id'])}/bulk",
        json={
            "window_from": "2026-09-01", "window_to": "2026-09-30",
            "entries": [
                {"title": "Sync", "kind": "range", "start_date": "2026-09-07", "half": "am",
                 "duration_minutes": 30, "member_names": ["Marta", "Anders Michel"]},
                {"title": "Retro", "kind": "range", "start_date": "2026-09-08", "half": "pm",
                 "duration_minutes": 60, "member_names": ["Katrin H"]},
            ],
        },
    )
    assert resp.json()["unresolved_names"] == ["Anders Michel", "Katrin H"]
    assert resp.json()["created"] == 0
    assert (await client.get(_url(team["system_id"]))).json() == []


async def test_a_dry_run_reports_what_it_would_do_and_writes_nothing(client, team):
    await _member(client, team["system_id"], "Marta")
    resp = await client.post(
        f"{_url(team['system_id'])}/bulk",
        json={
            "window_from": "2026-09-01", "window_to": "2026-09-30", "dry_run": True,
            "entries": [
                {"title": "Sync", "kind": "range", "start_date": "2026-09-07", "half": "am",
                 "duration_minutes": 30, "member_names": ["Marta"]}
            ],
        },
    )
    assert resp.json()["dry_run"] is True
    assert resp.json()["created"] == 1
    assert (await client.get(_url(team["system_id"]))).json() == []


async def test_the_per_team_ceiling_is_enforced(client, team, marta, monkeypatch):
    import app.routes.meetings as routes

    monkeypatch.setattr(routes, "MAX_MEETINGS_PER_TEAM", 1)
    await _meeting(client, team["system_id"], [])

    resp = await client.post(
        _url(team["system_id"]),
        json={
            "title": "One too many", "kind": "range", "start_date": "2026-09-08",
            "half": "am", "duration_minutes": 30, "member_ids": [],
        },
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "MEETING_LIMIT_REACHED"
    assert MAX_MEETINGS_PER_TEAM == 100
