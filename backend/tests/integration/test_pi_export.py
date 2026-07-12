"""Integration tests for PI CSV and PNG export endpoints."""

import csv
import io

import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Shared fixture: a fully planned PI
# ---------------------------------------------------------------------------

@pytest.fixture
async def planned_pi(client: AsyncClient) -> dict:
    """
    Creates:  project → PI → swimline → feature (moved to PI) → PBI → placed in sprint 0.
    Returns a dict of all relevant IDs.
    """
    proj = (await client.post("/api/v1/projects/", json={"name": "Export Test"})).json()
    pid = proj["system_id"]

    pi = (await client.post(
        f"/api/v1/projects/{pid}/pis",
        json={"name": "PI 2024.1", "state": "draft"},
    )).json()
    pi_id = pi["system_id"]

    # Set capacity on sprint 0
    sprints = (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()
    sprint_0 = next(s for s in sprints if s["sprint_index"] == 0)
    await client.patch(f"/api/v1/sprints/{sprint_0['system_id']}", json={"capacity": 20})

    # Create swimline
    sl = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines",
        json={"name": "Team Alpha"},
    )).json()
    sl_id = sl["system_id"]

    # Create feature, move to PI swimline
    feat = (await client.post(
        f"/api/v1/projects/{pid}/features",
        json={"title": "Auth Feature", "id": 101},
    )).json()
    feat_id = feat["system_id"]
    await client.patch(
        f"/api/v1/features/{feat_id}",
        json={"location": "pi", "pi_id": pi_id, "swimlane_id": sl_id},
    )

    # Create PBI and place in sprint 0
    pbi = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Login endpoint", "id": 201, "effort": 3,
              "parent_feature_system_id": feat_id},
    )).json()
    pbi_id = pbi["system_id"]
    await client.post(f"/api/v1/pbis/{pbi_id}/place", json={"sprint_index": 0})

    return {
        "project_id": pid,
        "pi_id": pi_id,
        "swimline_id": sl_id,
        "feature_id": feat_id,
        "pbi_id": pbi_id,
        "pi_name": "PI 2024.1",
    }


# ---------------------------------------------------------------------------
# CSV export tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_csv_export_structure(client: AsyncClient, planned_pi: dict) -> None:
    pi_id = planned_pi["pi_id"]
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/csv")

    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "Content-Disposition" in resp.headers
    assert planned_pi["pi_name"].replace(" ", "_") in resp.headers["Content-Disposition"] or \
           planned_pi["pi_name"] in resp.headers["Content-Disposition"]

    reader = csv.DictReader(io.StringIO(resp.text))
    assert reader.fieldnames == ["pbi_id", "pbi_name", "feature_id", "feature_name", "pi_name", "sprint_number", "swimlane_name"]


@pytest.mark.asyncio
async def test_csv_export_rows(client: AsyncClient, planned_pi: dict) -> None:
    pi_id = planned_pi["pi_id"]
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/csv")
    assert resp.status_code == 200

    rows = list(csv.DictReader(io.StringIO(resp.text)))
    assert len(rows) == 1

    row = rows[0]
    assert row["pbi_id"] == "201"
    assert row["pbi_name"] == "Login endpoint"
    assert row["feature_id"] == "101"
    assert row["feature_name"] == "Auth Feature"
    assert row["pi_name"] == "PI 2024.1"
    assert row["sprint_number"] == "1"
    assert row["swimlane_name"] == "Team Alpha"


@pytest.mark.asyncio
async def test_csv_export_escapes_formula_prefixes(client: AsyncClient, planned_pi: dict) -> None:
    """Titles starting with =, +, -, @ must be quoted so Excel won't run them."""
    proj_id = planned_pi["project_id"]
    feat_id = planned_pi["feature_id"]
    pi_id = planned_pi["pi_id"]

    await client.post(
        f"/api/v1/projects/{proj_id}/pbis",
        json={"title": '=HYPERLINK("http://evil")', "effort": 1, "parent_feature_system_id": feat_id},
    )

    resp = await client.get(f"/api/v1/pis/{pi_id}/export/csv")
    assert resp.status_code == 200

    rows = list(csv.DictReader(io.StringIO(resp.text)))
    injected = next(r for r in rows if "HYPERLINK" in r["pbi_name"])
    assert injected["pbi_name"].startswith("'=")


