"""CSV import: the Azure DevOps fields stored as they are — a feature's Epic, Area
Path, a story's Committed flag, and State Change Date (docs/csv-import-logic.md)."""
from typing import Any

import pytest
from httpx import AsyncClient

ALL_COLUMNS = {
    "has_parent_column": True,
    "has_area_path_column": True,
    "has_committed_column": True,
    "has_state_change_date_column": True,
}


def _url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/import/csv"


def _row(n: int, item_type: str, title: str, **kw: Any) -> dict[str, Any]:
    return {"row_number": n, "item_type": item_type, "title": title, **kw}


async def _import(
    client: AsyncClient, pid: str, rows: list[dict[str, Any]], *,
    columns: dict[str, bool] | None = None, dry_run: bool = False,
) -> dict[str, Any]:
    body = {"rows": rows, **(ALL_COLUMNS if columns is None else columns)}
    resp = await client.post(_url(pid) + ("?dry_run=true" if dry_run else ""), json=body)
    assert resp.status_code == 200, resp.text
    return dict(resp.json())


async def _feature(client: AsyncClient, pid: str, user_id: int) -> dict[str, Any]:
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    return dict(next(f for f in features if f["id"] == user_id))


async def _pbi(client: AsyncClient, pid: str, user_id: int) -> dict[str, Any]:
    pbis = (await client.get(f"/api/v1/projects/{pid}/pbis")).json()
    return dict(next(p for p in pbis if p["id"] == user_id))


def _tree(**story: Any) -> list[dict[str, Any]]:
    """Feature 101 under Epic 900, with story 201."""
    return [
        _row(2, "feature", "Auth", user_id=101, parent_id=900, epic_title="Security",
             area_path="ISK\\Dev", state_changed_on="2026-09-01"),
        _row(3, "story", "Login", user_id=201, parent_id=101, **{
            "area_path": "ISK\\Dev", "committed": True, "state_changed_on": "2026-09-15",
            **story,
        }),
    ]


@pytest.fixture
async def pid(client: AsyncClient) -> str:
    project = (await client.post("/api/v1/projects/", json={"name": "ADO fields"})).json()
    return str(project["system_id"])


@pytest.mark.asyncio
async def test_new_items_store_the_ado_fields(client, pid):
    await _import(client, pid, _tree())

    feature = await _feature(client, pid, 101)
    assert feature["epic_id"] == 900
    assert feature["epic_title"] == "Security"
    assert feature["area_path"] == "ISK\\Dev"
    assert feature["state_changed_on"] == "2026-09-01"

    story = await _pbi(client, pid, 201)
    assert story["area_path"] == "ISK\\Dev"
    assert story["committed"] is True
    assert story["state_changed_on"] == "2026-09-15"


@pytest.mark.asyncio
async def test_reimport_updates_and_reports_the_fields(client, pid):
    await _import(client, pid, _tree())
    rows = _tree(committed=False, area_path="ISK\\Ops")
    rows[0]["parent_id"] = 901
    rows[0]["epic_title"] = "Ops"

    plan = (await _import(client, pid, rows, dry_run=True))["plan"]
    changes = {p["user_id"]: p["changes"] for p in plan}
    assert changes[101] == ["epic"]
    assert changes[201] == ["area_path", "committed"]

    await _import(client, pid, rows)
    feature = await _feature(client, pid, 101)
    assert (feature["epic_id"], feature["epic_title"]) == (901, "Ops")
    story = await _pbi(client, pid, 201)
    assert story["committed"] is False
    assert story["area_path"] == "ISK\\Ops"


@pytest.mark.asyncio
async def test_missing_columns_change_nothing(client, pid):
    await _import(client, pid, _tree())
    bare = [_row(2, "feature", "Auth", user_id=101), _row(3, "story", "Login", user_id=201, parent_id=101)]

    result = await _import(client, pid, bare, columns={}, dry_run=True)
    assert all(p["changes"] == [] for p in result["plan"])
    await _import(client, pid, bare, columns={})

    feature = await _feature(client, pid, 101)
    assert (feature["epic_id"], feature["epic_title"], feature["area_path"]) == (900, "Security", "ISK\\Dev")
    story = await _pbi(client, pid, 201)
    assert story["committed"] is True
    assert story["state_changed_on"] == "2026-09-15"


