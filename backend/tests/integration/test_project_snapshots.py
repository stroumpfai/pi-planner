"""Integration tests for project snapshot routes (create, list, delete, restore)."""
import pytest
from sqlalchemy import select

from app.models.activity_log import ActivityLog
from app.models.edit_lock import EditLock


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Snapshot Project"})).json()


def _snapshots_url(pid: str) -> str:
    return f"/api/v1/projects/{pid}/snapshots/"


async def _seed_full_project(client, pid: str) -> dict:
    """Seed a project with feature, PBI, PI, swimline, sprint and group; return ids."""
    fid = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth"}
    )).json()["system_id"]

    pbi_id = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login", "effort": 3, "parent_feature_system_id": fid},
    )).json()["system_id"]

    pi_id = (await client.post(
        f"/api/v1/projects/{pid}/pis", json={"name": "Q1-2026"}
    )).json()["system_id"]

    sl_id = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team A"}
    )).json()["system_id"]
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sl_id})

    g_id = (await client.post(
        f"/api/v1/swimlines/{sl_id}/groups",
        json={"name": "Login Group", "feature_system_id": fid, "pbi_ids": [pbi_id], "sprint_index": 0},
    )).json()["system_id"]

    return {"feature_id": fid, "pbi_id": pbi_id, "pi_id": pi_id, "swimline_id": sl_id, "group_id": g_id}


