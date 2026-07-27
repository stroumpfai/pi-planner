"""Integration tests for the live HTML dashboard endpoint (C1)."""

import pytest
from httpx import AsyncClient


@pytest.fixture
async def planned_pi(client: AsyncClient) -> dict:
    """project → PI → swimline → feature (in PI) → PBI (effort 3) placed in sprint 0."""
    proj = (await client.post("/api/v1/projects/", json={"name": "Dashboard Test"})).json()
    pid = proj["system_id"]

    pi = (await client.post(
        f"/api/v1/projects/{pid}/pis",
        json={"name": "PI 2024.1", "state": "draft"},
    )).json()
    pi_id = pi["system_id"]

    sprints = (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()
    sprint_0 = next(s for s in sprints if s["sprint_index"] == 0)
    await client.patch(f"/api/v1/sprints/{sprint_0['system_id']}", json={"capacity": 20})

    sl = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team Alpha"},
    )).json()
    sl_id = sl["system_id"]

    feat = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Auth Feature", "id": 101},
    )).json()
    feat_id = feat["system_id"]
    await client.patch(
        f"/api/v1/features/{feat_id}",
        json={"location": "pi", "pi_id": pi_id, "swimlane_id": sl_id},
    )

    pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login endpoint", "id": 201, "effort": 3,
              "parent_feature_system_id": feat_id},
    )).json()
    await client.post(f"/api/v1/pbis/{pbi['system_id']}/place", json={"sprint_index": 0})

    return {
        "project_id": pid, "pi_id": pi_id, "swimline_id": sl_id,
        "feature_id": feat_id, "sprint_0_id": sprint_0["system_id"], "pi_name": "PI 2024.1",
    }


@pytest.mark.asyncio
async def test_dashboard_basic(client: AsyncClient, planned_pi: dict) -> None:
    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/html")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "inline" in resp.headers["Content-Disposition"]
    assert "dashboard.html" in resp.headers["Content-Disposition"]
    body = resp.text
    assert body.lstrip().startswith("<!doctype html>")
    assert "PI 2024.1" in body
    assert "Capacity by sprint" in body
    assert "Capacity vs. load" in body
    assert "Backlog composition" in body
    assert "Team Alpha" in body


@pytest.mark.asyncio
async def test_dashboard_over_capacity_is_red(client: AsyncClient, planned_pi: dict) -> None:
    # Shrink sprint 0 capacity below the placed load (3) so it renders over-capacity.
    await client.patch(f"/api/v1/sprints/{planned_pi['sprint_0_id']}", json={"capacity": 1})
    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/html")
    body = resp.text
    assert "#ef4444" in body  # _UTIL_COLORS["over"] — the shared over-capacity red
    assert "3/1" in body       # per-sprint total load / capacity in the heatmap footer


@pytest.mark.asyncio
async def test_dashboard_milestone_timeline(client: AsyncClient, planned_pi: dict) -> None:
    pi_id = planned_pi["pi_id"]
    await client.post(
        f"/api/v1/pis/{pi_id}/events",
        json={"name": "Release v1", "event_date": "2025-03-15", "event_type": "release"},
    )
    body = (await client.get(f"/api/v1/pis/{pi_id}/export/html")).text
    assert "Milestones" in body
    assert "Release v1" in body


@pytest.mark.asyncio
async def test_dashboard_refresh_script_toggles(client: AsyncClient, planned_pi: dict) -> None:
    pi_id = planned_pi["pi_id"]
    with_script = (await client.get(f"/api/v1/pis/{pi_id}/export/html?refresh_seconds=30")).text
    assert "setInterval" in with_script

    without = (await client.get(f"/api/v1/pis/{pi_id}/export/html?refresh_seconds=0")).text
    assert "setInterval" not in without


@pytest.mark.asyncio
async def test_dashboard_escapes_user_text(client: AsyncClient, planned_pi: dict) -> None:
    """User-supplied names are the XSS boundary — they must be HTML-escaped."""
    pi_id = planned_pi["pi_id"]
    payload = "<img src=x onerror=alert(1)>"
    await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": payload})
    body = (await client.get(f"/api/v1/pis/{pi_id}/export/html")).text
    assert payload not in body           # never emitted raw
    assert "&lt;img src=x" in body       # emitted escaped instead


@pytest.mark.asyncio
async def test_dashboard_invalid_refresh(client: AsyncClient, planned_pi: dict) -> None:
    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/html?refresh_seconds=99999")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_dashboard_404(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/pis/does-not-exist/export/html")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_dashboard_empty_pi(client: AsyncClient) -> None:
    proj = (await client.post("/api/v1/projects/", json={"name": "Empty Dash"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty PI", "state": "draft"},
    )).json()
    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/export/html")
    assert resp.status_code == 200
    assert "Empty PI" in resp.text


@pytest.mark.asyncio
async def test_dashboard_reader_allowed(
    client: AsyncClient, reader_client: AsyncClient, planned_pi: dict
) -> None:
    resp = await reader_client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/html")
    assert resp.status_code == 200
