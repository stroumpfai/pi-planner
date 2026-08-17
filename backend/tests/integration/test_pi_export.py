"""Integration tests for PI CSV and PNG export endpoints."""

import csv
import io

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.effort import sprint_swimline_efforts, sprint_swimline_item_counts


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
    assert reader.fieldnames == [
        "pbi_id", "pbi_name", "pbi_url", "pbi_state",
        "feature_id", "feature_name", "feature_url", "feature_state",
        "pi_name", "sprint_number", "swimlane_name",
    ]


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
    # Project has no work-item link config, so both url columns stay blank.
    assert row["pbi_url"] == ""
    assert row["feature_url"] == ""


@pytest.mark.asyncio
async def test_csv_export_work_item_urls(client: AsyncClient, planned_pi: dict) -> None:
    """With a project URL + path template set, both url columns hold deep links."""
    await client.patch(
        f"/api/v1/projects/{planned_pi['project_id']}",
        json={
            "azure_devops_url": "https://dev.azure.com/acme/Proj",
            "work_item_path_template": "_workitems/edit/{id}",
        },
    )

    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/csv")
    assert resp.status_code == 200

    row = list(csv.DictReader(io.StringIO(resp.text)))[0]
    assert row["pbi_url"] == "https://dev.azure.com/acme/Proj/_workitems/edit/201"
    assert row["feature_url"] == "https://dev.azure.com/acme/Proj/_workitems/edit/101"


@pytest.mark.asyncio
async def test_csv_export_url_blank_without_template(client: AsyncClient, planned_pi: dict) -> None:
    """A base URL alone is not enough — the path template is required."""
    await client.patch(
        f"/api/v1/projects/{planned_pi['project_id']}",
        json={"azure_devops_url": "https://dev.azure.com/acme/Proj"},
    )

    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/csv")
    assert resp.status_code == 200

    row = list(csv.DictReader(io.StringIO(resp.text)))[0]
    assert row["pbi_url"] == ""
    assert row["feature_url"] == ""


@pytest.mark.asyncio
async def test_csv_export_url_blank_without_user_id(client: AsyncClient, planned_pi: dict) -> None:
    """An item with no user id has nothing to link to, even on a configured project."""
    await client.patch(
        f"/api/v1/projects/{planned_pi['project_id']}",
        json={
            "azure_devops_url": "https://dev.azure.com/acme/Proj",
            "work_item_path_template": "_workitems/edit/{id}",
        },
    )
    await client.post(
        f"/api/v1/projects/{planned_pi['project_id']}/pbis",
        json={"title": "No id story", "effort": 1,
              "parent_feature_system_id": planned_pi["feature_id"]},
    )

    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/export/csv")
    assert resp.status_code == 200

    rows = list(csv.DictReader(io.StringIO(resp.text)))
    row = next(r for r in rows if r["pbi_name"] == "No id story")
    assert row["pbi_id"] == ""
    assert row["pbi_url"] == ""
    # The parent feature does have an id, so its link is still present.
    assert row["feature_url"] == "https://dev.azure.com/acme/Proj/_workitems/edit/101"


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
    assert reader.fieldnames == [
        "pbi_id", "pbi_name", "pbi_url", "pbi_state",
        "feature_id", "feature_name", "feature_url", "feature_state",
        "pi_name", "sprint_number", "swimlane_name",
    ]
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
# PNG export — capacity-vs-load heatmap layout (A1)
# ---------------------------------------------------------------------------

