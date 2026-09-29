"""CSV import: placing items on the PI board from their Iteration Path."""
from typing import Any

import pytest
from httpx import AsyncClient

PI8 = "Planner\\PI 08"
PI9 = "Planner\\PI 09"


def _url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/import/csv"


def _row(n: int, item_type: str, title: str, **kw: Any) -> dict[str, Any]:
    return {"row_number": n, "item_type": item_type, "title": title, **kw}


async def _import(
    client: AsyncClient, pid: str, rows: list[dict[str, Any]], *, apply: bool = True,
    dry_run: bool = False, column: bool = True,
) -> dict[str, Any]:
    """Run the import; the result carries the plan from a dry run of the same request."""
    body = {"rows": rows, "has_iteration_column": column, "apply_iterations": apply}
    review = await client.post(_url(pid) + "?dry_run=true", json=body)
    assert review.status_code == 200, review.text
    if dry_run:
        return dict(review.json())
    resp = await client.post(_url(pid), json=body)
    assert resp.status_code == 200, resp.text
    return {**resp.json(), "plan": review.json()["plan"]}


async def _make_pi(client: AsyncClient, pid: str, name: str, path: str | None) -> dict[str, Any]:
    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": name})).json()
    if path is not None:
        await client.patch(f"/api/v1/pis/{pi['system_id']}", json={"iteration_path": path})
        sprints = (await client.get(f"/api/v1/pis/{pi['system_id']}/sprints")).json()
        for s in sprints:
            resp = await client.patch(
                f"/api/v1/sprints/{s['system_id']}",
                json={"iteration_path": f"{path}\\Sprint {s['sprint_index'] + 1}"},
            )
            assert resp.status_code == 200, resp.text
    return dict(pi)


async def _lanes(client: AsyncClient, pi: dict[str, Any]) -> dict[str, str]:
    lanes = (await client.get(f"/api/v1/pis/{pi['system_id']}/swimlines")).json()
    return {lane["name"]: lane["system_id"] for lane in lanes}


async def _feature(client: AsyncClient, pid: str, user_id: int) -> dict[str, Any]:
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    return dict(next(f for f in features if f["id"] == user_id))


async def _pbi(client: AsyncClient, pid: str, user_id: int) -> dict[str, Any]:
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    return dict(next(p for p in pbis if p["id"] == user_id))


async def _sprint_of(client: AsyncClient, pbi: dict[str, Any]) -> int | None:
    if pbi["group_id"] is None:
        return None
    group = (await client.get(f"/api/v1/groups/{pbi['group_id']}")).json()
    return int(group["sprint_index"]) if group["sprint_index"] is not None else None


@pytest.fixture
async def pid(client: AsyncClient) -> str:
    project = (await client.post("/api/v1/projects/", json={"name": "Iterations"})).json()
    return str(project["system_id"])


# ── Matching ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_feature_and_stories_land_in_pi_and_sprints(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    data = await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
        _row(3, "story", "Login", user_id=201, parent_id=101, iteration=PI8 + "\\Sprint 1"),
        _row(4, "story", "Reset", user_id=202, parent_id=101, iteration=PI8 + "\\Sprint 2"),
    ])
    assert data["items_placed"] == 3

    feature = await _feature(client, pid, 101)
    lanes = await _lanes(client, pi)
    assert feature["location"] == "pi"
    assert feature["pi_id"] == pi["system_id"]
    assert feature["swimlane_id"] == lanes["Needs Swimlane"]
    assert await _sprint_of(client, await _pbi(client, pid, 201)) == 0
    assert await _sprint_of(client, await _pbi(client, pid, 202)) == 1


@pytest.mark.asyncio
async def test_matching_ignores_case_separators_and_spacing(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=" planner / pi  08/ "),
    ])
    assert (await _feature(client, pid, 101))["pi_id"] == pi["system_id"]


@pytest.mark.asyncio
async def test_unmatched_path_leaves_new_item_in_backlog_and_is_reported(client, pid):
    await _make_pi(client, pid, "PI 08", PI8)
    data = await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI9),
        _row(3, "feature", "Pay", user_id=102, iteration="planner\\pi 09"),
        _row(4, "feature", "Root", user_id=103, iteration="Planner"),
        _row(5, "feature", "Blank", user_id=104, iteration=""),
    ])
    assert data["items_placed"] == 0
    assert data["unmatched_iterations"] == [
        {"path": PI9, "rows": 2},
        {"path": "Planner", "rows": 1},
    ]
    for uid in (101, 102, 103, 104):
        assert (await _feature(client, pid, uid))["location"] == "backlog"