# ── Create ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_snapshot(client, project, db):
    pid = project["system_id"]
    resp = await client.post(_snapshots_url(pid), json={"name": "My Snapshot"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Snapshot"
    assert "system_id" in data
    assert "created_at" in data
    assert data["created_by"] == "testuser"
    # snapshot_data must not be exposed in the response shape
    assert "snapshot_data" not in data


@pytest.mark.asyncio
async def test_create_snapshot_writes_activity_log(client, project, db):
    pid = project["system_id"]
    resp = await client.post(_snapshots_url(pid), json={"name": "Logged Snapshot"})
    snap_id = resp.json()["system_id"]

    result = await db.execute(select(ActivityLog).where(ActivityLog.action == "snapshot.create"))
    entries = result.scalars().all()
    assert len(entries) == 1
    entry = entries[0]
    assert entry.resource_type == "snapshot"
    assert entry.resource_id == snap_id
    assert entry.project_id == pid
    assert entry.details == {"name": "Logged Snapshot"}


@pytest.mark.asyncio
async def test_create_snapshot_broadcasts_sse(client, project, monkeypatch):
    pid = project["system_id"]
    events = []

    async def fake_broadcast(project_id, event_type, data):
        events.append((project_id, event_type, data))

    from app.services.events import broadcaster
    monkeypatch.setattr(broadcaster, "broadcast", fake_broadcast)

    resp = await client.post(_snapshots_url(pid), json={"name": "Broadcast Snapshot"})
    snap_id = resp.json()["system_id"]

    matching = [e for e in events if e[1] == "snapshot:created"]
    assert len(matching) == 1
    assert matching[0][0] == pid
    assert matching[0][2] == {"system_id": snap_id, "name": "Broadcast Snapshot"}


@pytest.mark.asyncio
async def test_create_snapshot_404_unknown_project(client):
    resp = await client.post(_snapshots_url("nonexistent"), json={"name": "X"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reader_cannot_create_snapshot(reader_client, project):
    resp = await reader_client.post(_snapshots_url(project["system_id"]), json={"name": "X"})
    assert resp.status_code == 403


# ── List ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_snapshots_empty(client, project):
    resp = await client.get(_snapshots_url(project["system_id"]))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_snapshots_ordered_desc(client, project):
    """Results are ordered by created_at descending (ties broken consistently)."""
    pid = project["system_id"]
    first = (await client.post(_snapshots_url(pid), json={"name": "First"})).json()
    second = (await client.post(_snapshots_url(pid), json={"name": "Second"})).json()

    resp = await client.get(_snapshots_url(pid))
    assert resp.status_code == 200
    body = resp.json()
    assert {s["system_id"] for s in body} == {first["system_id"], second["system_id"]}

    # created_at is monotonically non-increasing (sqlite has second-level granularity,
    # so ties are possible — only assert the descending invariant, not strict order).
    timestamps = [s["created_at"] for s in body]
    assert timestamps == sorted(timestamps, reverse=True)


@pytest.mark.asyncio
async def test_reader_cannot_list_snapshots(reader_client, project):
    resp = await reader_client.get(_snapshots_url(project["system_id"]))
    assert resp.status_code == 403


# ── Delete ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_snapshot(client, project, db):
    pid = project["system_id"]
    snap = (await client.post(_snapshots_url(pid), json={"name": "To Delete"})).json()

    resp = await client.delete(f"{_snapshots_url(pid)}{snap['system_id']}")
    assert resp.status_code == 204

    listing = (await client.get(_snapshots_url(pid))).json()
    assert listing == []

    result = await db.execute(select(ActivityLog).where(ActivityLog.action == "snapshot.delete"))
    entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].resource_id == snap["system_id"]
    assert entries[0].project_id == pid


@pytest.mark.asyncio
async def test_delete_snapshot_404_missing(client, project):
    resp = await client.delete(f"{_snapshots_url(project['system_id'])}nonexistent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_snapshot_404_wrong_project(client):
    p1 = (await client.post("/api/v1/projects/", json={"name": "Proj One"})).json()
    p2 = (await client.post("/api/v1/projects/", json={"name": "Proj Two"})).json()
    snap = (await client.post(_snapshots_url(p1["system_id"]), json={"name": "S"})).json()

    resp = await client.delete(f"{_snapshots_url(p2['system_id'])}{snap['system_id']}")
    assert resp.status_code == 404

    # still present under its real project
    listing = (await client.get(_snapshots_url(p1["system_id"]))).json()
    assert len(listing) == 1


@pytest.mark.asyncio
async def test_reader_cannot_delete_snapshot(reader_client, client, project):
    pid = project["system_id"]
    snap = (await client.post(_snapshots_url(pid), json={"name": "S"})).json()
    resp = await reader_client.delete(f"{_snapshots_url(pid)}{snap['system_id']}")
    assert resp.status_code == 403


# ── Restore ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_restore_snapshot_correctness(client, project, db):
    """Seed → snapshot → mutate heavily → restore → assert state matches the snapshot."""
    pid = project["system_id"]
    ids = await _seed_full_project(client, pid)

    snap = (await client.post(_snapshots_url(pid), json={"name": "Baseline"})).json()
    baseline_export = (await client.get(f"/api/v1/projects/{pid}/export")).json()["project"]

    # Mutate significantly: add a new feature/PBI, add another PI, change titles
    await client.patch(f"/api/v1/features/{ids['feature_id']}", json={"title": "Mutated Title"})
    new_fid = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Extra Feature"}
    )).json()["system_id"]
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Extra PBI", "effort": 5, "parent_feature_system_id": new_fid},
    )
    await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "Q2-2026"})

    # Restore
    resp = await client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 200
    restored_project = resp.json()
    assert restored_project["system_id"] == pid

    restored_export = (await client.get(f"/api/v1/projects/{pid}/export")).json()["project"]

    def _strip_volatile(proj_data):
        """Drop fields that legitimately change across snapshot/restore (timestamps)."""
        data = dict(proj_data)
        for key in ("modified_at", "exported_at"):
            data.pop(key, None)
        return data

    # Compare features (system_ids preserved + content matches)
    assert {f["system_id"] for f in restored_export["features"]} == {f["system_id"] for f in baseline_export["features"]}
    restored_feat = next(f for f in restored_export["features"] if f["system_id"] == ids["feature_id"])
    assert restored_feat["title"] == "Auth"

    # Compare PBIs
    assert {p["system_id"] for p in restored_export["pbis"]} == {p["system_id"] for p in baseline_export["pbis"]}
    restored_pbi = next(p for p in restored_export["pbis"] if p["system_id"] == ids["pbi_id"])
    assert restored_pbi["title"] == "Login"
    assert restored_pbi["group_id"] == ids["group_id"]

    # Compare PIs/swimlines/sprints/groups (system_ids preserved)
    assert {pi["system_id"] for pi in restored_export["pis"]} == {pi["system_id"] for pi in baseline_export["pis"]}
    restored_pi = next(pi for pi in restored_export["pis"] if pi["system_id"] == ids["pi_id"])
    baseline_pi = next(pi for pi in baseline_export["pis"] if pi["system_id"] == ids["pi_id"])
    assert restored_pi["name"] == baseline_pi["name"]
    assert {sl["system_id"] for sl in restored_pi["swimlines"]} == {sl["system_id"] for sl in baseline_pi["swimlines"]}
    assert {s["system_id"] for s in restored_pi["sprints"]} == {s["system_id"] for s in baseline_pi["sprints"]}

    restored_sl = next(sl for sl in restored_pi["swimlines"] if sl["system_id"] == ids["swimline_id"])
    assert {g["system_id"] for g in restored_sl["groups"]} == {ids["group_id"]}
    assert restored_sl["groups"][0]["name"] == "Login Group"

    _strip_volatile(restored_export)
    _strip_volatile(baseline_export)
    assert restored_export["name"] == baseline_export["name"]
    assert restored_export["description"] == baseline_export["description"]
    assert restored_export["effort_unit"] == baseline_export["effort_unit"]


