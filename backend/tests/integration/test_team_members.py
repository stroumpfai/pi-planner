"""Integration tests for members and their dated working patterns (§3.2, §3.3).

Two invariants are watched hardest here, because both are silent when broken:

- **A member always has a pattern version.** A versionless member computes as
  zero capacity, which reads as a team that does no work rather than as data
  nobody entered. Create writes both rows; delete refuses the earliest version.
- **A version's interval is derived, not stored.** Nothing writes an end date, so
  the tests assert on what a *date* resolves to rather than on any stored range —
  that is the only place the half-open rule is observable.
"""
from datetime import date, timedelta

import pytest

from app.schemas import MAX_MEMBERS_PER_TEAM, MAX_PATTERN_VERSIONS_PER_MEMBER
from app.services.events import broadcaster, team_channel

_TEAMS = "/api/v1/teams"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _members_url(team_id: str) -> str:
    return f"{_TEAMS}/{team_id}/members"


def _if_match(etag: str) -> dict[str, str]:
    return {"If-Match": etag}


async def _create_member(client, team_id: str, name: str = "Marta Lindqvist", **fields) -> dict:
    resp = await client.post(_members_url(team_id), json={"name": name, **fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _members(client, team_id: str, as_of: str | None = None) -> list[dict]:
    params = {"as_of": as_of} if as_of else None
    resp = await client.get(_members_url(team_id), params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _versions(client, team_id: str, member_id: str) -> list[dict]:
    resp = await client.get(f"{_members_url(team_id)}/{member_id}/working-days")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _add_version(client, team_id: str, member_id: str, etag: str | None = None, **fields) -> dict:
    resp = await _post_version(client, team_id, member_id, etag=etag, **fields)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _post_version(client, team_id: str, member_id: str, etag: str | None = None, **fields):
    """The raw response, for the cases where the status is the point."""
    return await client.post(
        f"{_members_url(team_id)}/{member_id}/working-days",
        json=fields,
        headers={"If-Match": etag} if etag else None,
    )


@pytest.fixture
async def team(client) -> dict:
    resp = await client.post(_TEAMS, json={"name": "Platform"})
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture
async def member(client, team) -> dict:
    return await _create_member(client, team["system_id"])


# ── Creating: member and first version, one transaction ───────────────────────

async def test_a_new_member_arrives_with_a_working_pattern(client, team, member):
    # No version means no contracted half-days, which computes as zero capacity
    # and reads as a bug rather than as missing data (§3.3).
    version = member["effective_version"]
    assert version is not None
    assert version["hours_per_day"] == 8.0
    assert version["focus"] == 1.0
    assert [version[f"{day}_am"] for day in ("mon", "tue", "wed", "thu", "fri")] == [True] * 5
    assert (version["sat_am"], version["sun_pm"]) == (False, False)
    assert member["version_dates"] == [version["effective_from"]]


async def test_the_first_version_starts_when_the_member_joins(client, team):
    member = await _create_member(client, team["system_id"], active_from="2026-10-01")
    assert member["effective_version"]["effective_from"] == "2026-10-01"


async def test_without_a_join_date_the_first_version_starts_today(client, team):
    member = await _create_member(client, team["system_id"])
    assert member["effective_version"]["effective_from"] == date.today().isoformat()


async def test_the_create_form_carries_the_whole_first_pattern(client, team):
    member = await _create_member(
        client,
        team["system_id"],
        name="Katrin Hofstetter",
        role="UX",
        organisation="BIT",
        pattern={
            "effective_from": "2026-01-01",
            "mon_am": False, "mon_pm": False,
            "fri_am": False, "fri_pm": False,
            "hours_per_day": 8.0,
            "focus": 0.9,
            "note": "60%",
        },
    )
    version = member["effective_version"]
    assert (version["mon_am"], version["fri_pm"]) == (False, False)
    assert (version["tue_am"], version["wed_pm"], version["thu_am"]) == (True, True, True)
    assert version["focus"] == 0.9
    assert version["note"] == "60%"
    assert (member["role"], member["organisation"]) == ("UX", "BIT")


async def test_role_and_organisation_are_free_text_and_optional(client, team):
    # No enum and no vocabulary table: a dropdown would imply a list somebody
    # maintains, and there is none (§3.2).
    invented = await _create_member(
        client, team["system_id"], name="Aïcha Ben Salah", role="Chief Whittler", organisation="Ω"
    )
    assert invented["role"] == "Chief Whittler"

    bare = await _create_member(client, team["system_id"], name="Tomas Bergerat")
    assert bare["role"] is None and bare["organisation"] is None


@pytest.mark.parametrize("field", ["role", "organisation"])
async def test_role_and_organisation_are_capped_at_fifty_characters(client, team, field):
    over = await client.post(_members_url(team["system_id"]), json={"name": "Long", field: "x" * 51})
    assert over.status_code == 422

    at_limit = await client.post(
        _members_url(team["system_id"]), json={"name": "Long", field: "x" * 50}
    )
    assert at_limit.status_code == 201


async def test_a_duplicate_member_name_is_rejected_case_insensitively(client, team, member):
    resp = await client.post(_members_url(team["system_id"]), json={"name": "mArTa lIndqvist"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "MEMBER_NAME_TAKEN"


async def test_the_same_name_on_another_team_is_fine(client, team, member):
    other = (await client.post(_TEAMS, json={"name": "Frontline"})).json()
    resp = await client.post(_members_url(other["system_id"]), json={"name": "Marta Lindqvist"})
    assert resp.status_code == 201


async def test_a_validity_window_that_ends_before_it_starts_is_rejected(client, team):
    resp = await client.post(
        _members_url(team["system_id"]),
        json={"name": "Backwards", "active_from": "2026-06-01", "active_to": "2026-05-01"},
    )
    assert resp.status_code == 422


async def test_a_team_holds_at_most_fifty_members(client, team):
    for index in range(MAX_MEMBERS_PER_TEAM):
        await _create_member(client, team["system_id"], name=f"Member {index}")

    resp = await client.post(_members_url(team["system_id"]), json={"name": "One Too Many"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "MEMBER_LIMIT_REACHED"


async def test_members_belong_to_the_team_in_the_path(client, team, member):
    other = (await client.post(_TEAMS, json={"name": "Frontline"})).json()
    resp = await client.get(f"{_members_url(other['system_id'])}/{member['system_id']}/working-days")
    assert resp.status_code == 404


async def test_a_reader_can_list_members_but_not_create_one(client, reader_client, team, member):
    assert len(await _members(reader_client, team["system_id"])) == 1
    resp = await reader_client.post(_members_url(team["system_id"]), json={"name": "Nope"})
    assert resp.status_code == 403


# ── The as-of date decides which version is shown ─────────────────────────────

async def test_the_effective_version_follows_the_as_of_date(client, team):
    member = await _create_member(
        client,
        team["system_id"],
        name="Katrin Hofstetter",
        pattern={"effective_from": "2026-01-01", "hours_per_day": 8.0, "focus": 0.9},
    )
    await _add_version(
        client, team["system_id"], member["system_id"],
        effective_from="2026-09-01", hours_per_day=6.0, focus=0.8, note="80% from Sep",
    )

    august = (await _members(client, team["system_id"], as_of="2026-08-31"))[0]
    september = (await _members(client, team["system_id"], as_of="2026-09-01"))[0]

    assert august["effective_version"]["hours_per_day"] == 8.0
    assert september["effective_version"]["hours_per_day"] == 6.0
    assert september["effective_version"]["note"] == "80% from Sep"
    # The timeline the Working days row draws: one marker per version (§7.3).
    assert september["version_dates"] == ["2026-01-01", "2026-09-01"]


async def test_a_date_before_the_first_version_still_resolves(client, team):
    # The earliest version extends backwards without limit, so no date is ever
    # undefined and no capacity query has to handle a missing pattern (§3.3).
    member = await _create_member(
        client, team["system_id"], pattern={"effective_from": "2026-01-01", "focus": 0.7}
    )
    long_ago = (await _members(client, team["system_id"], as_of="2001-01-01"))[0]
    assert long_ago["effective_version"]["focus"] == 0.7
    assert long_ago["effective_version"]["effective_from"] == "2026-01-01"


# ── Versions: adding, editing, deleting ───────────────────────────────────────

async def test_adding_a_version_on_an_existing_date_edits_it(client, team, member):
    first = member["effective_version"]
    edited = await _add_version(
        client, team["system_id"], member["system_id"], etag=first["etag"],
        effective_from=first["effective_from"], hours_per_day=6.0, focus=0.75,
    )

    assert edited["system_id"] == first["system_id"]
    assert (edited["hours_per_day"], edited["focus"]) == (6.0, 0.75)
    assert len(await _versions(client, team["system_id"], member["system_id"])) == 1


async def test_replacing_a_version_without_if_match_is_refused(client, team, member):
    # The overwrite branch of the upsert is a write like any other (§4.2): without
    # the header it is the same 428 the PATCH gives, not a silent lost update.
    first = member["effective_version"]
    resp = await _post_version(
        client, team["system_id"], member["system_id"],
        effective_from=first["effective_from"], hours_per_day=6.0,
    )

    assert resp.status_code == 428
    assert resp.json()["detail"]["error"] == "IF_MATCH_REQUIRED"
    unchanged = (await _versions(client, team["system_id"], member["system_id"]))[0]
    assert unchanged["hours_per_day"] == first["hours_per_day"]


async def test_replacing_a_version_with_a_stale_if_match_is_refused(client, team, member):
    first = member["effective_version"]
    await _add_version(
        client, team["system_id"], member["system_id"], etag=first["etag"],
        effective_from=first["effective_from"], hours_per_day=7.0,
    )

    # The second editor still holds the tag from before that edit.
    resp = await _post_version(
        client, team["system_id"], member["system_id"], etag=first["etag"],
        effective_from=first["effective_from"], hours_per_day=6.0,
    )

    assert resp.status_code == 412
    assert resp.json()["detail"]["error"] == "STALE"
    assert (await _versions(client, team["system_id"], member["system_id"]))[0]["hours_per_day"] == 7.0


async def test_adding_a_version_on_a_free_date_needs_no_if_match(client, team, member):
    # A create cannot clobber, so there is no ETag it could be made to quote.
    created = await _add_version(
        client, team["system_id"], member["system_id"],
        effective_from="2026-09-01", hours_per_day=6.0,
    )
    assert created["effective_from"] == "2026-09-01"


async def test_versions_come_back_in_date_order(client, team, member):
    for day in ("2026-11-01", "2026-03-01", "2026-07-01"):
        await _add_version(client, team["system_id"], member["system_id"], effective_from=day)

    dates = [v["effective_from"] for v in await _versions(client, team["system_id"], member["system_id"])]
    assert dates == sorted(dates)


async def test_deleting_a_version_hands_its_days_back_to_the_one_before(client, team):
    member = await _create_member(
        client, team["system_id"], pattern={"effective_from": "2026-01-01", "hours_per_day": 8.0}
    )
    second = await _add_version(
        client, team["system_id"], member["system_id"],
        effective_from="2026-09-01", hours_per_day=6.0,
    )

    # Mid-September resolves to the second version while it exists…
    before = (await _members(client, team["system_id"], as_of="2026-09-15"))[0]
    assert before["effective_version"]["hours_per_day"] == 6.0

    resp = await client.delete(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days/{second['system_id']}",
        headers=_if_match(second["etag"]),
    )
    assert resp.status_code == 204

    # …and to the first once it is gone. Nothing stored an end date: the merge is
    # what "derived interval" means (§3.3).
    after = (await _members(client, team["system_id"], as_of="2026-09-15"))[0]
    assert after["effective_version"]["hours_per_day"] == 8.0


async def test_the_earliest_version_cannot_be_deleted(client, team, member):
    first = member["effective_version"]
    await _add_version(
        client, team["system_id"], member["system_id"], effective_from="2027-01-01"
    )

    resp = await client.delete(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days/{first['system_id']}",
        headers=_if_match(first["etag"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EARLIEST_VERSION_NOT_DELETABLE"
    assert len(await _versions(client, team["system_id"], member["system_id"])) == 2


async def test_the_only_version_cannot_be_deleted_either(client, team, member):
    first = member["effective_version"]
    resp = await client.delete(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days/{first['system_id']}",
        headers=_if_match(first["etag"]),
    )
    assert resp.status_code == 409


async def test_a_version_patch_changes_only_what_it_names(client, team, member):
    first = member["effective_version"]
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days/{first['system_id']}",
        json={"fri_am": False, "fri_pm": False},
        headers=_if_match(first["etag"]),
    )
    assert resp.status_code == 200
    patched = resp.json()
    assert (patched["fri_am"], patched["fri_pm"]) == (False, False)
    assert patched["hours_per_day"] == 8.0
    assert patched["mon_am"] is True


async def test_moving_a_version_onto_another_versions_date_is_refused(client, team, member):
    first = member["effective_version"]
    second = await _add_version(
        client, team["system_id"], member["system_id"], effective_from="2027-01-01"
    )
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days/{second['system_id']}",
        json={"effective_from": first["effective_from"]},
        headers=_if_match(second["etag"]),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "PATTERN_VERSION_DATE_TAKEN"


async def test_a_member_holds_at_most_fifty_versions(client, team, member):
    start = date(2030, 1, 1)
    for offset in range(MAX_PATTERN_VERSIONS_PER_MEMBER - 1):
        await _add_version(
            client, team["system_id"], member["system_id"],
            effective_from=(start + timedelta(days=offset)).isoformat(),
        )

    resp = await client.post(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days",
        json={"effective_from": "2040-01-01"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "PATTERN_VERSION_LIMIT_REACHED"


@pytest.mark.parametrize("focus", [0.05, 1.5, 0.33])
async def test_focus_is_bounded_and_moves_in_steps_of_five_hundredths(client, team, member, focus):
    resp = await client.post(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days",
        json={"effective_from": "2027-01-01", "focus": focus},
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("hours", [0.5, 12.5])
async def test_hours_per_day_stays_within_one_to_twelve(client, team, member, hours):
    resp = await client.post(
        f"{_members_url(team['system_id'])}/{member['system_id']}/working-days",
        json={"effective_from": "2027-01-01", "hours_per_day": hours},
    )
    assert resp.status_code == 422


# ── Identity and validity live on the member; nothing dated does ──────────────

async def test_a_member_patch_edits_identity_and_validity(client, team, member):
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"role": "PO", "active_to": "2026-12-31"},
        headers=_if_match(member["etag"]),
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "PO"
    assert resp.json()["active_to"] == "2026-12-31"


async def test_hours_and_focus_cannot_be_written_through_the_member(client, team, member):
    # Changing either means dating a new version, not overwriting a field — so the
    # member schema has nowhere to put them and they are ignored (§7.2).
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"hours_per_day": 4.0, "focus": 0.5},
        headers=_if_match(member["etag"]),
    )
    assert resp.status_code == 200
    assert resp.json()["effective_version"]["hours_per_day"] == 8.0
    assert resp.json()["effective_version"]["focus"] == 1.0


async def test_clearing_a_role_is_different_from_leaving_it_alone(client, team):
    member = await _create_member(client, team["system_id"], role="Dev", organisation="BIT")

    cleared = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"role": None},
        headers=_if_match(member["etag"]),
    )
    assert cleared.json()["role"] is None
    assert cleared.json()["organisation"] == "BIT"


async def test_a_patch_that_inverts_the_validity_window_is_refused(client, team):
    member = await _create_member(client, team["system_id"], active_from="2026-06-01")
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"active_to": "2026-05-01"},
        headers=_if_match(member["etag"]),
    )
    assert resp.status_code == 422


# ── Order ─────────────────────────────────────────────────────────────────────

async def test_members_list_in_their_display_order(client, team):
    names = ["Marta", "Tomas", "Aïcha"]
    created = [await _create_member(client, team["system_id"], name=n) for n in names]

    assert [m["name"] for m in await _members(client, team["system_id"])] == names

    resp = await client.post(
        f"{_members_url(team['system_id'])}/reorder",
        json={"order": [created[2]["system_id"], created[0]["system_id"], created[1]["system_id"]]},
    )
    assert resp.status_code == 200
    assert [m["name"] for m in resp.json()] == ["Aïcha", "Marta", "Tomas"]
    assert [m["name"] for m in await _members(client, team["system_id"])] == ["Aïcha", "Marta", "Tomas"]


async def test_a_reader_cannot_reorder_members(client, reader_client, team, member):
    resp = await reader_client.post(
        f"{_members_url(team['system_id'])}/reorder", json={"order": [member["system_id"]]}
    )
    assert resp.status_code == 403


# ── Deleting ──────────────────────────────────────────────────────────────────

async def test_deleting_a_member_takes_their_versions_with_them(client, team, member):
    await _add_version(client, team["system_id"], member["system_id"], effective_from="2027-01-01")

    resp = await client.delete(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        headers=_if_match(member["etag"]),
    )
    assert resp.status_code == 204
    assert await _members(client, team["system_id"]) == []


async def test_a_member_row_says_what_deleting_it_would_take(client, team, member):
    # The confirm dialog states the counts before anything goes (§10).
    assert member["absence_count"] == 0
    assert member["meeting_count"] == 0


async def test_a_reader_cannot_delete_a_member(client, reader_client, team, member):
    resp = await reader_client.delete(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        headers=_if_match(member["etag"]),
    )
    assert resp.status_code == 403


# ── Concurrency (§4.2) ────────────────────────────────────────────────────────

async def test_a_member_write_without_if_match_is_refused(client, team, member):
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}", json={"role": "PO"}
    )
    assert resp.status_code == 428
    assert resp.json()["detail"]["error"] == "IF_MATCH_REQUIRED"


async def test_a_stale_member_write_is_412_and_carries_the_current_row(client, team, member):
    stale = member["etag"]
    first = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"role": "PO"},
        headers=_if_match(stale),
    )
    assert first.status_code == 200

    second = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"role": "Dev"},
        headers=_if_match(stale),
    )
    assert second.status_code == 412
    detail = second.json()["detail"]
    assert detail["error"] == "STALE"
    # 412 is not 409: it means *this row changed under you, here it is* (§4.2).
    assert detail["current"]["role"] == "PO"