@pytest.mark.asyncio
async def test_unmatched_path_never_moves_a_placed_feature_to_backlog(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)])
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration="Planner")])
    assert (await _feature(client, pid, 101))["pi_id"] == pi["system_id"]


# ── Opt-out ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_opted_out_import_places_nothing(client, pid):
    await _make_pi(client, pid, "PI 08", PI8)
    data = await _import(
        client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)], apply=False,
    )
    assert data["items_placed"] == 0
    assert (await _feature(client, pid, 101))["location"] == "backlog"


@pytest.mark.asyncio
async def test_file_without_the_column_places_nothing(client, pid):
    await _make_pi(client, pid, "PI 08", PI8)
    await _import(
        client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)], column=False,
    )
    assert (await _feature(client, pid, 101))["location"] == "backlog"


@pytest.mark.asyncio
async def test_dry_run_reports_placement_and_writes_nothing(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    data = await _import(
        client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)], dry_run=True,
    )
    placed = [c for c in data["plan"] if c["action"] == "placed"]
    assert placed[0]["detail"] == "→ PI 08 · Needs Swimlane"
    assert await _lanes(client, pi) == {}
    assert (await client.get(f"/api/v1/projects/{pid}/features")).json() == []


# ── Features ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_needs_swimlane_is_reused_not_duplicated(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)])
    await _import(client, pid, [_row(2, "feature", "Pay", user_id=102, iteration=PI8)])
    lanes = await _lanes(client, pi)
    assert list(lanes) == ["Needs Swimlane"]
    assert (await _feature(client, pid, 102))["swimlane_id"] == lanes["Needs Swimlane"]


@pytest.mark.asyncio
async def test_renamed_needs_swimlane_is_no_longer_the_landing_spot(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)])
    lane_id = (await _lanes(client, pi))["Needs Swimlane"]
    await client.patch(f"/api/v1/swimlines/{lane_id}", json={"name": "Team A"})
    await _import(client, pid, [_row(2, "feature", "Pay", user_id=102, iteration=PI8)])
    lanes = await _lanes(client, pi)
    assert set(lanes) == {"Team A", "Needs Swimlane"}
    assert (await _feature(client, pid, 101))["swimlane_id"] == lanes["Team A"]
    assert (await _feature(client, pid, 102))["swimlane_id"] == lanes["Needs Swimlane"]


@pytest.mark.asyncio
async def test_feature_already_in_the_pi_keeps_its_swimlane(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101)])
    lane = (await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "Team A"}
    )).json()
    feature = await _feature(client, pid, 101)
    await client.patch(f"/api/v1/features/{feature['system_id']}", json={
        "location": "pi", "swimlane_id": lane["system_id"], "pi_id": pi["system_id"],
    })
    data = await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI8)])
    assert data["items_placed"] == 0
    assert (await _feature(client, pid, 101))["swimlane_id"] == lane["system_id"]


@pytest.mark.asyncio
async def test_cross_pi_move_uses_same_named_lane_and_drops_sprints(client, pid):
    pi8 = await _make_pi(client, pid, "PI 08", PI8)
    pi9 = await _make_pi(client, pid, "PI 09", PI9)
    for pi in (pi8, pi9):
        await client.post(f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "Team A"})
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Login", user_id=201, parent_id=101),
        _row(4, "story", "Reset", user_id=202, parent_id=101),
    ])
    feature = await _feature(client, pid, 101)
    await client.patch(f"/api/v1/features/{feature['system_id']}", json={
        "location": "pi", "swimlane_id": (await _lanes(client, pi8))["Team A"],
        "pi_id": pi8["system_id"],
    })
    for uid, sprint in ((201, 0), (202, 1)):
        pbi = await _pbi(client, pid, uid)
        await client.post(f"/api/v1/pbis/{pbi['system_id']}/place", json={"sprint_index": sprint})

    # ADO moved the feature and one story to PI 09; the other story is not in the file.
    data = await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI9),
        _row(3, "story", "Login", user_id=201, parent_id=101, iteration=PI9 + "\\Sprint 3"),
    ])
    details = {c["user_id"]: c["detail"] for c in data["plan"] if c["action"] == "placed"}
    assert details[101] == "PI 08 → PI 09 · Team A; 2 stories leave their sprints"
    assert details[201] == "→ Sprint 3"

    feature = await _feature(client, pid, 101)
    assert feature["pi_id"] == pi9["system_id"]
    assert feature["swimlane_id"] == (await _lanes(client, pi9))["Team A"]
    assert await _sprint_of(client, await _pbi(client, pid, 201)) == 2
    assert await _sprint_of(client, await _pbi(client, pid, 202)) is None