async def _seed_continuation(client, pid: str) -> dict:
    """Split a feature so a continuation feature (continued_from_feature_id) exists.

    Returns origin/continuation feature ids and the moved PBI id.
    """
    fid = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Origin"}
    )).json()["system_id"]
    keep_pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Keep", "effort": 2, "parent_feature_system_id": fid},
    )).json()["system_id"]
    move_pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Move", "effort": 3, "parent_feature_system_id": fid},
    )).json()["system_id"]

    pi_id = (await client.post(f"/api/v1/projects/{pid}/pis", json={"name": "PI-1"})).json()["system_id"]
    sl_id = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Lane"})).json()["system_id"]
    # Move origin feature into the PI (required before a split is allowed).
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sl_id})

    cont = (await client.post(
        f"/api/v1/features/{fid}/split",
        json={"target_pi_id": pi_id, "target_swimline_id": sl_id, "pbi_ids": [move_pbi]},
    )).json()
    return {
        "origin_id": fid,
        "continuation_id": cont["system_id"],
        "moved_pbi_id": move_pbi,
        "kept_pbi_id": keep_pbi,
        "pi_id": pi_id,
    }


@pytest.mark.asyncio
async def test_restore_preserves_continuation_and_adjacent_fields(client, project, db):
    """Continuation link, PI events, and item_type survive a snapshot round-trip."""
    pid = project["system_id"]
    seeded = await _seed_continuation(client, pid)

    # A PI event and a bug-typed PBI so we cover the other newly-preserved fields.
    await client.post(
        f"/api/v1/pis/{seeded['pi_id']}/events",
        json={"name": "Release", "event_date": "2026-03-01", "event_type": "release"},
    )
    bug_id = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "A bug", "effort": 1, "parent_feature_system_id": seeded["origin_id"], "item_type": "bug"},
    )).json()["system_id"]

    snap = (await client.post(_snapshots_url(pid), json={"name": "Baseline"})).json()

    # Mutate: cancel the continuation and delete the bug, then restore.
    await client.post(f"/api/v1/features/{seeded['continuation_id']}/cancel-continuation")
    await client.delete(f"/api/v1/pbis/{bug_id}")

    resp = await client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 200

    export = (await client.get(f"/api/v1/projects/{pid}/export")).json()["project"]

    # Continuation link preserved (original system_ids kept on restore).
    cont = next(f for f in export["features"] if f["system_id"] == seeded["continuation_id"])
    assert cont["continued_from_feature_id"] == seeded["origin_id"]

    # item_type preserved (would reset to "story" if dropped).
    bug = next(p for p in export["pbis"] if p["system_id"] == bug_id)
    assert bug["item_type"] == "bug"

    # PI events preserved (previously destroyed on restore).
    pi = next(pi for pi in export["pis"] if pi["system_id"] == seeded["pi_id"])
    assert [e["name"] for e in pi["events"]] == ["Release"]
    assert pi["events"][0]["event_type"] == "release"


