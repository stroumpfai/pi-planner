"""Integration tests for the snapshot ↔ current-state diff endpoints."""
import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Diff Project"})).json()


def _diff_url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/snapshots/diff"


async def _snapshot(client, pid: str, name: str = "base") -> str:
    return (await client.post(
        f"/api/v1/projects/{pid}/snapshots/", json={"name": name}
    )).json()["system_id"]


async def _feature(client, pid: str, title: str = "Auth") -> str:
    return (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": title}
    )).json()["system_id"]


async def _pbi(client, pid: str, fid: str, title: str = "Login", effort: float = 3) -> str:
    return (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": title, "effort": effort, "parent_feature_system_id": fid},
    )).json()["system_id"]


async def _pi_with_swimline(client, pid: str) -> tuple[str, str]:
    pi_id = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "Q1"})).json()["system_id"]
    sl_id = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team A"})).json()["system_id"]
    return pi_id, sl_id


# ── baseline resolution / edge cases ────────────────────────────────────────


@pytest.mark.asyncio
async def test_diff_without_any_snapshot_returns_404(client, project):
    resp = await client.get(_diff_url(project["system_id"]))
    assert resp.status_code == 404
    assert "no snapshot" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_diff_unknown_snapshot_returns_404(client, project):
    resp = await client.get(_diff_url(project["system_id"]), params={"snapshot_id": "nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_diff_unknown_pi_returns_404(client, project):
    pid = project["system_id"]
    await _snapshot(client, pid)
    resp = await client.get(_diff_url(pid), params={"pi_id": "nope"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_diff_no_changes_is_empty(client, project):
    pid = project["system_id"]
    await _feature(client, pid)
    await _snapshot(client, pid, "quiet")
    resp = await client.get(_diff_url(pid))
    assert resp.status_code == 200
    diff = resp.json()
    for entity in ("features", "pbis", "pis", "swimlines", "sprints", "groups", "events"):
        assert diff["summary"][entity] == {"added": 0, "removed": 0, "changed": 0}
    assert diff["summary"]["total_effort"]["delta"] == 0
    assert "no changes" in diff["narrative"].lower()
    assert diff["baseline_snapshot"]["name"] == "quiet"


# ── added / removed / changed ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_diff_reports_added_pbi_and_effort_rollup(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    await _pbi(client, pid, fid, "Login", effort=3)
    await _snapshot(client, pid)

    new_pbi = await _pbi(client, pid, fid, "Logout", effort=5)

    diff = (await client.get(_diff_url(pid))).json()
    assert diff["summary"]["pbis"]["added"] == 1
    assert diff["changes"]["pbis"]["added"][0]["system_id"] == new_pbi
    # feature effort is a derived rollup: 3 → 8
    fchanged = diff["changes"]["features"]["changed"]
    assert len(fchanged) == 1
    assert fchanged[0]["fields"]["effort"] == {"from": 3, "to": 8}
    assert diff["summary"]["total_effort"] == {"from": 3, "to": 8, "delta": 5}


@pytest.mark.asyncio
async def test_diff_reports_removed_pbi(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    pbi_id = await _pbi(client, pid, fid)
    await _snapshot(client, pid)

    await client.delete(f"/api/v1/pbis/{pbi_id}")

    diff = (await client.get(_diff_url(pid))).json()
    assert diff["summary"]["pbis"]["removed"] == 1
    assert diff["changes"]["pbis"]["removed"][0]["system_id"] == pbi_id


@pytest.mark.asyncio
async def test_diff_reports_title_change(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid, "Auth")
    await _snapshot(client, pid)

    await client.patch(f"/api/v1/features/{fid}", json={"title": "Authorization"})

    diff = (await client.get(_diff_url(pid))).json()
    changed = diff["changes"]["features"]["changed"]
    assert changed[0]["fields"]["title"] == {"from": "Auth", "to": "Authorization"}


@pytest.mark.asyncio
async def test_diff_reports_sprint_capacity_change(client, project):
    pid = project["system_id"]
    pi_id, _ = await _pi_with_swimline(client, pid)
    sprints = (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()
    sprint_id = sprints[0]["system_id"]
    await _snapshot(client, pid)

    await client.patch(f"/api/v1/sprints/{sprint_id}", json={"capacity": 25})

    diff = (await client.get(_diff_url(pid))).json()
    changed = diff["changes"]["sprints"]["changed"]
    assert len(changed) == 1
    assert changed[0]["fields"]["capacity"]["to"] == 25


# ── PI-scoped diffs (moves in / out) ────────────────────────────────────────


@pytest.mark.asyncio
async def test_pi_scope_shows_move_into_pi(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    pi_id, sl_id = await _pi_with_swimline(client, pid)
    await _snapshot(client, pid)  # feature still in backlog

    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sl_id})  # → into PI

    diff = (await client.get(_diff_url(pid), params={"pi_id": pi_id})).json()
    assert diff["scope"] == {"type": "pi", "pi_id": pi_id, "pi_name": "Q1"}
    changed = diff["changes"]["features"]["changed"]
    assert changed[0]["system_id"] == fid
    assert changed[0]["fields"]["location"] == {"from": "backlog", "to": "pi"}
    assert changed[0]["fields"]["pi_id"] == {"from": None, "to": pi_id}


@pytest.mark.asyncio
async def test_pi_scope_shows_move_out_of_pi(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    pi_id, sl_id = await _pi_with_swimline(client, pid)
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sl_id})  # into PI
    await _snapshot(client, pid)  # feature in PI at snapshot time

    await client.patch(f"/api/v1/features/{fid}", json={"location": "backlog"})  # → out

    diff = (await client.get(_diff_url(pid), params={"pi_id": pi_id})).json()
    changed = diff["changes"]["features"]["changed"]
    assert changed[0]["system_id"] == fid
    assert changed[0]["fields"]["location"] == {"from": "pi", "to": "backlog"}


@pytest.mark.asyncio
async def test_pi_scope_excludes_other_pi_changes(client, project):
    pid = project["system_id"]
    pi_a, _ = await _pi_with_swimline(client, pid)
    pi_b = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "Q2"})).json()["system_id"]
    await _snapshot(client, pid)

    # change a sprint in PI B only
    sprint_b = (await client.get(f"/api/v1/pis/{pi_b}/sprints")).json()[0]["system_id"]
    await client.patch(f"/api/v1/sprints/{sprint_b}", json={"capacity": 30})

    diff = (await client.get(_diff_url(pid), params={"pi_id": pi_a})).json()
    assert diff["summary"]["sprints"]["changed"] == 0


# ── baseline selection ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_diff_defaults_to_latest_snapshot(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    await _snapshot(client, pid, "old")
    await _pbi(client, pid, fid, effort=2)
    await _snapshot(client, pid, "new")  # newest baseline includes the pbi
    await _pbi(client, pid, fid, "Extra", effort=5)

    diff = (await client.get(_diff_url(pid))).json()
    assert diff["baseline_snapshot"]["name"] == "new"
    assert diff["summary"]["pbis"]["added"] == 1  # only the change since "new"


@pytest.mark.asyncio
async def test_diff_against_explicit_older_snapshot(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    old_id = await _snapshot(client, pid, "old")
    await _pbi(client, pid, fid, effort=2)
    await _snapshot(client, pid, "new")
    await _pbi(client, pid, fid, "Extra", effort=5)

    diff = (await client.get(_diff_url(pid), params={"snapshot_id": old_id})).json()
    assert diff["baseline_snapshot"]["name"] == "old"
    assert diff["summary"]["pbis"]["added"] == 2  # both pbis added since "old"


# ── HTML + RBAC ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_diff_html_renders_page(client, project):
    pid = project["system_id"]
    fid = await _feature(client, pid)
    await _snapshot(client, pid)
    await _pbi(client, pid, fid, "Login", effort=3)

    resp = await client.get(f"{_diff_url(pid)}/html")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "<!doctype html>" in resp.text.lower()
    assert "Changes since snapshot" in resp.text


@pytest.mark.asyncio
async def test_reader_cannot_diff(reader_client, client, project):
    pid = project["system_id"]
    await _snapshot(client, pid)
    resp = await reader_client.get(_diff_url(pid))
    assert resp.status_code == 403