async def test_a_stale_version_write_is_412(client, team, member):
    first = member["effective_version"]
    url = f"{_members_url(team['system_id'])}/{member['system_id']}/working-days/{first['system_id']}"

    assert (await client.patch(url, json={"focus": 0.8}, headers=_if_match(first["etag"]))).status_code == 200
    resp = await client.patch(url, json={"focus": 0.6}, headers=_if_match(first["etag"]))
    assert resp.status_code == 412
    assert resp.json()["detail"]["current"]["focus"] == 0.8


async def test_the_etag_a_row_carries_is_the_one_a_write_must_quote(client, team, member):
    # Members are read as a collection, so the tag rides in the body: a header can
    # only describe one row.
    listed = (await _members(client, team["system_id"]))[0]
    resp = await client.patch(
        f"{_members_url(team['system_id'])}/{member['system_id']}",
        json={"role": "SM"},
        headers=_if_match(listed["etag"]),
    )
    assert resp.status_code == 200


# ── Events (§8.1) ─────────────────────────────────────────────────────────────

async def test_member_writes_broadcast_on_the_team_channel(client, team):
    channel = team_channel(team["system_id"])
    q = broadcaster._subscribe(channel)
    try:
        member = await _create_member(client, team["system_id"])
        await client.patch(
            f"{_members_url(team['system_id'])}/{member['system_id']}",
            json={"role": "PO"},
            headers=_if_match(member["etag"]),
        )
        events = []
        while not q.empty():
            events.append(q.get_nowait())
    finally:
        broadcaster._unsubscribe(channel, q)

    assert [e["type"] for e in events] == ["team:member:created", "team:member:updated"]


async def test_a_pattern_change_broadcasts_too(client, team, member):
    channel = team_channel(team["system_id"])
    q = broadcaster._subscribe(channel)
    try:
        await _add_version(
            client, team["system_id"], member["system_id"], effective_from="2027-01-01"
        )
        events = []
        while not q.empty():
            events.append(q.get_nowait())
    finally:
        broadcaster._unsubscribe(channel, q)

    assert [e["type"] for e in events] == ["team:member:pattern:changed"]