@pytest.mark.asyncio
async def test_cross_pi_move_without_matching_lane_lands_in_needs_swimlane(client, pid):
    pi8 = await _make_pi(client, pid, "PI 08", PI8)
    pi9 = await _make_pi(client, pid, "PI 09", PI9)
    lane = (await client.post(
        f"/api/v1/pis/{pi8['system_id']}/swimlines", json={"name": "Team A"}
    )).json()
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101)])
    feature = await _feature(client, pid, 101)
    await client.patch(f"/api/v1/features/{feature['system_id']}", json={
        "location": "pi", "swimlane_id": lane["system_id"], "pi_id": pi8["system_id"],
    })
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI9)])
    assert (await _feature(client, pid, 101))["swimlane_id"] == (
        await _lanes(client, pi9)
    )["Needs Swimlane"]


@pytest.mark.asyncio
async def test_closed_pi_is_neither_a_target_nor_left(client, pid):
    pi8 = await _make_pi(client, pid, "PI 08", PI8)
    await _make_pi(client, pid, "PI 09", PI9)
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
    ])
    await client.patch(f"/api/v1/pis/{pi8['system_id']}", json={"state": "closed"})

    data = await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI9),
        _row(3, "feature", "Pay", user_id=102, iteration=PI8),
    ])
    skipped = {c["user_id"]: c["detail"] for c in data["plan"] if c["action"] == "skipped"}
    assert skipped == {101: "stays in PI 08, which is closed", 102: "PI 08 is closed"}
    assert (await _feature(client, pid, 101))["pi_id"] == pi8["system_id"]
    assert (await _feature(client, pid, 102))["location"] == "backlog"


@pytest.mark.asyncio
async def test_split_feature_is_not_moved(client, pid):
    pi8 = await _make_pi(client, pid, "PI 08", PI8)
    pi9 = await _make_pi(client, pid, "PI 09", PI9)
    pi10 = await _make_pi(client, pid, "PI 10", "Planner\\PI 10")
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
        _row(3, "story", "Login", user_id=201, parent_id=101),
        _row(4, "story", "Reset", user_id=202, parent_id=101),
    ])
    feature = await _feature(client, pid, 101)
    pbi = await _pbi(client, pid, 201)
    lane9 = (await client.post(
        f"/api/v1/pis/{pi9['system_id']}/swimlines", json={"name": "Team A"}
    )).json()
    resp = await client.post(f"/api/v1/features/{feature['system_id']}/split", json={
        "target_pi_id": pi9["system_id"], "target_swimline_id": lane9["system_id"],
        "pbi_ids": [pbi["system_id"]],
    })
    assert resp.status_code == 200, resp.text

    unchanged = await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, iteration=PI9)])
    assert unchanged["items_placed"] == unchanged["placements_skipped"] == 0

    data = await _import(
        client, pid, [_row(2, "feature", "Auth", user_id=101, iteration="Planner\\PI 10")],
    )
    assert data["placements_skipped"] == 1
    assert (await _feature(client, pid, 101))["pi_id"] == pi8["system_id"]
    assert await _lanes(client, pi10) == {}


# ── Stories ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_story_never_moves_its_feature(client, pid):
    pi8 = await _make_pi(client, pid, "PI 08", PI8)
    await _make_pi(client, pid, "PI 09", PI9)
    data = await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
        _row(3, "story", "Login", user_id=201, parent_id=101, iteration=PI9 + "\\Sprint 1"),
        _row(4, "feature", "Pay", user_id=102),
        _row(5, "story", "Card", user_id=202, parent_id=102, iteration=PI8 + "\\Sprint 1"),
    ])
    skipped = {c["user_id"]: c["detail"] for c in data["plan"] if c["action"] == "skipped"}
    assert skipped == {
        201: "not placed in PI 09 — its feature is in PI 08",
        202: "not placed in PI 08 — its feature is in the backlog",
    }
    assert (await _feature(client, pid, 101))["pi_id"] == pi8["system_id"]
    assert (await _feature(client, pid, 102))["location"] == "backlog"
    assert (await _pbi(client, pid, 201))["group_id"] is None