@pytest.mark.asyncio
async def test_csv_export_unplaced_pbi(client: AsyncClient, planned_pi: dict) -> None:
    """A PBI in the PI but not placed in any sprint appears with blank sprint/swimlane."""
    proj_id = planned_pi["project_id"]
    feat_id = planned_pi["feature_id"]
    pi_id = planned_pi["pi_id"]

    pbi2 = (await client.post(
        f"/api/v1/projects/{proj_id}/pbis",
        json={"title": "Unplaced story", "effort": 2, "parent_feature_system_id": feat_id},
    )).json()
    # Do NOT place pbi2 in any sprint

    resp = await client.get(f"/api/v1/pis/{pi_id}/export/csv")
    assert resp.status_code == 200

    rows = list(csv.DictReader(io.StringIO(resp.text)))
    unplaced = next(r for r in rows if r["pbi_name"] == "Unplaced story")
    assert unplaced["sprint_number"] == ""
    assert unplaced["swimlane_name"] == ""
    assert unplaced["pi_name"] == "PI 2024.1"
    assert unplaced["feature_name"] == "Auth Feature"

    # Verify the previously placed PBI is also present and correctly filled
    assert any(r["pbi_name"] == "Login endpoint" and r["sprint_number"] == "1" for r in rows)


@pytest.mark.asyncio
async def test_csv_export_empty_pi(client: AsyncClient) -> None:
    """PI with no PBIs returns headers-only CSV."""
    proj = (await client.post("/api/v1/projects/", json={"name": "Empty PI Project"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty PI", "state": "draft"},
    )).json()

    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/export/csv")
    assert resp.status_code == 200

    reader = csv.DictReader(io.StringIO(resp.text))
    assert reader.fieldnames == ["pbi_id", "pbi_name", "feature_id", "feature_name", "pi_name", "sprint_number", "swimlane_name"]
    assert list(reader) == []


@pytest.mark.asyncio
async def test_csv_export_404(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/pis/does-not-exist/export/csv")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PNG export tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_png_export_returns_image(client: AsyncClient, planned_pi: dict) -> None:
    pi_id = planned_pi["pi_id"]
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert "Content-Disposition" in resp.headers
    assert ".png" in resp.headers["Content-Disposition"]
    # PNG signature: first 8 bytes are \x89PNG\r\n\x1a\n
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(resp.content) > 1000  # non-trivial PNG


@pytest.mark.asyncio
async def test_png_export_empty_pi(client: AsyncClient) -> None:
    """PI with no swimlines still produces a valid PNG."""
    proj = (await client.post("/api/v1/projects/", json={"name": "PNG Empty"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty PI PNG", "state": "draft"},
    )).json()

    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/export/png")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.asyncio
async def test_png_export_404(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/pis/does-not-exist/export/png")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_png_export_with_events(client: AsyncClient, planned_pi: dict) -> None:
    """PI with events still produces a valid PNG (event lines rendered or skipped gracefully)."""
    pi_id = planned_pi["pi_id"]
    event_resp = await client.post(
        f"/api/v1/pis/{pi_id}/events",
        json={"name": "Release v1", "event_date": "2025-03-15", "event_type": "release"},
    )
    assert event_resp.status_code == 201

    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png")
    assert resp.status_code == 200
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# PNG export options
# ---------------------------------------------------------------------------

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

@pytest.mark.asyncio
@pytest.mark.parametrize("param", [
    "show_pi_effort=true",
    "show_sprint_effort=true",
    "show_swimlane_effort=true",
    "show_events=true",
    "swimlane_text_center=true",
    "show_export_date=true",
])
async def test_png_export_option_produces_valid_png(
    client: AsyncClient, planned_pi: dict, param: str
) -> None:
    """Each individual export option must still produce a valid PNG."""
    pi_id = planned_pi["pi_id"]
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?{param}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == PNG_SIGNATURE
    assert len(resp.content) > 1000


@pytest.mark.asyncio
async def test_png_export_all_options_on(client: AsyncClient, planned_pi: dict) -> None:
    """All options enabled together must produce a valid PNG."""
    pi_id = planned_pi["pi_id"]

    # Add an event so show_events has something to render
    await client.post(
        f"/api/v1/pis/{pi_id}/events",
        json={"name": "Go-live", "event_date": "2025-06-01", "event_type": "release"},
    )

    params = (
        "show_pi_effort=true"
        "&show_sprint_effort=true"
        "&show_swimlane_effort=true"
        "&show_events=true"
        "&swimlane_text_center=true"
        "&show_export_date=true"
    )
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?{params}")
    assert resp.status_code == 200
    assert resp.content[:8] == PNG_SIGNATURE
    assert len(resp.content) > 1000


@pytest.mark.asyncio
async def test_png_export_all_options_off(client: AsyncClient, planned_pi: dict) -> None:
    """All options explicitly off (the default) must produce a valid PNG."""
    pi_id = planned_pi["pi_id"]
    params = (
        "show_pi_effort=false"
        "&show_sprint_effort=false"
        "&show_swimlane_effort=false"
        "&show_events=false"
        "&swimlane_text_center=false"
        "&show_export_date=false"
    )
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?{params}")
    assert resp.status_code == 200
    assert resp.content[:8] == PNG_SIGNATURE


# ---------------------------------------------------------------------------
# PNG export — PBI list layout
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("param", [
    "",
    "split_by_swimline=true",
    "show_id=true",
    "split_by_swimline=true&show_id=true",
    "show_events=true",
    "show_pi_effort=true&show_sprint_effort=true",
])
async def test_png_export_list_layout(
    client: AsyncClient, planned_pi: dict, param: str
) -> None:
    """The PBI-list layout must produce a valid PNG for each relevant option combo."""
    pi_id = planned_pi["pi_id"]
    query = "layout=list" + (f"&{param}" if param else "")
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?{query}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == PNG_SIGNATURE
    assert len(resp.content) > 1000


@pytest.mark.asyncio
async def test_png_export_list_layout_ignores_unplaced_pbi(
    client: AsyncClient, planned_pi: dict
) -> None:
    """A PBI in the PI but not placed in any sprint must not break the list export."""
    proj_id = planned_pi["project_id"]
    feat_id = planned_pi["feature_id"]
    pi_id = planned_pi["pi_id"]

    await client.post(
        f"/api/v1/projects/{proj_id}/pbis",
        json={"title": "Unplaced story", "effort": 2, "parent_feature_system_id": feat_id},
    )
    # Not placed in any sprint — the list export omits it but must still render.

    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?layout=list&split_by_swimline=true")
    assert resp.status_code == 200
    assert resp.content[:8] == PNG_SIGNATURE


@pytest.mark.asyncio
async def test_png_export_list_layout_empty_pi(client: AsyncClient) -> None:
    """The list layout on a PI with no placed PBIs still produces a valid PNG."""
    proj = (await client.post("/api/v1/projects/", json={"name": "PNG List Empty"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty List PI", "state": "draft"},
    )).json()

    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/export/png?layout=list")
    assert resp.status_code == 200
    assert resp.content[:8] == PNG_SIGNATURE


# ---------------------------------------------------------------------------
# Access control: readers can export
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_export_reader_allowed(
    client: AsyncClient,
    reader_client: AsyncClient,
    planned_pi: dict,
) -> None:
    pi_id = planned_pi["pi_id"]

    csv_resp = await reader_client.get(f"/api/v1/pis/{pi_id}/export/csv")
    assert csv_resp.status_code == 200

    png_resp = await reader_client.get(f"/api/v1/pis/{pi_id}/export/png")
    assert png_resp.status_code == 200
