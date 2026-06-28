import pytest


_EVENT = {"name": "Release v2.0", "event_date": "2026-06-15", "event_type": "release"}


@pytest.fixture
async def project(client):
    return (await client.post("/api/v1/projects/", json={"name": "Test Project"})).json()


@pytest.fixture
async def pi(client, project):
    return (await client.post(
        f"/api/v1/projects/{project['system_id']}/pis",
        json={"name": "Q1-2026"},
    )).json()


@pytest.fixture
async def event(client, pi):
    return (await client.post(
        f"/api/v1/pis/{pi['system_id']}/events",
        json=_EVENT,
    )).json()


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_events_empty(client, pi):
    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/events")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_events_pi_not_found(client):
    resp = await client.get("/api/v1/pis/no-such/events")
    assert resp.status_code == 404


# ── Create ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_event(client, pi):
    resp = await client.post(f"/api/v1/pis/{pi['system_id']}/events", json=_EVENT)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Release v2.0"
    assert data["event_date"] == "2026-06-15"
    assert data["event_type"] == "release"
    assert data["pi_id"] == pi["system_id"]
    assert "system_id" in data


@pytest.mark.asyncio
async def test_create_event_invalid_type(client, pi):
    resp = await client.post(
        f"/api/v1/pis/{pi['system_id']}/events",
        json={"name": "Bad", "event_date": "2026-06-15", "event_type": "not_a_type"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_event_missing_date(client, pi):
    resp = await client.post(
        f"/api/v1/pis/{pi['system_id']}/events",
        json={"name": "No date", "event_type": "milestone"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_event_pi_not_found(client):
    resp = await client.post("/api/v1/pis/no-such/events", json=_EVENT)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reader_cannot_create(reader_client, pi):
    resp = await reader_client.post(f"/api/v1/pis/{pi['system_id']}/events", json=_EVENT)
    assert resp.status_code == 403


# ── Update ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_event_name(client, pi, event):
    resp = await client.patch(
        f"/api/v1/pis/{pi['system_id']}/events/{event['system_id']}",
        json={"name": "Updated Name"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"
    # unchanged fields preserved
    assert resp.json()["event_type"] == "release"
    assert resp.json()["event_date"] == "2026-06-15"


@pytest.mark.asyncio
async def test_update_event_date_and_type(client, pi, event):
    resp = await client.patch(
        f"/api/v1/pis/{pi['system_id']}/events/{event['system_id']}",
        json={"event_date": "2026-09-01", "event_type": "deadline"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["event_date"] == "2026-09-01"
    assert data["event_type"] == "deadline"


@pytest.mark.asyncio
async def test_update_event_not_found(client, pi):
    resp = await client.patch(
        f"/api/v1/pis/{pi['system_id']}/events/no-such",
        json={"name": "X"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reader_cannot_update(reader_client, pi, event):
    resp = await reader_client.patch(
        f"/api/v1/pis/{pi['system_id']}/events/{event['system_id']}",
        json={"name": "X"},
    )
    assert resp.status_code == 403


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_event(client, pi, event):
    resp = await client.delete(f"/api/v1/pis/{pi['system_id']}/events/{event['system_id']}")
    assert resp.status_code == 204

    remaining = (await client.get(f"/api/v1/pis/{pi['system_id']}/events")).json()
    assert remaining == []


@pytest.mark.asyncio
async def test_delete_event_not_found(client, pi):
    resp = await client.delete(f"/api/v1/pis/{pi['system_id']}/events/no-such")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reader_cannot_delete(reader_client, pi, event):
    resp = await reader_client.delete(
        f"/api/v1/pis/{pi['system_id']}/events/{event['system_id']}"
    )
    assert resp.status_code == 403


# ── Ordering ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_events_ordered_by_date(client, pi):
    pid = pi["system_id"]
    await client.post(f"/api/v1/pis/{pid}/events",
                      json={"name": "Late", "event_date": "2026-12-01", "event_type": "release"})
    await client.post(f"/api/v1/pis/{pid}/events",
                      json={"name": "Early", "event_date": "2026-01-01", "event_type": "milestone"})
    await client.post(f"/api/v1/pis/{pid}/events",
                      json={"name": "Mid", "event_date": "2026-06-15", "event_type": "deadline"})

    events = (await client.get(f"/api/v1/pis/{pid}/events")).json()
    dates = [e["event_date"] for e in events]
    assert dates == sorted(dates)