@pytest.mark.asyncio
async def test_restore_preserves_azure_url(client, db):
    pid = (await client.post(
        "/api/v1/projects/", json={"name": "Azure Proj", "azure_devops_url": "https://dev.azure.com/org/proj"}
    )).json()["system_id"]
    snap = (await client.post(_snapshots_url(pid), json={"name": "Baseline"})).json()

    await client.patch(f"/api/v1/projects/{pid}", json={"azure_devops_url": None})
    resp = await client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 200
    assert resp.json()["azure_devops_url"] == "https://dev.azure.com/org/proj"


@pytest.mark.asyncio
async def test_restore_creates_safety_snapshot(client, project, db):
    pid = project["system_id"]
    await _seed_full_project(client, pid)

    before_count = len((await client.get(_snapshots_url(pid))).json())
    snap = (await client.post(_snapshots_url(pid), json={"name": "Baseline"})).json()

    resp = await client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 200

    listing = (await client.get(_snapshots_url(pid))).json()
    assert len(listing) == before_count + 2

    safety = next((s for s in listing if "Before restoring" in s["name"]), None)
    assert safety is not None
    assert "Baseline" in safety["name"]


@pytest.mark.asyncio
async def test_restore_releases_edit_lock(client, project, db):
    pid = project["system_id"]
    snap = (await client.post(_snapshots_url(pid), json={"name": "Baseline"})).json()

    acquire_resp = await client.post(f"/api/v1/projects/{pid}/edit-lock/acquire")
    assert acquire_resp.json()["is_locked"] is True

    resp = await client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 200

    lock_status = (await client.get(f"/api/v1/projects/{pid}/edit-lock")).json()
    assert lock_status["is_locked"] is False

    result = await db.execute(select(EditLock).where(EditLock.project_id == pid))
    lock = result.scalar_one_or_none()
    assert lock is not None
    assert lock.expires_at is not None


@pytest.mark.asyncio
async def test_restore_logs_activity_and_response_shape(client, project, db):
    pid = project["system_id"]
    await _seed_full_project(client, pid)
    snap = (await client.post(_snapshots_url(pid), json={"name": "Baseline"})).json()

    resp = await client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 200
    body = resp.json()
    assert body["system_id"] == pid
    assert "name" in body and "description" in body and "effort_unit" in body

    result = await db.execute(select(ActivityLog).where(ActivityLog.action == "snapshot.restore"))
    entries = result.scalars().all()
    assert len(entries) == 1
    entry = entries[0]
    assert entry.resource_type == "snapshot"
    assert entry.resource_id == snap["system_id"]
    assert entry.project_id == pid
    assert entry.details["snapshot_id"] == snap["system_id"]
    assert entry.details["snapshot_name"] == "Baseline"
    assert "safety_snapshot_id" in entry.details


@pytest.mark.asyncio
async def test_restore_404_unknown_snapshot(client, project):
    resp = await client.post(f"{_snapshots_url(project['system_id'])}nonexistent/restore")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_restore_404_wrong_project(client):
    p1 = (await client.post("/api/v1/projects/", json={"name": "Proj One"})).json()
    p2 = (await client.post("/api/v1/projects/", json={"name": "Proj Two"})).json()
    snap = (await client.post(_snapshots_url(p1["system_id"]), json={"name": "S"})).json()

    resp = await client.post(f"{_snapshots_url(p2['system_id'])}{snap['system_id']}/restore")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reader_cannot_restore_snapshot(reader_client, client, project):
    pid = project["system_id"]
    snap = (await client.post(_snapshots_url(pid), json={"name": "S"})).json()
    resp = await reader_client.post(f"{_snapshots_url(pid)}{snap['system_id']}/restore")
    assert resp.status_code == 403