@pytest.fixture
async def planned_grid(client: AsyncClient) -> dict:
    """A PI with a 2-team × 2-sprint grid of placed effort, for the heatmap.

    Sprint capacities: s0=10, s1=8.
    Loads: (Alpha, s0)=8, (Alpha, s1)=3, (Beta, s0)=5  -> s0 over capacity (13/10).
    """
    proj = (await client.post("/api/v1/projects/", json={"name": "Heatmap Test"})).json()
    pid = proj["system_id"]
    pi = (await client.post(
        f"/api/v1/projects/{pid}/pis", json={"name": "PI Grid", "state": "draft"},
    )).json()
    pi_id = pi["system_id"]

    sprints = (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()
    s0 = next(s for s in sprints if s["sprint_index"] == 0)
    s1 = next(s for s in sprints if s["sprint_index"] == 1)
    await client.patch(f"/api/v1/sprints/{s0['system_id']}", json={"capacity": 10})
    await client.patch(f"/api/v1/sprints/{s1['system_id']}", json={"capacity": 8})

    alpha = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team Alpha"})).json()
    beta = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team Beta"})).json()

    async def feature_in(lane_id: str, fid: int, title: str) -> str:
        feat = (await client.post(
            f"/api/v1/projects/{pid}/features", json={"title": title, "id": fid},
        )).json()
        await client.patch(
            f"/api/v1/features/{feat['system_id']}",
            json={"location": "pi", "pi_id": pi_id, "swimlane_id": lane_id},
        )
        return feat["system_id"]

    async def place(feat_id: str, pid_num: int, effort: int, sprint_index: int) -> None:
        pbi = (await client.post(
            f"/api/v1/projects/{pid}/pbis",
            json={"title": f"PBI {pid_num}", "id": pid_num, "effort": effort,
                  "parent_feature_system_id": feat_id},
        )).json()
        await client.post(f"/api/v1/pbis/{pbi['system_id']}/place", json={"sprint_index": sprint_index})

    fa = await feature_in(alpha["system_id"], 101, "Alpha Feature")
    fb = await feature_in(beta["system_id"], 102, "Beta Feature")
    await place(fa, 201, 8, 0)
    await place(fa, 202, 3, 1)
    await place(fb, 203, 5, 0)

    return {
        "pi_id": pi_id,
        "alpha_id": alpha["system_id"],
        "beta_id": beta["system_id"],
    }


@pytest.mark.asyncio
async def test_sprint_swimline_efforts_grid(
    client: AsyncClient, db: AsyncSession, planned_grid: dict
) -> None:
    """The heatmap aggregation returns effort keyed by (sprint_index, swimline_id)."""
    grid = await sprint_swimline_efforts(db, planned_grid["pi_id"])
    alpha, beta = planned_grid["alpha_id"], planned_grid["beta_id"]
    assert grid == {
        (0, alpha): 8.0,
        (1, alpha): 3.0,
        (0, beta): 5.0,
    }


@pytest.mark.asyncio
async def test_sprint_swimline_efforts_empty_pi(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A PI with no placed PBIs yields an empty grid."""
    proj = (await client.post("/api/v1/projects/", json={"name": "Empty Grid"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis", json={"name": "Empty", "state": "draft"},
    )).json()
    assert await sprint_swimline_efforts(db, pi["system_id"]) == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("param", [
    "",
    "show_pi_effort=true",
    "show_export_date=true",
    "show_pi_effort=true&show_export_date=true",
])
async def test_png_export_heatmap_layout(
    client: AsyncClient, planned_grid: dict, param: str
) -> None:
    """The heatmap layout produces a valid PNG across its relevant options."""
    pi_id = planned_grid["pi_id"]
    query = "layout=heatmap" + (f"&{param}" if param else "")
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?{query}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == PNG_SIGNATURE
    assert len(resp.content) > 1000


@pytest.mark.asyncio
async def test_png_export_heatmap_empty_pi(client: AsyncClient) -> None:
    """The heatmap on a PI with no swimlines/placed PBIs still produces a valid PNG."""
    proj = (await client.post("/api/v1/projects/", json={"name": "Heatmap Empty"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty Heatmap PI", "state": "draft"},
    )).json()

    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/export/png?layout=heatmap")
    assert resp.status_code == 200
    assert resp.content[:8] == PNG_SIGNATURE


# ---------------------------------------------------------------------------
# PNG export — backlog composition layout (A2)
# ---------------------------------------------------------------------------

@pytest.fixture
async def planned_composition(client: AsyncClient) -> dict:
    """A PI with a mix of story ("PBI") and bug items across two swimlanes/sprints.

    Alpha, s0: 2 PBIs + 1 bug;  Alpha, s1: 1 PBI.
    Beta,  s0: 1 bug.
    """
    proj = (await client.post("/api/v1/projects/", json={"name": "Composition Test"})).json()
    pid = proj["system_id"]
    pi = (await client.post(
        f"/api/v1/projects/{pid}/pis", json={"name": "PI Comp", "state": "draft"},
    )).json()
    pi_id = pi["system_id"]

    alpha = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team Alpha"})).json()
    beta = (await client.post(f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team Beta"})).json()

    uid = [100]

    async def feature_in(lane_id: str, title: str) -> str:
        uid[0] += 1
        feat = (await client.post(
            f"/api/v1/projects/{pid}/features", json={"title": title, "id": uid[0]},
        )).json()
        await client.patch(
            f"/api/v1/features/{feat['system_id']}",
            json={"location": "pi", "pi_id": pi_id, "swimlane_id": lane_id},
        )
        return feat["system_id"]

    async def place(feat_id: str, item_type: str, sprint_index: int) -> None:
        uid[0] += 1
        pbi = (await client.post(
            f"/api/v1/projects/{pid}/pbis",
            json={"title": f"{item_type} {uid[0]}", "id": uid[0], "effort": 3,
                  "item_type": item_type, "parent_feature_system_id": feat_id},
        )).json()
        await client.post(f"/api/v1/pbis/{pbi['system_id']}/place", json={"sprint_index": sprint_index})

    fa = await feature_in(alpha["system_id"], "Alpha Feature")
    fb = await feature_in(beta["system_id"], "Beta Feature")
    await place(fa, "story", 0)
    await place(fa, "story", 0)
    await place(fa, "bug", 0)
    await place(fa, "story", 1)
    await place(fb, "bug", 0)

    return {"pi_id": pi_id, "alpha_id": alpha["system_id"], "beta_id": beta["system_id"]}


@pytest.mark.asyncio
async def test_sprint_swimline_item_counts_grid(
    client: AsyncClient, db: AsyncSession, planned_composition: dict
) -> None:
    """Item counts are keyed by (sprint_index, swimline_id) as (pbi_count, bug_count)."""
    counts = await sprint_swimline_item_counts(db, planned_composition["pi_id"])
    alpha, beta = planned_composition["alpha_id"], planned_composition["beta_id"]
    assert counts == {
        (0, alpha): (2, 1),
        (1, alpha): (1, 0),
        (0, beta): (0, 1),
    }


@pytest.mark.asyncio
async def test_sprint_swimline_item_counts_empty_pi(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A PI with no placed items yields an empty grid."""
    proj = (await client.post("/api/v1/projects/", json={"name": "Empty Comp"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis", json={"name": "Empty", "state": "draft"},
    )).json()
    assert await sprint_swimline_item_counts(db, pi["system_id"]) == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("param", [
    "",
    "show_pi_effort=true",
    "show_export_date=true",
])
async def test_png_export_composition_layout(
    client: AsyncClient, planned_composition: dict, param: str
) -> None:
    """The composition layout produces a valid PNG across its relevant options."""
    pi_id = planned_composition["pi_id"]
    query = "layout=composition" + (f"&{param}" if param else "")
    resp = await client.get(f"/api/v1/pis/{pi_id}/export/png?{query}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == PNG_SIGNATURE
    assert len(resp.content) > 1000


@pytest.mark.asyncio
async def test_png_export_composition_empty_pi(client: AsyncClient) -> None:
    """The composition layout on a PI with no items still produces a valid PNG."""
    proj = (await client.post("/api/v1/projects/", json={"name": "Comp Empty"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty Comp PI", "state": "draft"},
    )).json()

    resp = await client.get(f"/api/v1/pis/{pi['system_id']}/export/png?layout=composition")
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

    heatmap_resp = await reader_client.get(f"/api/v1/pis/{pi_id}/export/png?layout=heatmap")
    assert heatmap_resp.status_code == 200

    composition_resp = await reader_client.get(f"/api/v1/pis/{pi_id}/export/png?layout=composition")
    assert composition_resp.status_code == 200
