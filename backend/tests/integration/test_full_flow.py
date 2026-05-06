"""End-to-end integration test: full Phase 1 workflow."""
import pytest


@pytest.mark.asyncio
async def test_full_pi_planning_flow(client):
    """
    Complete flow: project → feature → PBI → PI → swimlane →
    move feature → group PBIs → verify effort → export.
    """
    # 1. Create project
    project = (await client.post("/api/v1/projects/", json={"name": "Integration Project"})).json()
    pid = project["system_id"]
    assert project["name"] == "Integration Project"

    # 2. Create feature in backlog
    feature = (await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "User Authentication", "id": 101},
    )).json()
    fid = feature["system_id"]
    assert feature["id"] == 101
    assert feature["location"] == "backlog"
    assert feature["effort"] == 0  # no PBIs yet

    # 3. Create PBIs
    pbi1 = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login page", "effort": 3, "parent_feature_system_id": fid},
    )).json()
    pbi2 = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "JWT tokens", "effort": 5, "parent_feature_system_id": fid},
    )).json()

    # Feature effort should now be sum of PBIs
    feature_after = (await client.get(f"/api/v1/features/{fid}")).json()
    assert feature_after["effort"] == 8

    # 4. Create PI (auto-creates 5 sprints)
    pi = (await client.post(
        f"/api/v1/projects/{pid}/pis",
        json={"name": "Q1-2026"},
    )).json()
    pi_id = pi["system_id"]
    assert pi["state"] == "draft"
    assert pi["total_effort"] == 0
    assert pi["total_capacity"] == 0

    # 5. Create swimlane
    swimlane = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines",
        json={"name": "Backend Team"},
    )).json()
    sl_id = swimlane["system_id"]

    # 6. Move feature to swimlane
    moved = (await client.patch(
        f"/api/v1/features/{fid}",
        json={"swimlane_id": sl_id},
    )).json()
    assert moved["location"] == "pi"
    assert moved["swimlane_id"] == sl_id
    assert moved["pi_id"] == pi_id

    # 7. Set sprint capacity
    sprints = (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()
    s0 = next(s for s in sprints if s["sprint_index"] == 0)
    await client.patch(f"/api/v1/sprints/{s0['system_id']}", json={"capacity": 20})

    # 8. Create group with PBIs in Sprint 1
    group = (await client.post(
        f"/api/v1/swimlines/{sl_id}/groups",
        json={
            "name": "Auth Group",
            "feature_system_id": fid,
            "pbi_ids": [pbi1["system_id"], pbi2["system_id"]],
            "sprint_index": 0,
        },
    )).json()
    gid = group["system_id"]
    assert group["sprint_index"] == 0

    # 9. Verify effort propagates to PI level
    pi_after = (await client.get(f"/api/v1/pis/{pi_id}")).json()
    assert pi_after["total_effort"] == 8
    assert pi_after["total_capacity"] == 20

    sprints_after = (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()
    s0_after = next(s for s in sprints_after if s["sprint_index"] == 0)
    assert s0_after["effort"] == 8
    assert s0_after["capacity"] == 20

    swimlanes_after = (await client.get(f"/api/v1/pis/{pi_id}/swimlines")).json()
    sl_after = next(s for s in swimlanes_after if s["system_id"] == sl_id)
    assert sl_after["effort"] == 8
    assert sl_after["capacity"] == 20

    # 10. Start PI — state machine
    await client.patch(f"/api/v1/pis/{pi_id}", json={"state": "in_progress"})
    pi_running = (await client.get(f"/api/v1/pis/{pi_id}")).json()
    assert pi_running["state"] == "in_progress"

    # 11. Close PI → mutations should be rejected with 403
    await client.patch(f"/api/v1/pis/{pi_id}", json={"state": "closed"})
    pi_closed = (await client.get(f"/api/v1/pis/{pi_id}")).json()
    assert pi_closed["state"] == "closed"

    # Closed PI rejects further state changes
    resp = await client.patch(f"/api/v1/pis/{pi_id}", json={"name": "Renamed"})
    assert resp.status_code == 403

    # Closed PI rejects sprint capacity changes
    resp = await client.patch(f"/api/v1/sprints/{s0['system_id']}", json={"capacity": 99})
    assert resp.status_code == 403

    # 12. Export — verify complete structure
    export = (await client.get(f"/api/v1/projects/{pid}/export")).json()
    proj = export["project"]
    assert len(proj["features"]) == 1
    assert proj["features"][0]["effort"] == 8
    assert len(proj["pbis"]) == 2
    assert len(proj["pis"]) == 1
    assert len(proj["pis"][0]["swimlines"]) == 1
    assert len(proj["pis"][0]["swimlines"][0]["groups"]) == 1
    assert proj["pis"][0]["swimlines"][0]["groups"][0]["system_id"] == gid
    assert len(proj["pis"][0]["sprints"]) == 5

    # No sensitive data in export
    assert "password" not in export["project"].get("name", "").lower()
    import json
    export_text = json.dumps(export)
    assert "password_hash" not in export_text
    assert "session" not in export_text
