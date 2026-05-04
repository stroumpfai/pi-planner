import pytest


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Swimline Project"})).json()


@pytest.fixture
async def pi(client, project):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "Q1-2026"},
    )).json()


@pytest.fixture
async def swimline(client, pi):
    return (await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines",
        json={"name": "Team Alpha"},
    )).json()


@pytest.fixture
async def feature(client, project):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/features",
        json={"title": "Auth Feature"},
    )).json()


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_swimlines_empty(client, pi):
    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/swimlines")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_swimlines_returns_all(client, pi):
    pid = pi["system_id"]
    await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Alpha"})
    await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Beta"})
    resp = await client.get(f"/api/v1/pis/{pid}/swimlines")
    assert len(resp.json()) == 2


@pytest.mark.asyncio
async def test_list_swimlines_ordered_by_index(client, pi):
    pid = pi["system_id"]
    await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Second", "order_index": 2})
    await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "First", "order_index": 1})
    resp = await client.get(f"/api/v1/pis/{pid}/swimlines")
    names = [s["name"] for s in resp.json()]
    assert names == ["First", "Second"]


@pytest.mark.asyncio
async def test_list_swimlines_404_unknown_pi(client):
    resp = await client.get("/api/v1/pis/nonexistent/swimlines")
    assert resp.status_code == 404


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_swimline_minimal(client, pi):
    resp = await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines",
        json={"name": "Team Alpha"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Team Alpha"
    assert data["pi_id"] == pi["system_id"]
    assert data["order_index"] is not None


@pytest.mark.asyncio
async def test_create_swimline_auto_order_index(client, pi):
    pid = pi["system_id"]
    r1 = (await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "A"})).json()
    r2 = (await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "B"})).json()
    assert r2["order_index"] > r1["order_index"]


@pytest.mark.asyncio
async def test_create_swimline_explicit_order_index(client, pi):
    resp = await client.post(
        f"/api/v1/pis/{pi['system_id']}/swimlines",
        json={"name": "Team", "order_index": 42},
    )
    assert resp.json()["order_index"] == 42


@pytest.mark.asyncio
async def test_create_swimline_duplicate_name_409(client, pi):
    pid = pi["system_id"]
    await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Same"})
    resp = await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Same"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "NAME_TAKEN"


@pytest.mark.asyncio
async def test_create_swimline_404_unknown_pi(client):
    resp = await client.post("/api/v1/pis/nonexistent/swimlines", json={"name": "X"})
    assert resp.status_code == 404


# ── Get ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_swimline(client, swimline):
    resp = await client.get(f"/api/v1/swimlines/{swimline['system_id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == swimline["name"]


@pytest.mark.asyncio
async def test_get_swimline_404(client):
    resp = await client.get("/api/v1/swimlines/nonexistent")
    assert resp.status_code == 404


# ── Update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_swimline_name(client, swimline):
    resp = await client.patch(
        f"/api/v1/swimlines/{swimline['system_id']}",
        json={"name": "Team Renamed"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Team Renamed"


@pytest.mark.asyncio
async def test_update_swimline_order_index(client, swimline):
    resp = await client.patch(
        f"/api/v1/swimlines/{swimline['system_id']}",
        json={"order_index": 99},
    )
    assert resp.status_code == 200
    assert resp.json()["order_index"] == 99


@pytest.mark.asyncio
async def test_update_swimline_duplicate_name_409(client, pi):
    pid = pi["system_id"]
    await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Alpha"})
    b = (await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "Beta"})).json()
    resp = await client.patch(f"/api/v1/swimlines/{b['system_id']}", json={"name": "Alpha"})
    assert resp.status_code == 409


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_swimline(client, swimline):
    resp = await client.delete(f"/api/v1/swimlines/{swimline['system_id']}")
    assert resp.status_code == 204
    assert (await client.get(f"/api/v1/swimlines/{swimline['system_id']}")).status_code == 404


@pytest.mark.asyncio
async def test_delete_swimline_returns_features_to_backlog(client, project, pi, swimline, feature):
    fid = feature["system_id"]
    sid = swimline["system_id"]

    # Move feature into swimlane
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": sid})
    f_in_pi = (await client.get(f"/api/v1/features/{fid}")).json()
    assert f_in_pi["location"] == "pi"

    # Delete the swimlane
    await client.delete(f"/api/v1/swimlines/{sid}")

    # Feature should be back in backlog
    f_after = (await client.get(f"/api/v1/features/{fid}")).json()
    assert f_after["location"] == "backlog"
    assert f_after["swimlane_id"] is None
    assert f_after["pi_id"] is None


@pytest.mark.asyncio
async def test_delete_swimline_404(client):
    resp = await client.delete("/api/v1/swimlines/nonexistent")
    assert resp.status_code == 404


# ── Reorder ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reorder_swimlines(client, pi):
    pid = pi["system_id"]
    a = (await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "A"})).json()
    b = (await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "B"})).json()
    c = (await client.post(f"/api/v1/pis/{pid}/swimlines", json={"name": "C"})).json()

    # Reverse the order
    resp = await client.post(
        f"/api/v1/swimlines/{a['system_id']}/reorder",
        json={"order": [c["system_id"], b["system_id"], a["system_id"]]},
    )
    assert resp.status_code == 200
    returned_names = [s["name"] for s in resp.json()]
    assert returned_names == ["C", "B", "A"]


# ── Feature move operations ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_move_feature_to_swimlane(client, project, pi, swimline, feature):
    fid = feature["system_id"]
    resp = await client.patch(
        f"/api/v1/features/{fid}",
        json={"swimlane_id": swimline["system_id"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["location"] == "pi"
    assert data["swimlane_id"] == swimline["system_id"]
    assert data["pi_id"] == pi["system_id"]


@pytest.mark.asyncio
async def test_move_feature_to_backlog(client, project, pi, swimline, feature):
    fid = feature["system_id"]
    # Move to swimlane first
    await client.patch(f"/api/v1/features/{fid}", json={"swimlane_id": swimline["system_id"]})
    # Move back to backlog
    resp = await client.patch(f"/api/v1/features/{fid}", json={"location": "backlog"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["location"] == "backlog"
    assert data["swimlane_id"] is None
    assert data["pi_id"] is None


@pytest.mark.asyncio
async def test_move_feature_to_invalid_swimlane_404(client, feature):
    resp = await client.patch(
        f"/api/v1/features/{feature['system_id']}",
        json={"swimlane_id": "nonexistent"},
    )
    assert resp.status_code == 404
