"""Integration tests for the team routes.

Teams are the one aggregate that lives *outside* the single-writer edit lock
(spec/teams.md §4.1), so the two things these tests watch hardest are the pieces
that replace it: ``If-Match`` optimistic concurrency (§4.2) and the team's own SSE
channel. Everything else — CRUD, RBAC, uniqueness, the 50-team cap — is here
because the routes promise it.
"""
from contextlib import contextmanager

import pytest

from app.models.team import Team, TeamMember, TeamProject
from app.schemas import MAX_TEAMS
from app.services.events import broadcaster, team_channel

_URL = "/api/v1/teams"


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _create(client, name: str, **fields) -> dict:
    resp = await client.post(_URL, json={"name": name, **fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _etag(client, team_id: str) -> str:
    """The tag a subsequent write has to quote back in ``If-Match``."""
    resp = await client.get(f"{_URL}/{team_id}")
    assert resp.status_code == 200, resp.text
    return resp.headers["ETag"]


def _if_match(etag: str) -> dict[str, str]:
    return {"If-Match": etag}


async def _project(client, name: str) -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


@contextmanager
def _listening(channel: str):
    """A queue receiving everything broadcast on one channel for the duration."""
    q = broadcaster._subscribe(channel)
    try:
        yield q
    finally:
        broadcaster._unsubscribe(channel, q)


def _drain(q) -> list[dict]:
    events = []
    while not q.empty():
        events.append(q.get_nowait())
    return events


@pytest.fixture
async def team(client) -> dict:
    return await _create(client, "Platform")


# ── Listing ───────────────────────────────────────────────────────────────────

async def test_an_instance_with_no_teams_lists_nothing(client):
    resp = await client.get(_URL)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_teams_are_listed_in_case_insensitive_name_order(client):
    # Plain byte ordering would put every capitalised name before "apps", which is
    # not the order a human reads the Teams section in.
    for name in ("delta", "Apps", "charlie", "Bravo"):
        await _create(client, name)

    names = [t["name"] for t in (await client.get(_URL)).json()]
    assert names == ["Apps", "Bravo", "charlie", "delta"]


async def test_a_reader_can_list_teams(client, reader_client, team):
    resp = await reader_client.get(_URL)
    assert resp.status_code == 200
    assert [t["name"] for t in resp.json()] == ["Platform"]


# ── Creating ──────────────────────────────────────────────────────────────────

async def test_creating_a_team_needs_nothing_but_a_name(client):
    body = await _create(client, "Platform")

    assert body["name"] == "Platform"
    assert body["description"] is None
    assert body["normal_day_hours"] == 8.0
    assert body["member_count"] == 0
    assert body["project_ids"] == []
    assert body["system_id"]


async def test_a_team_has_no_user_facing_id(client, team):
    # Teams are not planning items, so the dual-ID system does not apply (§3.1).
    assert "id" not in team
    assert "user_id" not in team


async def test_a_team_can_set_its_own_normal_day_hours(client):
    body = await _create(client, "Part Timers", description="37.5 h week", normal_day_hours=7.5)
    assert body["normal_day_hours"] == 7.5
    assert body["description"] == "37.5 h week"


@pytest.mark.parametrize("hours", [1.0, 24.0])
async def test_normal_day_hours_accepts_the_bounds(client, hours):
    body = await _create(client, f"Team {hours}", normal_day_hours=hours)
    assert body["normal_day_hours"] == hours


@pytest.mark.parametrize("hours", [0.0, 0.9, 24.1, 100.0])
async def test_normal_day_hours_outside_one_to_twenty_four_is_rejected(client, hours):
    resp = await client.post(_URL, json={"name": "Out Of Range", "normal_day_hours": hours})
    assert resp.status_code == 422


async def test_a_name_is_required_and_capped_at_a_hundred_characters(client):
    assert (await client.post(_URL, json={"name": ""})).status_code == 422
    assert (await client.post(_URL, json={"name": "x" * 101})).status_code == 422
    assert (await client.post(_URL, json={"name": "x" * 100})).status_code == 201


async def test_a_description_is_capped_at_two_thousand_characters(client):
    over = await client.post(_URL, json={"name": "Wordy", "description": "d" * 2001})
    assert over.status_code == 422

    at_limit = await client.post(_URL, json={"name": "Wordy", "description": "d" * 2000})
    assert at_limit.status_code == 201


async def test_a_duplicate_team_name_is_rejected(client, team):
    resp = await client.post(_URL, json={"name": "Platform"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "TEAM_NAME_TAKEN"


async def test_names_differing_only_by_case_are_the_same_team(client, team):
    # "Platform" and "platform" are one team — the uniqueness index is on lower(name).
    resp = await client.post(_URL, json={"name": "pLaTfOrM"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "TEAM_NAME_TAKEN"


async def test_a_reader_cannot_create_a_team(client, reader_client):
    resp = await reader_client.post(_URL, json={"name": "Readers Team"})
    assert resp.status_code == 403


async def test_creating_a_team_returns_an_etag_usable_straight_away(client):
    """Create then rename, with no GET in between to learn a tag the create knew."""
    created = await client.post(_URL, json={"name": "Fresh"})
    etag = created.headers["ETag"]

    renamed = await client.patch(
        f"{_URL}/{created.json()['system_id']}",
        json={"name": "Fresher"},
        headers=_if_match(etag),
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Fresher"


# ── Reading one ───────────────────────────────────────────────────────────────

async def test_reading_a_team_that_does_not_exist_is_a_404(client):
    resp = await client.get(f"{_URL}/no-such-team")
    assert resp.status_code == 404


async def test_reading_a_team_returns_the_etag_a_write_must_quote(client, team):
    read = await client.get(f"{_URL}/{team['system_id']}")
    assert read.status_code == 200
    etag = read.headers["ETag"]
    assert etag.startswith('"') and etag.endswith('"')

    accepted = await client.patch(
        f"{_URL}/{team['system_id']}", json={"name": "Platform Core"}, headers=_if_match(etag)
    )
    assert accepted.status_code == 200


async def test_a_reader_can_read_a_team(client, reader_client, team):
    resp = await reader_client.get(f"{_URL}/{team['system_id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Platform"


# ── Updating ──────────────────────────────────────────────────────────────────

async def test_a_team_can_be_renamed(client, team):
    tid = team["system_id"]
    resp = await client.patch(
        f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Platform Core"
    assert (await client.get(f"{_URL}/{tid}")).json()["name"] == "Platform Core"


async def test_an_explicit_null_description_clears_it(client):
    created = await _create(client, "Platform", description="Owns the pipeline")
    tid = created["system_id"]

    resp = await client.patch(
        f"{_URL}/{tid}", json={"description": None}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 200
    assert resp.json()["description"] is None


async def test_an_omitted_description_is_left_alone(client):
    # The distinction that makes the clear above meaningful: absent ≠ null.
    created = await _create(client, "Platform", description="Owns the pipeline")
    tid = created["system_id"]

    resp = await client.patch(
        f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "Owns the pipeline"


async def test_normal_day_hours_can_be_changed_and_stays_within_bounds(client, team):
    tid = team["system_id"]
    resp = await client.patch(
        f"{_URL}/{tid}", json={"normal_day_hours": 7.5}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 200
    assert resp.json()["normal_day_hours"] == 7.5

    rejected = await client.patch(
        f"{_URL}/{tid}", json={"normal_day_hours": 25.0}, headers=_if_match(await _etag(client, tid))
    )
    assert rejected.status_code == 422
    assert (await client.get(f"{_URL}/{tid}")).json()["normal_day_hours"] == 7.5


async def test_updating_a_team_that_does_not_exist_is_a_404(client, team):
    resp = await client.patch(
        f"{_URL}/no-such-team",
        json={"name": "Ghost"},
        headers=_if_match(await _etag(client, team["system_id"])),
    )
    assert resp.status_code == 404


async def test_a_write_without_if_match_is_refused_outright(client, team):
    resp = await client.patch(f"{_URL}/{team['system_id']}", json={"name": "Platform Core"})
    assert resp.status_code == 428
    assert resp.json()["detail"]["error"] == "IF_MATCH_REQUIRED"


async def test_a_wildcard_if_match_is_refused(client, team):
    # "*" means "any current representation" — that is last-write-wins under
    # another name, and it is exactly what If-Match is here to prevent.
    resp = await client.patch(
        f"{_URL}/{team['system_id']}", json={"name": "Platform Core"}, headers=_if_match("*")
    )
    assert resp.status_code == 428
    assert resp.json()["detail"]["error"] == "IF_MATCH_REQUIRED"


async def test_a_stale_if_match_is_rejected_and_hands_back_the_current_row(client, team):
    tid = team["system_id"]
    stale = await _etag(client, tid)

    first = await client.patch(f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(stale))
    assert first.status_code == 200

    second = await client.patch(f"{_URL}/{tid}", json={"name": "Platform Edge"}, headers=_if_match(stale))
    assert second.status_code == 412
    detail = second.json()["detail"]
    assert detail["error"] == "STALE"
    # The body carries the row as it now stands so the UI can offer
    # "keep theirs / reapply mine" rather than a silent refetch.
    assert detail["current"]["name"] == "Platform Core"
    assert detail["current"]["system_id"] == tid


async def test_the_etag_changes_after_a_successful_update(client, team):
    tid = team["system_id"]
    before = await _etag(client, tid)

    updated = await client.patch(f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(before))
    after = updated.headers["ETag"]

    # Without a fresh tag on the response, the next write could not be told apart
    # from a stale one — this is what makes lost updates detectable at all.
    assert after != before
    assert after == await _etag(client, tid)

    chained = await client.patch(f"{_URL}/{tid}", json={"name": "Platform Edge"}, headers=_if_match(after))
    assert chained.status_code == 200


async def test_renaming_onto_another_teams_name_is_rejected(client, team):
    other = await _create(client, "Delivery")

    resp = await client.patch(
        f"{_URL}/{other['system_id']}",
        json={"name": "platform"},
        headers=_if_match(await _etag(client, other["system_id"])),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "TEAM_NAME_TAKEN"

    assert (await client.get(f"{_URL}/{other['system_id']}")).json()["name"] == "Delivery"


async def test_a_reader_cannot_update_a_team(client, reader_client, team):
    tid = team["system_id"]
    resp = await reader_client.patch(
        f"{_URL}/{tid}", json={"name": "Readers Rename"}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 403


# ── Deleting ──────────────────────────────────────────────────────────────────

async def test_a_team_can_be_deleted(client, team):
    tid = team["system_id"]
    resp = await client.delete(f"{_URL}/{tid}", headers=_if_match(await _etag(client, tid)))
    assert resp.status_code == 204
    assert (await client.get(f"{_URL}/{tid}")).status_code == 404


async def test_deleting_a_team_takes_its_members_with_it(client, db, team):
    tid = team["system_id"]
    db.add(TeamMember(team_id=tid, name="Ada"))
    await db.commit()

    resp = await client.delete(f"{_URL}/{tid}", headers=_if_match(await _etag(client, tid)))
    assert resp.status_code == 204


async def test_deleting_a_team_requires_if_match(client, team):
    resp = await client.delete(f"{_URL}/{team['system_id']}")
    assert resp.status_code == 428
    assert resp.json()["detail"]["error"] == "IF_MATCH_REQUIRED"


async def test_deleting_with_a_stale_if_match_is_rejected(client, team):
    tid = team["system_id"]
    stale = await _etag(client, tid)
    await client.patch(f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(stale))

    resp = await client.delete(f"{_URL}/{tid}", headers=_if_match(stale))
    assert resp.status_code == 412
    assert resp.json()["detail"]["error"] == "STALE"
    assert (await client.get(f"{_URL}/{tid}")).status_code == 200


async def test_deleting_a_team_that_serves_projects_is_blocked_and_names_them(client, db, team):
    # §10: unassigning is the explicit step, so nobody loses a capacity model by
    # accident. The names come back because "unassign first" is useless without them.
    tid = team["system_id"]
    zulu = await _project(client, "Zulu")
    alpha = await _project(client, "Alpha")
    db.add(TeamProject(team_id=tid, project_id=zulu["system_id"]))
    db.add(TeamProject(team_id=tid, project_id=alpha["system_id"]))
    await db.commit()

    resp = await client.delete(f"{_URL}/{tid}", headers=_if_match(await _etag(client, tid)))
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "TEAM_HAS_PROJECTS"
    assert detail["projects"] == [
        {"system_id": alpha["system_id"], "name": "Alpha"},
        {"system_id": zulu["system_id"], "name": "Zulu"},
    ]
    assert (await client.get(f"{_URL}/{tid}")).status_code == 200


async def test_a_reader_cannot_delete_a_team(client, reader_client, team):
    tid = team["system_id"]
    resp = await reader_client.delete(f"{_URL}/{tid}", headers=_if_match(await _etag(client, tid)))
    assert resp.status_code == 403
    assert (await client.get(f"{_URL}/{tid}")).status_code == 200


# ── Counts on the response ────────────────────────────────────────────────────

async def test_member_count_and_project_ids_report_what_is_stored(client, db, team):
    tid = team["system_id"]
    project = await _project(client, "Roadmap")
    db.add_all([
        TeamMember(team_id=tid, name="Ada"),
        TeamMember(team_id=tid, name="Grace"),
        TeamProject(team_id=tid, project_id=project["system_id"]),
    ])
    await db.commit()

    one = (await client.get(f"{_URL}/{tid}")).json()
    assert one["member_count"] == 2
    assert one["project_ids"] == [project["system_id"]]

    listed = next(t for t in (await client.get(_URL)).json() if t["system_id"] == tid)
    assert listed["member_count"] == 2
    assert listed["project_ids"] == [project["system_id"]]


async def test_counts_do_not_bleed_between_teams(client, db, team):
    staffed = team["system_id"]
    empty = (await _create(client, "Delivery"))["system_id"]
    project = await _project(client, "Roadmap")
    db.add_all([
        TeamMember(team_id=staffed, name="Ada"),
        TeamProject(team_id=staffed, project_id=project["system_id"]),
    ])
    await db.commit()

    by_id = {t["system_id"]: t for t in (await client.get(_URL)).json()}
    assert by_id[empty]["member_count"] == 0
    assert by_id[empty]["project_ids"] == []
    assert by_id[staffed]["member_count"] == 1


# ── SSE ───────────────────────────────────────────────────────────────────────

async def test_updating_a_team_broadcasts_on_the_teams_own_channel(client, team):
    tid = team["system_id"]
    project = await _project(client, "Roadmap")

    with _listening(team_channel(tid)) as team_q, _listening(project["system_id"]) as project_q:
        resp = await client.patch(
            f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(await _etag(client, tid))
        )
        assert resp.status_code == 200
        events = _drain(team_q)
        # Teams are a separate aggregate: a project watcher must not be woken by
        # a team edit, and the team channel is what carries it instead.
        assert _drain(project_q) == []

    assert events == [{"type": "team:updated", "data": {"system_id": tid}}]


async def test_deleting_a_team_broadcasts_on_the_teams_own_channel(client, team):
    tid = team["system_id"]
    project = await _project(client, "Roadmap")

    with _listening(team_channel(tid)) as team_q, _listening(project["system_id"]) as project_q:
        resp = await client.delete(f"{_URL}/{tid}", headers=_if_match(await _etag(client, tid)))
        assert resp.status_code == 204
        events = _drain(team_q)
        assert _drain(project_q) == []

    assert events == [{"type": "team:deleted", "data": {"system_id": tid}}]


async def test_a_blocked_delete_broadcasts_nothing(client, db, team):
    tid = team["system_id"]
    project = await _project(client, "Roadmap")
    db.add(TeamProject(team_id=tid, project_id=project["system_id"]))
    await db.commit()

    with _listening(team_channel(tid)) as team_q:
        resp = await client.delete(f"{_URL}/{tid}", headers=_if_match(await _etag(client, tid)))
        assert resp.status_code == 409
        assert _drain(team_q) == []


# ── The 50-team cap (§9) ──────────────────────────────────────────────────────

@pytest.fixture
async def at_the_team_limit(db) -> None:
    db.add_all(Team(name=f"Seeded Team {i:02d}") for i in range(MAX_TEAMS))
    await db.commit()


async def test_creating_a_team_past_the_instance_limit_is_rejected(client, at_the_team_limit):
    assert len((await client.get(_URL)).json()) == MAX_TEAMS

    resp = await client.post(_URL, json={"name": "One Too Many"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "TEAM_LIMIT_REACHED"


async def test_the_limit_caps_creation_not_editing(client, at_the_team_limit):
    # A full instance must still be maintainable — the cap is on how many teams
    # exist, not on touching the ones that do.
    tid = (await client.get(_URL)).json()[0]["system_id"]
    resp = await client.patch(
        f"{_URL}/{tid}", json={"name": "Renamed At The Limit"}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 200


# ── The two design points a refactor could quietly undo ───────────────────────

async def test_a_team_write_succeeds_while_someone_else_holds_a_project_lock(
    client, editor_client, team
):
    # §4.1: team routes carry no project_id, so the single-writer lock does not
    # reach them. If this ever starts failing, the aggregates have been coupled.
    project = await _project(client, "Locked Project")
    acquired = await editor_client.post(f"/api/v1/projects/{project['system_id']}/edit-lock/acquire")
    assert acquired.status_code == 200

    blocked = await client.post(f"/api/v1/projects/{project['system_id']}/features", json={"title": "Nope"})
    assert blocked.status_code == 409

    tid = team["system_id"]
    resp = await client.patch(
        f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(await _etag(client, tid))
    )
    assert resp.status_code == 200


async def test_a_second_editor_racing_the_same_team_gets_412_not_409(client, editor_client, team):
    # §4.2 is explicit that the two must not be conflated: 409 means "someone
    # holds this project's lock, wait"; 412 means "this row moved under you".
    tid = team["system_id"]
    both_read = await _etag(client, tid)

    first = await client.patch(f"{_URL}/{tid}", json={"name": "Platform Core"}, headers=_if_match(both_read))
    assert first.status_code == 200

    second = await editor_client.patch(
        f"{_URL}/{tid}", json={"name": "Platform Edge"}, headers=_if_match(both_read)
    )
    assert second.status_code == 412
    assert second.json()["detail"]["error"] == "STALE"