@pytest.mark.asyncio
async def test_blank_cells_clear(client, pid):
    await _import(client, pid, _tree())
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Login", user_id=201, parent_id=101),
    ])

    feature = await _feature(client, pid, 101)
    assert (feature["epic_id"], feature["epic_title"], feature["area_path"]) == (None, None, None)
    assert feature["state_changed_on"] is None
    story = await _pbi(client, pid, 201)
    assert (story["area_path"], story["committed"], story["state_changed_on"]) == (None, False, None)


@pytest.mark.asyncio
async def test_file_without_epic_rows_keeps_the_title_of_the_same_epic(client, pid):
    """The older export has a feature's Parent but no Epic rows to title it."""
    await _import(client, pid, _tree())
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, parent_id=900)])
    feature = await _feature(client, pid, 101)
    assert (feature["epic_id"], feature["epic_title"]) == (900, "Security")

    # A different Epic the file does not title has no title to show.
    await _import(client, pid, [_row(2, "feature", "Auth", user_id=101, parent_id=902)])
    feature = await _feature(client, pid, 101)
    assert (feature["epic_id"], feature["epic_title"]) == (902, None)


@pytest.mark.asyncio
async def test_split_feature_carries_and_receives_the_fields(client, pid):
    # A second story stays behind, so the split makes a continuation.
    await _import(client, pid, [*_tree(), _row(4, "story", "Logout", user_id=202, parent_id=101)])
    feature = await _feature(client, pid, 101)
    story = await _pbi(client, pid, 201)
    pi8 = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI 8"})).json()
    lane8 = (await client.post(f"/api/v1/pis/{pi8['system_id']}/swimlines", json={"name": "A"})).json()
    resp = await client.patch(f"/api/v1/features/{feature['system_id']}", json={
        "location": "pi", "pi_id": pi8["system_id"], "swimlane_id": lane8["system_id"],
    })
    assert resp.status_code == 200, resp.text
    pi = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI 9"})).json()
    lane = (await client.post(f"/api/v1/pis/{pi['system_id']}/swimlines", json={"name": "A"})).json()
    resp = await client.post(f"/api/v1/features/{feature['system_id']}/split", json={
        "target_pi_id": pi["system_id"], "target_swimline_id": lane["system_id"],
        "pbi_ids": [story["system_id"]],
    })
    assert resp.status_code == 200, resp.text

    def continuation(features: list[dict[str, Any]]) -> dict[str, Any]:
        return next(f for f in features if f["continued_from_feature_id"] == feature["system_id"])

    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert continuation(features)["epic_title"] == "Security"

    rows = _tree()
    rows[0]["area_path"] = "ISK\\Ops"
    await _import(client, pid, rows)
    features = (await client.get(f"/api/v1/projects/{pid}/features")).json()
    assert continuation(features)["area_path"] == "ISK\\Ops"


@pytest.mark.asyncio
async def test_fields_survive_export_import_and_snapshot_restore(client, pid):
    await _import(client, pid, _tree())

    exported = (await client.get(f"/api/v1/projects/{pid}/export")).content
    resp = await client.post(
        "/api/v1/projects/import", files={"file": ("p.json", exported, "application/json")},
    )
    assert resp.status_code in (200, 201), resp.text
    copy = resp.json()["system_id"]
    assert (await _feature(client, copy, 101))["epic_title"] == "Security"
    assert (await _pbi(client, copy, 201))["committed"] is True

    snap = (await client.post(f"/api/v1/projects/{pid}/snapshots/", json={"name": "s"})).json()
    await _import(client, pid, [
        _row(2, "feature", "Auth", user_id=101),
        _row(3, "story", "Login", user_id=201, parent_id=101),
    ])
    resp = await client.post(f"/api/v1/projects/{pid}/snapshots/{snap['system_id']}/restore")
    assert resp.status_code == 200, resp.text
    feature = await _feature(client, pid, 101)
    assert (feature["epic_id"], feature["area_path"]) == (900, "ISK\\Dev")
    story = await _pbi(client, pid, 201)
    assert (story["committed"], story["state_changed_on"]) == (True, "2026-09-15")
