"""Integration tests for the PI readiness/readout report endpoint."""

import pytest
from httpx import AsyncClient

PDF_SIGNATURE = b"%PDF-"


@pytest.fixture
async def planned_pi(client: AsyncClient) -> dict:
    """project → PI → swimline → feature (in PI) → PBI (effort 3) placed in sprint 0.

    This scenario is intentionally *clean*: every readiness check passes.
    """
    proj = (await client.post("/api/v1/projects/", json={"name": "Report Test"})).json()
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


# ── readiness (markdown) ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_readiness_markdown_clean_pi(client: AsyncClient, planned_pi: dict) -> None:
    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/report")  # defaults: readiness/markdown
    assert resp.status_code == 200
    assert "text/markdown" in resp.headers["content-type"]
    assert "readiness.md" in resp.headers["Content-Disposition"]
    body = resp.text
    assert "Readiness Report — PI 2024.1" in body
    assert "No issues found" in body


@pytest.mark.asyncio
async def test_readiness_markdown_flags_issues(client: AsyncClient, planned_pi: dict) -> None:
    pid, feat_id, pi_id = planned_pi["project_id"], planned_pi["feature_id"], planned_pi["pi_id"]

    # Unestimated + unplaced PBI
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "No estimate story", "id": 202, "parent_feature_system_id": feat_id},
    )
    # Over-capacity: shrink sprint 0 capacity below the placed load (3)
    await client.patch(f"/api/v1/sprints/{planned_pi['sprint_0_id']}", json={"capacity": 1})
    # Feature with no PBIs
    empty_feat = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Empty Feature", "id": 150},
    )).json()
    await client.patch(
        f"/api/v1/features/{empty_feat['system_id']}",
        json={"location": "pi", "pi_id": pi_id, "swimlane_id": planned_pi["swimline_id"]},
    )

    resp = await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readiness&show_ids=true")
    assert resp.status_code == 200
    body = resp.text

    assert "issue(s) found" in body
    assert "[202] No estimate story" in body           # unestimated + unplaced
    assert "Sprint 1" in body and "over by" in body    # over-capacity
    assert "[150] Empty Feature" in body               # feature with no PBIs


@pytest.mark.asyncio
async def test_readiness_unestimated_bugs_are_informational(
    client: AsyncClient, planned_pi: dict
) -> None:
    """Unestimated bugs are surfaced separately and do not block readiness."""
    pid, feat_id, pi_id = planned_pi["project_id"], planned_pi["feature_id"], planned_pi["pi_id"]
    bug = (await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "Flaky login bug", "id": 300, "item_type": "bug",
              "parent_feature_system_id": feat_id},
    )).json()
    await client.post(f"/api/v1/pbis/{bug['system_id']}/place", json={"sprint_index": 0})

    resp = await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readiness")
    assert resp.status_code == 200
    body = resp.text
    # Bug appears in its own informational section...
    assert "Unestimated bugs" in body
    assert "[300] Flaky login bug" in body
    # ...but does not count as an actionable issue — the PI is still ready.
    assert "No issues found" in body


@pytest.mark.asyncio
async def test_readiness_unestimated_story_still_flagged(
    client: AsyncClient, planned_pi: dict
) -> None:
    """A non-bug unestimated item remains an actionable issue under 'Unestimated PBIs'."""
    pid, feat_id, pi_id = planned_pi["project_id"], planned_pi["feature_id"], planned_pi["pi_id"]
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "No estimate story", "id": 301, "item_type": "story",
              "parent_feature_system_id": feat_id},
    )
    resp = await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readiness")
    body = resp.text
    assert "issue(s) found" in body
    assert "Unestimated PBIs (1)" in body
    assert "[301] No estimate story" in body


@pytest.mark.asyncio
async def test_readiness_hide_ids(client: AsyncClient, planned_pi: dict) -> None:
    pid, feat_id, pi_id = planned_pi["project_id"], planned_pi["feature_id"], planned_pi["pi_id"]
    await client.post(
        f"/api/v1/projects/{pid}/pbis",
        json={"title": "No estimate story", "id": 202, "parent_feature_system_id": feat_id},
    )
    resp = await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readiness&show_ids=false")
    assert resp.status_code == 200
    assert "No estimate story" in resp.text
    assert "[202]" not in resp.text


# ── readout (markdown) ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_readout_markdown(client: AsyncClient, planned_pi: dict) -> None:
    pi_id = planned_pi["pi_id"]
    await client.post(
        f"/api/v1/pis/{pi_id}/events",
        json={"name": "Release v1", "event_date": "2025-03-15", "event_type": "release"},
    )
    resp = await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readout")
    assert resp.status_code == 200
    assert "readout.md" in resp.headers["Content-Disposition"]
    body = resp.text
    assert "PI Planning Readout — PI 2024.1" in body
    assert "Committed load by team" in body
    assert "Team Alpha" in body
    assert "Release v1" in body


# ── PDF ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("report_type", ["readiness", "readout"])
async def test_report_pdf(client: AsyncClient, planned_pi: dict, report_type: str) -> None:
    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/report?report_type={report_type}&fmt=pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert f"{report_type}.pdf" in resp.headers["Content-Disposition"]
    assert resp.content[:5] == PDF_SIGNATURE
    assert len(resp.content) > 1000


# ── validation / edge cases ──────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["report_type=bogus", "fmt=bogus"])
async def test_report_invalid_params(client: AsyncClient, planned_pi: dict, query: str) -> None:
    resp = await client.get(f"/api/v1/pis/{planned_pi['pi_id']}/report?{query}")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_report_404(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/pis/does-not-exist/report")
    assert resp.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("report_type,fmt", [
    ("readiness", "markdown"), ("readout", "markdown"),
    ("readiness", "pdf"), ("readout", "pdf"),
])
async def test_report_empty_pi(client: AsyncClient, report_type: str, fmt: str) -> None:
    proj = (await client.post("/api/v1/projects/", json={"name": "Empty Report"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty PI", "state": "draft"},
    )).json()
    resp = await client.get(
        f"/api/v1/pis/{pi['system_id']}/report?report_type={report_type}&fmt={fmt}"
    )
    assert resp.status_code == 200


# ── access control ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_report_reader_allowed(
    client: AsyncClient, reader_client: AsyncClient, planned_pi: dict
) -> None:
    pi_id = planned_pi["pi_id"]
    assert (await reader_client.get(f"/api/v1/pis/{pi_id}/report?report_type=readiness")).status_code == 200
    assert (await reader_client.get(f"/api/v1/pis/{pi_id}/report?report_type=readout&fmt=pdf")).status_code == 200