@pytest.mark.asyncio
async def test_directly_placed_story_follows_its_sprint(client, pid):
    await _make_pi(client, pid, "PI 08", PI8)
    rows = [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
        _row(3, "story", "Login", user_id=201, parent_id=101, iteration=PI8 + "\\Sprint 1"),
    ]
    await _import(client, pid, rows)
    group_before = (await _pbi(client, pid, 201))["group_id"]

    rows[1]["iteration"] = PI8 + "\\Sprint 4"
    data = await _import(client, pid, rows)
    assert [c["detail"] for c in data["plan"] if c["action"] == "placed"] == ["Sprint 1 → Sprint 4"]
    pbi = await _pbi(client, pid, 201)
    assert pbi["group_id"] == group_before
    assert await _sprint_of(client, pbi) == 3

    # Same file again: nothing to do.
    again = await _import(client, pid, rows)
    assert again["items_placed"] == 0


@pytest.mark.asyncio
async def test_pi_level_path_takes_a_direct_story_out_of_its_sprint(client, pid):
    await _make_pi(client, pid, "PI 08", PI8)
    rows = [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
        _row(3, "story", "Login", user_id=201, parent_id=101, iteration=PI8 + "\\Sprint 2"),
    ]
    await _import(client, pid, rows)
    group_id = (await _pbi(client, pid, 201))["group_id"]

    rows[1]["iteration"] = PI8
    data = await _import(client, pid, rows)
    assert [c["detail"] for c in data["plan"] if c["action"] == "placed"] == ["out of Sprint 2"]
    assert (await _pbi(client, pid, 201))["group_id"] is None
    assert (await client.get(f"/api/v1/groups/{group_id}")).status_code == 404


@pytest.mark.asyncio
async def test_story_in_a_named_group_is_left_alone(client, pid):
    pi = await _make_pi(client, pid, "PI 08", PI8)
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101, iteration=PI8),
        _row(3, "story", "Login", user_id=201, parent_id=101),
    ])
    feature = await _feature(client, pid, 101)
    pbi = await _pbi(client, pid, 201)
    lane_id = (await _lanes(client, pi))["Needs Swimlane"]
    resp = await client.post(f"/api/v1/swimlines/{lane_id}/groups", json={
        "name": "Release 1", "feature_system_id": feature["system_id"],
        "pbi_ids": [pbi["system_id"]], "sprint_index": 0,
    })
    assert resp.status_code == 201, resp.text

    for path in (PI8 + "\\Sprint 3", PI8):
        data = await _import(client, pid, [
            _row(3, "story", "Login", user_id=201, parent_id=101, iteration=path),
        ])
        skipped = [c["detail"] for c in data["plan"] if c["action"] == "skipped"]
        assert skipped == ['stays in group "Release 1" (Sprint 1) — named groups are left alone']
        assert await _sprint_of(client, await _pbi(client, pid, 201)) == 0


# ── Mapping ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_iteration_paths_are_unique_across_pis_and_sprints(client, pid):
    pi8 = await _make_pi(client, pid, "PI 08", PI8)
    pi9 = await _make_pi(client, pid, "PI 09", None)

    clash = await client.patch(
        f"/api/v1/pis/{pi9['system_id']}", json={"iteration_path": "planner/pi 08"}
    )
    assert clash.status_code == 409
    assert clash.json()["detail"]["error"] == "ITERATION_PATH_TAKEN"

    sprint9 = (await client.get(f"/api/v1/pis/{pi9['system_id']}/sprints")).json()[0]
    clash = await client.patch(
        f"/api/v1/sprints/{sprint9['system_id']}", json={"iteration_path": PI8 + "\\Sprint 2"}
    )
    assert clash.status_code == 409

    # Re-saving its own value, and clearing with a blank, are fine.
    same = await client.patch(f"/api/v1/pis/{pi8['system_id']}", json={"iteration_path": PI8})
    assert same.status_code == 200
    cleared = await client.patch(f"/api/v1/pis/{pi8['system_id']}", json={"iteration_path": "  "})
    assert cleared.json()["iteration_path"] is None


@pytest.mark.asyncio
async def test_iteration_paths_survive_export_and_import(client, pid):
    await _make_pi(client, pid, "PI 08", PI8)
    exported = (await client.get(f"/api/v1/projects/{pid}/export")).content
    resp = await client.post(
        "/api/v1/projects/import", files={"file": ("p.json", exported, "application/json")},
    )
    assert resp.status_code in (200, 201), resp.text
    new_pid = resp.json()["system_id"]
    pis = (await client.get(f"/api/v1/projects/{new_pid}/pis")).json()
    assert pis[0]["iteration_path"] == PI8
    sprints = (await client.get(f"/api/v1/pis/{pis[0]['system_id']}/sprints")).json()
    assert sprints[0]["iteration_path"] == PI8 + "\\Sprint 1"
