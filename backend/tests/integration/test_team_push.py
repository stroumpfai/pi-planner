"""Getting the number onto the board, and refusing to when it would lie (§6.6–§6.8).

The arithmetic behind every figure here is unit-tested against a hand-computed
fixture in `tests/unit/test_team_capacity.py`. What these tests watch is the
boundary the push draws around it: which sprints are written, what the second
identical push does, who is refused, and the two guards that stop a hand-typed
number from being overwritten without warning.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import get_session
from app.main import app
from app.models.user import Role
from app.services import users as users_module
from app.services.auth import hash_password

pytestmark = pytest.mark.asyncio

_TEAMS = "/api/v1/teams"
_OTHER_SECRET = "otherpass"  # noqa: S105


def _preview_url(project_id: str) -> str:
    return f"/api/v1/projects/{project_id}/team-capacity/preview"


def _apply_url(project_id: str) -> str:
    return f"/api/v1/projects/{project_id}/team-capacity/apply"


async def _project(client, name: str, effort_unit: str = "pts") -> dict:
    resp = await client.post("/api/v1/projects/", json={"name": name, "effort_unit": effort_unit})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _pi(client, project_id: str, name: str, dates: dict[int, tuple[str, str]]) -> dict:
    """A PI whose sprints carry the given dates. Untouched sprints stay undated."""
    resp = await client.post(
        f"/api/v1/projects/{project_id}/pis", json={"name": name, "start_date": "2026-04-06"}
    )
    assert resp.status_code == 201, resp.text
    pi = resp.json()
    sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
    by_index = {s["sprint_index"]: s for s in sprints}
    for index, (start, end) in dates.items():
        patched = await client.patch(
            f"/api/v1/sprints/{by_index[index]['system_id']}",
            json={"start_date": start, "end_date": end},
        )
        assert patched.status_code == 200, patched.text
    return pi


async def _sprints(client, pi_id: str) -> list[dict]:
    return (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()


async def _member(client, team_id: str, name: str, **pattern) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members",
        json={"name": name, "pattern": {"effective_from": "2026-01-01", **pattern}},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _assign(client, team_id: str, project_id: str, **fields) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/projects", json={"project_id": project_id, **fields}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest_asyncio.fixture
async def second_client(db):
    """A second authenticated editor — the one who holds the lock in these tests."""
    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session
    await users_module.create(
        db,
        username="mfranck",
        password_hash=hash_password(_OTHER_SECRET),
        display_name=None,
        role=Role.editor,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as ac:
        resp = await ac.post(
            "/api/v1/auth/login", json={"username": "mfranck", "password": _OTHER_SECRET}
        )
        assert resp.status_code == 200
        yield ac


@pytest_asyncio.fixture
async def served(client):
    """One team of two full-timers serving one project on a factor of 1.5 pts/PD.

    Two members × 10 working days × 8 h ÷ 8 h = 20 PD per fortnight, at a 70%
    share and 1.5 pts per PD: 20 × 0.70 × 1.5 = 21 pts. That whole number is not
    an accident — the rounding is covered on its own below.
    """
    team = (await client.post(_TEAMS, json={"name": "Platform"})).json()
    project = await _project(client, "ISK Portal")
    await _member(client, team["system_id"], "Anna")
    await _member(client, team["system_id"], "Bruno")
    pi = await _pi(
        client,
        project["system_id"],
        "PI-7",
        {0: ("2026-04-06", "2026-04-17"), 1: ("2026-04-20", "2026-05-01")},
    )
    await _assign(
        client,
        team["system_id"],
        project["system_id"],
        share_pct=70,
        available_source="factor",
        units_per_pd=1.5,
    )
    return {"team": team, "project": project, "pi": pi}


# ── Preview ───────────────────────────────────────────────────────────────────

async def test_the_preview_shows_the_integer_it_will_write(client, served):
    resp = await client.get(_preview_url(served["project"]["system_id"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["team_name"] == "Platform"
    assert body["share_pct"] == 70
    assert body["units_per_pd"] == 1.5
    dated = [row for row in body["sprints"] if row["start_date"]]
    assert [row["proposed_available"] for row in dated] == [21, 21]
    # The float behind it travels with the integer, so a surprising proposal is
    # traceable without opening the Capacity view (§6.7).
    assert dated[0]["team_person_days"] == pytest.approx(20.0)
    assert dated[0]["in_project_units"] == pytest.approx(21.0)
    assert dated[0]["delta"] == 21
    assert body["changed_count"] == 2
    assert body["total_delta"] == 42


async def test_the_preview_writes_nothing(client, served):
    await client.get(_preview_url(served["project"]["system_id"]))
    sprints = await _sprints(client, served["pi"]["system_id"])
    assert [s["available"] for s in sprints] == [0, 0, 0, 0, 0]
    assert all(s["available_pushed_at"] is None for s in sprints)


async def test_an_undated_sprint_proposes_nothing(client, served):
    body = (await client.get(_preview_url(served["project"]["system_id"]))).json()
    undated = [row for row in body["sprints"] if row["start_date"] is None]

    assert len(undated) == 3
    # Null, not zero: a sprint nobody has dated cannot be given a budget from a
    # calendar it is not on (§5.3).
    assert all(row["proposed_available"] is None for row in undated)
    assert all(row["delta"] is None for row in undated)


async def test_a_closed_pi_never_reaches_the_preview(client, served):
    await client.patch(
        f"/api/v1/pis/{served['pi']['system_id']}", json={"state": "in_progress"}
    )
    await client.patch(f"/api/v1/pis/{served['pi']['system_id']}", json={"state": "closed"})

    body = (await client.get(_preview_url(served["project"]["system_id"]))).json()
    assert body["sprints"] == []


async def test_a_window_narrows_the_preview_to_the_sprints_inside_it(client, served):
    body = (
        await client.get(
            _preview_url(served["project"]["system_id"]),
            params={"from": "2026-04-20", "to": "2026-05-01"},
        )
    ).json()

    assert [row["label"] for row in body["sprints"]] == ["PI-7.2"]


# ── Apply ─────────────────────────────────────────────────────────────────────

async def test_applying_writes_available_and_stamps_the_push(client, served):
    resp = await client.post(_apply_url(served["project"]["system_id"]))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "project_id": served["project"]["system_id"],
        "project_name": "ISK Portal",
        "status": "updated",
        "updated_sprints": 2,
        "total_delta": 42,
        "message": None,
        "locked_by": None,
        "locked_until": None,
    }

    sprints = await _sprints(client, served["pi"]["system_id"])
    assert [s["available"] for s in sprints] == [21, 21, 0, 0, 0]
    assert sprints[0]["available_pushed_at"] is not None
    # An undated sprint is not written at all, so it carries no push stamp.
    assert sprints[2]["available_pushed_at"] is None


async def test_a_second_push_with_nothing_changed_writes_nothing(client, served):
    await client.post(_apply_url(served["project"]["system_id"]))
    first = (await _sprints(client, served["pi"]["system_id"]))[0]

    resp = await client.post(_apply_url(served["project"]["system_id"]))
    assert resp.json()["status"] == "no_change"
    assert resp.json()["updated_sprints"] == 0

    again = (await _sprints(client, served["pi"]["system_id"]))[0]
    # Not even the timestamp moves: "last pushed" must not come to mean "last
    # time somebody clicked".
    assert again["available_pushed_at"] == first["available_pushed_at"]
    assert again["modified_at"] == first["modified_at"]


async def test_a_push_totals_the_stored_integers_not_the_rounded_floats(client, served):
    # 20 PD × 0.70 × 1.55 = 21.7 → 22 per sprint. The PI total is 44 — the sum of
    # what was stored — and never 43 from rounding 43.4 once (§6.4).
    rows = (await client.get(f"{_TEAMS}/{served['team']['system_id']}/projects")).json()
    await client.patch(
        f"{_TEAMS}/{served['team']['system_id']}/projects/{served['project']['system_id']}",
        json={"units_per_pd": 1.55},
        headers={"If-Match": rows[0]["etag"]},
    )
    await client.post(_apply_url(served["project"]["system_id"]))

    pi = (await client.get(f"/api/v1/pis/{served['pi']['system_id']}")).json()
    sprints = await _sprints(client, served["pi"]["system_id"])
    assert [s["available"] for s in sprints[:2]] == [22, 22]
    assert pi["total_available"] == 44


async def test_rounding_is_half_up_not_bankers(client, served):
    # 20 PD × 0.70 × 1.75 = 24.5. Python's round() gives 24; a sprint header must
    # read 25 (§6.4).
    rows = (await client.get(f"{_TEAMS}/{served['team']['system_id']}/projects")).json()
    await client.patch(
        f"{_TEAMS}/{served['team']['system_id']}/projects/{served['project']['system_id']}",
        json={"units_per_pd": 1.75},
        headers={"If-Match": rows[0]["etag"]},
    )

    body = (await client.get(_preview_url(served["project"]["system_id"]))).json()
    assert body["sprints"][0]["proposed_available"] == 25


async def test_an_absence_lowers_what_the_push_writes(client, served):
    members = (await client.get(f"{_TEAMS}/{served['team']['system_id']}/members")).json()
    resp = await client.post(
        f"{_TEAMS}/{served['team']['system_id']}/absences",
        json={
            "member_ids": [members[0]["system_id"]],
            "label": "Holiday",
            "kind": "range",
            "start_date": "2026-04-06",
            "end_date": "2026-04-10",
        },
    )
    assert resp.status_code == 201, resp.text

    body = (await client.get(_preview_url(served["project"]["system_id"]))).json()
    # A full week gone from one of two people: 15 PD × 0.70 × 1.5 = 15.75 → 16.
    assert body["sprints"][0]["proposed_available"] == 16
    assert body["sprints"][1]["proposed_available"] == 21


# ── Refusals ──────────────────────────────────────────────────────────────────

async def test_a_manual_project_refuses_both_endpoints(client, team_and_manual_project):
    project_id = team_and_manual_project["project"]["system_id"]

    for resp in (
        await client.get(_preview_url(project_id)),
        await client.post(_apply_url(project_id)),
    ):
        assert resp.status_code == 409, resp.text
        # Silently doing nothing would look like a bug (§6.7).
        assert resp.json()["detail"]["error"] == "AVAILABLE_SOURCE_IS_MANUAL"


async def test_a_project_with_no_team_has_nothing_to_push(client):
    project = await _project(client, "Testing")
    resp = await client.get(_preview_url(project["system_id"]))
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "PROJECT_HAS_NO_TEAM"


async def test_a_push_is_refused_while_another_user_holds_the_lock(
    client, second_client, served
):
    project_id = served["project"]["system_id"]
    acquired = await second_client.post(f"/api/v1/projects/{project_id}/edit-lock/acquire")
    assert acquired.status_code == 200, acquired.text

    resp = await client.post(_apply_url(project_id))
    assert resp.status_code == 409
    assert resp.json()["detail"]["locked_by"] == "mfranck"
    assert [s["available"] for s in await _sprints(client, served["pi"]["system_id"])][0] == 0


async def test_a_reader_cannot_push_but_can_read_staleness(reader_client, client, served):
    project_id = served["project"]["system_id"]
    assert (await reader_client.post(_apply_url(project_id))).status_code == 403
    # Staleness is information, not an action (design §1).
    status = await reader_client.get("/api/v1/team-capacity/status")
    assert status.status_code == 200
    assert status.json()[0]["stale_sprints"] == 2


# ── Staleness (§6.6) ──────────────────────────────────────────────────────────

async def test_staleness_counts_the_sprints_that_would_actually_change(client, served):
    before = (await client.get("/api/v1/team-capacity/status")).json()
    assert before[0]["stale_sprints"] == 2
    assert before[0]["last_pushed_at"] is None
    assert before[0]["team_name"] == "Platform"

    await client.post(_apply_url(served["project"]["system_id"]))

    after = (await client.get("/api/v1/team-capacity/status")).json()
    assert after[0]["stale_sprints"] == 0
    assert after[0]["last_pushed_at"] is not None


async def test_a_change_too_small_to_move_the_integer_leaves_the_project_alone(
    client, served
):
    await client.post(_apply_url(served["project"]["system_id"]))
    members = (await client.get(f"{_TEAMS}/{served['team']['system_id']}/members")).json()

    # Half a day off one member: 19.5 PD × 0.70 × 1.5 = 20.475 → 20, which does
    # move. Add it and take it away again; values are compared, not an input
    # fingerprint, so nothing is reported (§6.6).
    created = await client.post(
        f"{_TEAMS}/{served['team']['system_id']}/absences",
        json={
            "member_ids": [members[0]["system_id"]],
            "label": "Dentist",
            "kind": "range",
            "start_date": "2026-04-07",
            "end_date": "2026-04-07",
            "start_half": "am",
            "end_half": "am",
        },
    )
    assert created.status_code == 201, created.text
    absence = created.json()[0]
    await client.delete(
        f"{_TEAMS}/{served['team']['system_id']}/absences/{absence['system_id']}",
        headers={"If-Match": absence["etag"]},
    )

    status = (await client.get("/api/v1/team-capacity/status")).json()
    assert status[0]["stale_sprints"] == 0


async def test_a_manual_project_is_never_stale(client, team_and_manual_project):
    status = (await client.get("/api/v1/team-capacity/status")).json()
    assert status[0]["available_source"] == "manual"
    assert status[0]["stale_sprints"] == 0


async def test_status_can_be_narrowed_to_one_project(client, served):
    other = await _project(client, "Data Exchange")
    team = (await client.post(_TEAMS, json={"name": "Frontline"})).json()
    await _assign(client, team["system_id"], other["system_id"])

    every = (await client.get("/api/v1/team-capacity/status")).json()
    assert len(every) == 2

    one = (
        await client.get(
            "/api/v1/team-capacity/status",
            params={"project_id": served["project"]["system_id"]},
        )
    ).json()
    assert [row["project_name"] for row in one] == ["ISK Portal"]


# ── The derived-Available guard (WP-7D) ───────────────────────────────────────

async def test_a_derived_available_cannot_be_typed_by_hand(client, served):
    sprint = (await _sprints(client, served["pi"]["system_id"]))[0]
    resp = await client.patch(f"/api/v1/sprints/{sprint['system_id']}", json={"available": 99})

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "AVAILABLE_IS_DERIVED"
    assert "Platform" in detail["message"]
    assert (await _sprints(client, served["pi"]["system_id"]))[0]["available"] == 0


async def test_dates_stay_writable_on_a_derived_project(client, served):
    sprint = (await _sprints(client, served["pi"]["system_id"]))[0]
    resp = await client.patch(
        f"/api/v1/sprints/{sprint['system_id']}",
        json={"start_date": "2026-04-07", "end_date": "2026-04-17"},
    )
    assert resp.status_code == 200


async def test_a_manual_project_still_takes_a_hand_typed_available(
    client, team_and_manual_project
):
    sprint = (await _sprints(client, team_and_manual_project["pi"]["system_id"]))[0]
    resp = await client.patch(f"/api/v1/sprints/{sprint['system_id']}", json={"available": 30})
    assert resp.status_code == 200
    assert resp.json()["available"] == 30
    assert resp.json()["available_pushed_at"] is None


async def test_typing_a_value_clears_the_push_stamp(client, served):
    await client.post(_apply_url(served["project"]["system_id"]))
    rows = (await client.get(f"{_TEAMS}/{served['team']['system_id']}/projects")).json()
    await client.patch(
        f"{_TEAMS}/{served['team']['system_id']}/projects/{served['project']['system_id']}",
        json={"available_source": "manual"},
        headers={"If-Match": rows[0]["etag"]},
    )

    sprint = (await _sprints(client, served["pi"]["system_id"]))[0]
    resp = await client.patch(f"/api/v1/sprints/{sprint['system_id']}", json={"available": 30})
    assert resp.status_code == 200
    # The header must stop claiming a push it no longer reflects.
    assert resp.json()["available_pushed_at"] is None


# ── The multi-project push (WP-7B) ────────────────────────────────────────────

async def test_a_locked_project_fails_alone_while_the_others_apply(
    client, second_client, served
):
    other = await _project(client, "Data Exchange")
    other_pi = await _pi(
        client, other["system_id"], "PI-7", {0: ("2026-04-06", "2026-04-17")}
    )
    await _assign(
        client,
        served["team"]["system_id"],
        other["system_id"],
        share_pct=30,
        available_source="factor",
        units_per_pd=1.0,
    )
    await second_client.post(f"/api/v1/projects/{other['system_id']}/edit-lock/acquire")

    resp = await client.post(f"{_TEAMS}/{served['team']['system_id']}/push")
    assert resp.status_code == 200, resp.text
    by_name = {row["project_name"]: row for row in resp.json()["results"]}

    assert by_name["ISK Portal"]["status"] == "updated"
    assert by_name["ISK Portal"]["updated_sprints"] == 2
    # Failing all of them because someone is editing one would reintroduce exactly
    # the coupling this design removes (§6.7).
    assert by_name["Data Exchange"]["status"] == "locked"
    assert by_name["Data Exchange"]["locked_by"] == "mfranck"

    assert [s["available"] for s in await _sprints(client, served["pi"]["system_id"])][0] == 21
    assert [s["available"] for s in await _sprints(client, other_pi["system_id"])][0] == 0


async def test_a_manual_project_in_a_team_push_reports_rather_than_fails(client, served):
    other = await _project(client, "Data Exchange")
    await _assign(client, served["team"]["system_id"], other["system_id"], share_pct=30)

    results = (
        await client.post(f"{_TEAMS}/{served['team']['system_id']}/push")
    ).json()["results"]
    by_name = {row["project_name"]: row["status"] for row in results}

    assert by_name == {"ISK Portal": "updated", "Data Exchange": "manual"}


# ── Sprint date alignment (WP-7G, §6.8) ───────────────────────────────────────

async def test_alignment_is_unenforced_while_a_team_serves_one_project(client, served):
    sprint = (await _sprints(client, served["pi"]["system_id"]))[0]
    resp = await client.patch(
        f"/api/v1/sprints/{sprint['system_id']}",
        json={"start_date": "2026-04-01", "end_date": "2026-04-14"},
    )
    assert resp.status_code == 200


async def test_a_second_project_cannot_join_with_misaligned_sprints(client, served):
    other = await _project(client, "Data Exchange")
    await _pi(client, other["system_id"], "Q2", {0: ("2026-04-07", "2026-04-18")})

    resp = await client.post(
        f"{_TEAMS}/{served['team']['system_id']}/projects", json={"project_id": other["system_id"]}
    )
    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    assert detail["error"] == "SPRINT_DATES_MISALIGNED"
    # Both ranges are named, or there is nothing to go and fix (§6.8).
    assert "2026-04-07" in detail["message"] and "2026-04-06" in detail["message"]
    assert detail["conflicts"][0]["sprint_number"] == 1


async def test_a_second_project_joins_when_its_sprints_line_up(client, served):
    other = await _project(client, "Data Exchange")
    await _pi(client, other["system_id"], "Q2", {0: ("2026-04-06", "2026-04-17")})

    resp = await client.post(
        f"{_TEAMS}/{served['team']['system_id']}/projects", json={"project_id": other["system_id"]}
    )
    assert resp.status_code == 201, resp.text


async def test_breaking_alignment_after_assignment_is_rejected(client, served):
    other = await _project(client, "Data Exchange")
    other_pi = await _pi(client, other["system_id"], "Q2", {0: ("2026-04-06", "2026-04-17")})
    await _assign(client, served["team"]["system_id"], other["system_id"])

    sprint = (await _sprints(client, other_pi["system_id"]))[0]
    resp = await client.patch(
        f"/api/v1/sprints/{sprint['system_id']}", json={"start_date": "2026-04-08"}
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["error"] == "SPRINT_DATES_MISALIGNED"
    # Rejected means unwritten: the date is still what it was.
    assert (await _sprints(client, other_pi["system_id"]))[0]["start_date"] == "2026-04-06"


async def test_pis_that_do_not_overlap_in_time_are_not_compared(client, served):
    other = await _project(client, "Data Exchange")
    later = await _pi(client, other["system_id"], "Q3", {0: ("2026-09-07", "2026-09-18")})
    await _assign(client, served["team"]["system_id"], other["system_id"])

    sprint = (await _sprints(client, later["system_id"]))[1]
    # A different fortnight entirely — there is nothing for it to align with.
    resp = await client.patch(
        f"/api/v1/sprints/{sprint['system_id']}",
        json={"start_date": "2026-09-21", "end_date": "2026-10-02"},
    )
    assert resp.status_code == 200, resp.text


@pytest_asyncio.fixture
async def team_and_manual_project(client):
    """A team serving a project that still types its Available by hand (§6.4)."""
    team = (await client.post(_TEAMS, json={"name": "Platform"})).json()
    project = await _project(client, "ISK Portal")
    await _member(client, team["system_id"], "Anna")
    pi = await _pi(client, project["system_id"], "PI-7", {0: ("2026-04-06", "2026-04-17")})
    await _assign(client, team["system_id"], project["system_id"])
    return {"team": team, "project": project, "pi": pi}
