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


# ── sprint breakdown ─────────────────────────────────────────────────────────

@pytest.fixture
async def breakdown_pi(client: AsyncClient) -> dict:
    """A PI exercising every branch of the breakdown tree.

    Sprint 1 (dated): feature 101 → story 201 (state "Done") + story 203 (no state)
    Sprint 2:         feature 101 → bug 202 (state "Open")
    Sprints 3-5:      empty
    Unplaced:         feature 150 → story 301, plus feature 151 with no PBIs at all
    """
    proj = (await client.post("/api/v1/projects/", json={"name": "Breakdown Test"})).json()
    pid = proj["system_id"]

    pi = (await client.post(
        f"/api/v1/projects/{pid}/pis", json={"name": "PI 2024.1", "state": "draft"},
    )).json()
    pi_id = pi["system_id"]

    sprints = {s["sprint_index"]: s for s in (await client.get(f"/api/v1/pis/{pi_id}/sprints")).json()}
    await client.patch(
        f"/api/v1/sprints/{sprints[0]['system_id']}",
        json={"capacity": 20, "start_date": "2026-01-06", "end_date": "2026-01-19"},
    )
    await client.patch(f"/api/v1/sprints/{sprints[1]['system_id']}", json={"capacity": 20})

    sl_id = (await client.post(
        f"/api/v1/pis/{pi_id}/swimlines", json={"name": "Team Alpha"},
    )).json()["system_id"]

    async def make_state(item_type: str, value: str) -> str:
        resp = await client.post(
            f"/api/v1/projects/{pid}/states/", json={"item_type": item_type, "value": value},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["system_id"]

    feature_state = await make_state("feature", "In Progress")
    story_state = await make_state("story", "Done")
    bug_state = await make_state("bug", "Open")

    async def feature_in_pi(user_id: int, title: str, state_id: str | None = None) -> str:
        feat = (await client.post(
            f"/api/v1/projects/{pid}/features", json={"title": title, "id": user_id},
        )).json()
        body: dict = {"location": "pi", "pi_id": pi_id, "swimlane_id": sl_id}
        if state_id:
            body["state_id"] = state_id
        await client.patch(f"/api/v1/features/{feat['system_id']}", json=body)
        return feat["system_id"]

    async def pbi(feat_id: str, user_id: int, title: str, **kwargs: object) -> str:
        body = {"title": title, "id": user_id, "effort": 3,
                "parent_feature_system_id": feat_id, **kwargs}
        resp = await client.post(f"/api/v1/projects/{pid}/pbis", json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()["system_id"]

    auth = await feature_in_pi(101, "Auth Feature", feature_state)
    story = await pbi(auth, 201, "Login endpoint", state_id=story_state)
    bug = await pbi(auth, 202, "Token refresh crash", item_type="bug", state_id=bug_state)
    stateless = await pbi(auth, 203, "No state story")
    await client.post(f"/api/v1/pbis/{story}/place", json={"sprint_index": 0})
    await client.post(f"/api/v1/pbis/{stateless}/place", json={"sprint_index": 0})
    await client.post(f"/api/v1/pbis/{bug}/place", json={"sprint_index": 1})

    reporting = await feature_in_pi(150, "Reporting Feature")
    await pbi(reporting, 301, "CSV export")  # never placed
    await feature_in_pi(151, "Empty Feature")

    return {"project_id": pid, "pi_id": pi_id, "feature_id": auth}


def _report(pi_id: str, **params: object) -> str:
    query = "&".join(f"{k}={str(v).lower() if isinstance(v, bool) else v}"
                     for k, v in params.items())
    return f"/api/v1/pis/{pi_id}/report?report_type=breakdown&{query}"


@pytest.mark.asyncio
async def test_breakdown_markdown_structure(client: AsyncClient, breakdown_pi: dict) -> None:
    resp = await client.get(_report(breakdown_pi["pi_id"]))
    assert resp.status_code == 200
    assert "text/markdown" in resp.headers["content-type"]
    assert "breakdown.md" in resp.headers["Content-Disposition"]
    body = resp.text

    assert "# Sprint Breakdown — PI 2024.1" in body
    assert "## Sprint 1" in body
    assert "## Sprint 2" in body
    # Feature heading carries its id and State; the table carries the items.
    assert "### [101] Auth Feature — In Progress" in body
    assert "| Type | ID | Title | State |" in body
    assert "| PBI | 201 | Login endpoint | Done |" in body
    assert "| Bug | 202 | Token refresh crash | Open |" in body


@pytest.mark.asyncio
async def test_breakdown_sprint_sections_partition_items(
    client: AsyncClient, breakdown_pi: dict
) -> None:
    """Each item appears under the sprint it is actually placed in."""
    body = (await client.get(_report(breakdown_pi["pi_id"]))).text
    sprint_1 = body.split("## Sprint 1", 1)[1].split("## Sprint 2", 1)[0]
    sprint_2 = body.split("## Sprint 2", 1)[1].split("## Sprint 3", 1)[0]

    assert "Login endpoint" in sprint_1 and "No state story" in sprint_1
    assert "Token refresh crash" not in sprint_1
    assert "Token refresh crash" in sprint_2
    assert "Login endpoint" not in sprint_2


@pytest.mark.asyncio
async def test_breakdown_shows_sprint_dates(client: AsyncClient, breakdown_pi: dict) -> None:
    body = (await client.get(_report(breakdown_pi["pi_id"]))).text
    assert "## Sprint 1  (06.01.2026 → 19.01.2026)" in body
    assert "## Sprint 2\n" in body  # no dates set → no parenthetical


@pytest.mark.asyncio
async def test_breakdown_empty_sprint(client: AsyncClient, breakdown_pi: dict) -> None:
    body = (await client.get(_report(breakdown_pi["pi_id"]))).text
    sprint_3 = body.split("## Sprint 3", 1)[1].split("## Sprint 4", 1)[0]
    assert "_No items placed._" in sprint_3


@pytest.mark.asyncio
async def test_breakdown_hide_ids(client: AsyncClient, breakdown_pi: dict) -> None:
    body = (await client.get(_report(breakdown_pi["pi_id"], show_ids=False))).text
    assert "[101]" not in body
    assert "### Auth Feature — In Progress" in body
    assert "| Type | Title | State |" in body
    assert "| PBI | Login endpoint | Done |" in body


@pytest.mark.asyncio
async def test_breakdown_hide_states(client: AsyncClient, breakdown_pi: dict) -> None:
    body = (await client.get(_report(breakdown_pi["pi_id"], show_states=False))).text
    assert "In Progress" not in body
    assert "Done" not in body
    assert "### [101] Auth Feature\n" in body
    assert "| Type | ID | Title |" in body
    assert "| PBI | 201 | Login endpoint |" in body


@pytest.mark.asyncio
async def test_breakdown_item_without_state_renders_empty_cell(
    client: AsyncClient, breakdown_pi: dict
) -> None:
    body = (await client.get(_report(breakdown_pi["pi_id"]))).text
    assert "| PBI | 203 | No state story |  |" in body


@pytest.mark.asyncio
@pytest.mark.parametrize("include_unplaced", [True, False])
async def test_breakdown_include_unplaced(
    client: AsyncClient, breakdown_pi: dict, include_unplaced: bool
) -> None:
    body = (await client.get(
        _report(breakdown_pi["pi_id"], include_unplaced=include_unplaced)
    )).text
    present = [
        "## Not placed in a sprint",
        "[150] Reporting Feature",
        "CSV export",
        "[151] Empty Feature",
        "_No PBIs._",
    ]
    for token in present:
        assert (token in body) is include_unplaced, token
    # Placed items are unaffected either way.
    assert "Login endpoint" in body


@pytest.mark.asyncio
async def test_breakdown_implicit_group_not_rendered(
    client: AsyncClient, breakdown_pi: dict
) -> None:
    """Placing a single PBI creates an implicit group named after it; the tree
    must stay Sprint → Feature → item and never surface that group."""
    body = (await client.get(_report(breakdown_pi["pi_id"]))).text
    headings = [line for line in body.splitlines() if line.startswith("#")]
    assert not any("Login endpoint" in h for h in headings)
    assert not any("Token refresh crash" in h for h in headings)


@pytest.mark.asyncio
async def test_breakdown_pdf(client: AsyncClient, breakdown_pi: dict) -> None:
    resp = await client.get(_report(breakdown_pi["pi_id"], fmt="pdf"))
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "breakdown.pdf" in resp.headers["Content-Disposition"]
    assert resp.content[:5] == PDF_SIGNATURE
    assert len(resp.content) > 1000


@pytest.mark.asyncio
@pytest.mark.parametrize("fmt", ["markdown", "pdf"])
async def test_breakdown_empty_pi(client: AsyncClient, fmt: str) -> None:
    proj = (await client.post("/api/v1/projects/", json={"name": "Empty Breakdown"})).json()
    pi = (await client.post(
        f"/api/v1/projects/{proj['system_id']}/pis",
        json={"name": "Empty PI", "state": "draft"},
    )).json()
    resp = await client.get(_report(pi["system_id"], fmt=fmt))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_other_report_types_unaffected_by_breakdown(
    client: AsyncClient, breakdown_pi: dict
) -> None:
    """Guards the report dispatch: readout must not fall through to breakdown."""
    pi_id = breakdown_pi["pi_id"]
    readout = (await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readout")).text
    assert "PI Planning Readout" in readout
    assert "Sprint Breakdown" not in readout
    readiness = (await client.get(f"/api/v1/pis/{pi_id}/report?report_type=readiness")).text
    assert "Readiness Report" in readiness
    assert "Sprint Breakdown" not in readiness


@pytest.mark.asyncio
async def test_breakdown_reader_allowed(
    reader_client: AsyncClient, breakdown_pi: dict
) -> None:
    resp = await reader_client.get(_report(breakdown_pi["pi_id"]))
    assert resp.status_code == 200
