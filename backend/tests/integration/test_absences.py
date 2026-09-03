"""Absences, and the capacity they take away (spec/teams.md §3.4, §7.4).

The occurrence arithmetic is unit-tested in `tests/unit/test_occurrences.py`;
what these tests watch is everything around it — the multi-member create that is
the public-holiday flow, the series-not-occurrence edit, the precondition, and
the one thing the whole step exists for: the number going down.
"""
import pytest

from app.schemas import MAX_ABSENCES_PER_MEMBER
from app.services.events import broadcaster, team_channel

_TEAMS = "/api/v1/teams"


def _url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/absences"


def _if_match(etag: str) -> dict[str, str]:
    return {"If-Match": etag}


async def _member(client, team_id: str, name: str, **pattern) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01", **pattern}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _absence(client, team_id: str, member_ids: list[str], **rule) -> list[dict]:
    resp = await client.post(
        _url(team_id),
        json={"member_ids": member_ids, "kind": "range", **rule},
        params={"from": "2026-01-01", "to": "2026-12-31"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _sprint_capacity(client, team_id: str) -> dict:
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

async def test_a_new_team_has_no_absences(client, team):
    resp = await client.get(_url(team["system_id"]))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_a_one_day_range_covers_both_halves(client, team, marta):
    rows = await _absence(
        client, team["system_id"], [marta["system_id"]], start_date="2026-12-25", label="Christmas"
    )
    assert len(rows) == 1
    assert rows[0]["label"] == "Christmas"
    assert rows[0]["occurrences"] == [{"date": "2026-12-25", "halves": ["am", "pm"]}]
    assert rows[0]["summary"] == "2026-12-25, both halves"


async def test_one_request_makes_one_record_per_member(client, team):
    """The team-wide holiday flow: select everyone, correct one afterwards (§3.4)."""
    ids = [
        (await _member(client, team["system_id"], name))["system_id"]
        for name in ("Marta", "Tomas", "Rui")
    ]
    rows = await _absence(client, team["system_id"], ids, start_date="2026-12-25")

    assert len(rows) == 3
    assert {r["member_id"] for r in rows} == set(ids)
    # Independently editable — not one shared object.
    assert len({r["system_id"] for r in rows}) == 3


async def test_a_member_from_another_team_is_refused(client, team, marta):
    other = (await client.post(_TEAMS, json={"name": "Frontline"})).json()
    stranger = await _member(client, other["system_id"], "Jonas")

    resp = await client.post(
        _url(team["system_id"]),
        json={"member_ids": [marta["system_id"], stranger["system_id"]], "kind": "range",
              "start_date": "2026-12-25"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "MEMBER_NOT_FOUND"
    assert resp.json()["detail"]["member_ids"] == [stranger["system_id"]]


async def test_a_weekly_rule_needs_a_weekday(client, team, marta):
    resp = await client.post(
        _url(team["system_id"]),
        json={"member_ids": [marta["system_id"]], "kind": "weekly", "start_date": "2026-03-01"},
    )
    assert resp.status_code == 422


async def test_an_interval_starts_at_two_weeks(client, team, marta):
    """"Every week" is the weekly kind; interval_weeks of 1 is not a thing (§3.4)."""
    resp = await client.post(
        _url(team["system_id"]),
        json={
            "member_ids": [marta["system_id"]], "kind": "interval", "start_date": "2026-09-04",
            "weekday": 4, "halves": ["am"], "interval_weeks": 1,
        },
    )
    assert resp.status_code == 422


async def test_a_recurring_rule_expands_inside_the_window_only(client, team, marta):
    resp = await client.post(
        _url(team["system_id"]),
        json={
            "member_ids": [marta["system_id"]], "kind": "interval", "start_date": "2026-09-04",
            "weekday": 4, "halves": ["am"], "interval_weeks": 2, "label": "Free Friday",
        },
        params={"from": "2026-09-01", "to": "2026-10-01"},
    )
    assert resp.status_code == 201
    row = resp.json()[0]
    assert [o["date"] for o in row["occurrences"]] == ["2026-09-04", "2026-09-18"]
    assert row["occurrences"][0]["halves"] == ["am"]
    assert row["summary"] == "every 2nd Friday am, from 2026-09-04, ongoing"


async def test_a_rule_outside_the_window_keeps_its_row_and_loses_its_occurrences(
    client, team, marta
):
    """The minimap's density bars are drawn from rows the grid is not showing (§7.4)."""
    await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25")

    rows = (
        await client.get(_url(team["system_id"]), params={"from": "2026-01-01", "to": "2026-06-30"})
    ).json()
    assert len(rows) == 1
    assert rows[0]["occurrences"] == []


# ── Editing and deleting ──────────────────────────────────────────────────────

async def test_editing_changes_the_whole_series(client, team, marta):
    """There is no per-occurrence exception — only the series (§3.4)."""
    row = (
        await client.post(
            _url(team["system_id"]),
            json={
                "member_ids": [marta["system_id"]], "kind": "weekly", "start_date": "2026-03-01",
                "weekday": 2, "halves": ["pm"],
            },
            params={"from": "2026-03-01", "to": "2026-03-31"},
        )
    ).json()[0]

    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"halves": ["am", "pm"]},
        headers=_if_match(row["etag"]),
        params={"from": "2026-03-01", "to": "2026-03-31"},
    )
    assert resp.status_code == 200
    assert all(o["halves"] == ["am", "pm"] for o in resp.json()["occurrences"])


async def test_a_patch_that_would_leave_an_incoherent_rule_is_refused(client, team, marta):
    row = (await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25"))[0]

    # Switching to weekly without naming a weekday: the merged rule is what must
    # hold together, not the patch.
    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"kind": "weekly"},
        headers=_if_match(row["etag"]),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_SCHEDULE"


async def test_a_stale_if_match_is_412_carrying_the_current_row(client, team, marta):
    row = (await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25"))[0]
    updated = (
        await client.patch(
            f"{_url(team['system_id'])}/{row['system_id']}",
            json={"label": "Christmas Day"},
            headers=_if_match(row["etag"]),
        )
    ).json()

    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}",
        json={"label": "Xmas"},
        headers=_if_match(row["etag"]),
    )
    assert resp.status_code == 412
    detail = resp.json()["detail"]
    assert detail["error"] == "STALE"
    # 412 means "it changed, here it is" — the body is what powers keep-theirs.
    assert detail["current"]["label"] == "Christmas Day"
    assert detail["current"]["etag"] == updated["etag"]


async def test_a_write_without_if_match_is_refused(client, team, marta):
    row = (await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25"))[0]
    resp = await client.patch(
        f"{_url(team['system_id'])}/{row['system_id']}", json={"label": "Xmas"}
    )
    assert resp.status_code == 428


async def test_deleting_removes_the_series(client, team, marta):
    row = (await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25"))[0]

    resp = await client.delete(
        f"{_url(team['system_id'])}/{row['system_id']}", headers=_if_match(row["etag"])
    )
    assert resp.status_code == 204
    assert (await client.get(_url(team["system_id"]))).json() == []


async def test_an_absence_of_another_team_is_not_reachable_through_this_one(client, team, marta):
    other = (await client.post(_TEAMS, json={"name": "Frontline"})).json()
    row = (await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25"))[0]

    resp = await client.get(_url(other["system_id"]))
    assert resp.json() == []
    resp = await client.delete(
        f"{_url(other['system_id'])}/{row['system_id']}", headers=_if_match(row["etag"])
    )
    assert resp.status_code == 404


async def test_a_reader_cannot_write(reader_client, client, team, marta):
    resp = await reader_client.post(
        _url(team["system_id"]),
        json={"member_ids": [marta["system_id"]], "kind": "range", "start_date": "2026-12-25"},
    )
    assert resp.status_code == 403
    assert (await reader_client.get(_url(team["system_id"]))).status_code == 200


async def test_a_write_broadcasts_on_the_team_channel(client, team, marta):
    queue = broadcaster._subscribe(team_channel(team["system_id"]))
    await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25")
    assert (await queue.get())["type"] == "team:absence:created"


# ── The number going down ─────────────────────────────────────────────────────

async def _team_with_a_sprint(client, team, **member_pattern) -> dict:
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


async def test_an_absence_reduces_the_capacity_figure(client, team, marta):
    await _team_with_a_sprint(client, team)
    before = await _sprint_capacity(client, team["system_id"])
    cell = before["members"][0]["cells"][0]
    assert cell["contracted_half_days"] == 10
    assert cell["person_days"] == pytest.approx(5.0)

    await _absence(
        client, team["system_id"], [marta["system_id"]],
        start_date="2026-09-09", end_date="2026-09-10",
    )

    after = await _sprint_capacity(client, team["system_id"])
    cell = after["members"][0]["cells"][0]
    assert cell["absent_half_days"] == 4
    assert cell["hours_after_absences"] == pytest.approx(24.0)
    assert cell["person_days"] == pytest.approx(3.0)
    assert cell["present_days"] == pytest.approx(3.0)


async def test_overlapping_absences_are_counted_once(client, team, marta):
    """Union, never a sum: two entries on one afternoon cost one half-day (§3.4)."""
    await _team_with_a_sprint(client, team)
    await _absence(
        client, team["system_id"], [marta["system_id"]],
        start_date="2026-09-08", end_date="2026-09-10",
    )
    await _absence(
        client, team["system_id"], [marta["system_id"]],
        start_date="2026-09-09", end_date="2026-09-11",
    )

    cell = (await _sprint_capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["absent_half_days"] == 8
    assert cell["person_days"] == pytest.approx(1.0)


async def test_an_absence_on_a_non_working_half_day_has_no_effect(client, team):
    """Allowed, and silent: the office shutdown must not nag about part-timers."""
    await _team_with_a_sprint(client, team)
    part_timer = await _member(
        client, team["system_id"], "Aicha", fri_am=False, fri_pm=False
    )
    await _absence(
        client, team["system_id"], [part_timer["system_id"]], start_date="2026-09-11"
    )

    cell = (await _sprint_capacity(client, team["system_id"]))["members"][0]["cells"][0]
    assert cell["absent_half_days"] == 0
    assert cell["contracted_half_days"] == 8
    assert cell["person_days"] == pytest.approx(4.0)


async def test_a_recurring_absence_reduces_only_its_occurrences(client, team, marta):
    await _team_with_a_sprint(client, team)
    await client.post(
        _url(team["system_id"]),
        json={
            "member_ids": [marta["system_id"]], "kind": "weekly", "start_date": "2026-09-01",
            "weekday": 4, "halves": ["am", "pm"],
        },
    )
    cell = (await _sprint_capacity(client, team["system_id"]))["members"][0]["cells"][0]
    # One Friday in the week 7–11 September.
    assert cell["absent_half_days"] == 2
    assert cell["person_days"] == pytest.approx(4.0)


# ── Bulk ──────────────────────────────────────────────────────────────────────

async def test_bulk_replaces_inside_the_window_and_is_idempotent(client, team):
    """Re-reading the source page must not double every absence (§8.2.7)."""
    await _member(client, team["system_id"], "Marta")
    await _member(client, team["system_id"], "Tomas")
    body = {
        "window_from": "2026-12-01",
        "window_to": "2026-12-31",
        "entries": [
            {"member_names": ["Marta", "Tomas"], "kind": "range", "start_date": "2026-12-25",
             "label": "Christmas"},
        ],
    }

    first = await client.post(f"{_url(team['system_id'])}/bulk", json=body)
    assert first.status_code == 200, first.text
    assert first.json()["created"] == 2
    assert first.json()["deleted"] == 0

    second = await client.post(f"{_url(team['system_id'])}/bulk", json=body)
    assert second.json() == {**second.json(), "created": 2, "deleted": 2}
    assert len((await client.get(_url(team["system_id"]))).json()) == 2


async def test_bulk_leaves_absences_anchored_outside_the_window_alone(client, team):
    marta = await _member(client, team["system_id"], "Marta")
    await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-07-20")

    resp = await client.post(
        f"{_url(team['system_id'])}/bulk",
        json={"window_from": "2026-12-01", "window_to": "2026-12-31", "entries": []},
    )
    assert resp.json()["deleted"] == 0
    assert len((await client.get(_url(team["system_id"]))).json()) == 1


async def test_bulk_reports_every_unknown_name_at_once_and_writes_nothing(client, team):
    await _member(client, team["system_id"], "Marta")
    resp = await client.post(
        f"{_url(team['system_id'])}/bulk",
        json={
            "window_from": "2026-12-01", "window_to": "2026-12-31",
            "entries": [
                {"member_names": ["Marta", "Anders Michel"], "kind": "range",
                 "start_date": "2026-12-25"},
                {"member_names": ["Katrin H"], "kind": "range", "start_date": "2026-12-28"},
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["unresolved_names"] == ["Anders Michel", "Katrin H"]
    assert resp.json()["created"] == 0
    assert (await client.get(_url(team["system_id"]))).json() == []


async def test_a_dry_run_reports_what_it_would_do_and_writes_nothing(client, team):
    await _member(client, team["system_id"], "Marta")
    resp = await client.post(
        f"{_url(team['system_id'])}/bulk",
        json={
            "window_from": "2026-12-01", "window_to": "2026-12-31", "dry_run": True,
            "entries": [
                {"member_names": ["Marta"], "kind": "range", "start_date": "2026-12-25"}
            ],
        },
    )
    assert resp.json()["dry_run"] is True
    assert resp.json()["created"] == 1
    assert (await client.get(_url(team["system_id"]))).json() == []


async def test_the_per_member_ceiling_is_enforced(client, team, marta, monkeypatch):
    import app.routes.absences as routes

    monkeypatch.setattr(routes, "MAX_ABSENCES_PER_MEMBER", 1)
    await _absence(client, team["system_id"], [marta["system_id"]], start_date="2026-12-25")

    resp = await client.post(
        _url(team["system_id"]),
        json={"member_ids": [marta["system_id"]], "kind": "range", "start_date": "2026-12-26"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "ABSENCE_LIMIT_REACHED"
    assert MAX_ABSENCES_PER_MEMBER == 2000
