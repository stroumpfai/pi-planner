from typing import Annotated

from fastmcp import FastMCP, Context
from pydantic import BaseModel, Field

from mcp_server.backend import call_backend, MCPBackendError
from mcp_server.lock import edit_lock

workflows_mcp = FastMCP("workflows")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


class FeatureInput(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    user_id: int | None = Field(None, ge=1, le=999999)


class PBIInput(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    effort: int | None = Field(None, gt=0)
    user_id: int | None = Field(None, ge=1, le=999999)
    item_type: str = Field("story", pattern="^(story|bug)$")


class SprintAssignment(BaseModel):
    pbi_id: str = Field(..., pattern=_UUID_RE)
    sprint_index: int = Field(..., ge=0, le=4)


@workflows_mcp.tool()
async def bulk_create_features(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    features: Annotated[
        list[FeatureInput],
        Field(max_length=200, description="List of features to create (max 200). Each needs at least a title."),
    ],
    ctx: Context,
) -> dict:
    """
    Create multiple features in the project backlog in a single locked operation.

    Acquires the edit lock once for the entire batch — more efficient than
    calling create_feature repeatedly (which would acquire/release the lock each time).
    All features start in the backlog (location='backlog').
    Use plan_pi_backlog afterwards to move them into a PI swimline.
    Returns {"created": [list of FeatureResponse], "count": n}.
    """
    created = []
    failed = []
    async with edit_lock(project_id):
        for f in features:
            body: dict = {"title": f.title}
            if f.description is not None:
                body["description"] = f.description
            if f.user_id is not None:
                body["id"] = f.user_id
            try:
                result = await call_backend("POST", f"/api/v1/projects/{project_id}/features", json=body)
                created.append(result)
            except MCPBackendError as exc:
                if exc.code == "LOCKED":
                    raise  # lock lost — abort immediately
                failed.append({"title": f.title, "error": exc.code})
    return {"created": created, "failed": failed, "count": len(created)}


@workflows_mcp.tool()
async def bulk_create_pbis(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Parent feature system_id (UUID)")],
    pbis: Annotated[
        list[PBIInput],
        Field(max_length=200, description="List of PBIs to create under the feature (max 200)."),
    ],
    ctx: Context,
) -> dict:
    """
    Create multiple PBIs under a single feature in one locked operation.

    Acquires the edit lock once for the entire batch.
    All PBIs inherit the feature's project and PI placement.
    Use place_pbi_in_sprint or apply_pbi_sprint_plan afterwards to assign sprints.
    Returns {"created": [list of PBIResponse], "count": n}.
    """
    created = []
    failed = []
    async with edit_lock(project_id):
        for p in pbis:
            body: dict = {
                "title": p.title,
                "parent_feature_system_id": feature_id,
                "item_type": p.item_type,
            }
            if p.description is not None:
                body["description"] = p.description
            if p.effort is not None:
                body["effort"] = p.effort
            if p.user_id is not None:
                body["id"] = p.user_id
            try:
                result = await call_backend("POST", f"/api/v1/projects/{project_id}/pbis", json=body)
                created.append(result)
            except MCPBackendError as exc:
                if exc.code == "LOCKED":
                    raise  # lock lost — abort immediately
                failed.append({"title": p.title, "error": exc.code})
    return {"created": created, "failed": failed, "count": len(created)}


@workflows_mcp.tool()
async def plan_pi_backlog(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    swimline_id: Annotated[str, Field(pattern=_UUID_RE, description="Target swimline system_id (UUID) to move features into")],
    feature_ids: Annotated[
        list[Annotated[str, Field(pattern=_UUID_RE)]],
        Field(max_length=200, description="List of feature system_ids to move (max 200)"),
    ],
    ctx: Context,
) -> dict:
    """
    Move a set of backlog features into a PI swimline in a single locked operation.

    Acquires the edit lock once for the entire batch.
    The target swimline must already exist in the PI (use create_swimline first).
    Each feature's existing groups are carried over; the PI is derived from the swimline.
    Features that are already in a PI are also moved — no pre-check is done.
    Use propose_pbi_sprint_plan + apply_pbi_sprint_plan to assign PBIs to sprints after.
    Returns {"moved": [list of FeatureResponse], "count": n}.
    """
    moved = []
    failed = []
    async with edit_lock(project_id):
        for feature_id in feature_ids:
            try:
                result = await call_backend(
                    "PATCH",
                    f"/api/v1/features/{feature_id}",
                    json={"swimlane_id": swimline_id},
                )
                moved.append(result)
            except MCPBackendError as exc:
                if exc.code == "LOCKED":
                    raise  # lock lost — abort immediately
                failed.append({"feature_id": feature_id, "error": exc.code})
    return {"moved": moved, "failed": failed, "count": len(moved)}


@workflows_mcp.tool()
async def set_sprint_capacities(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id (UUID)")],
    capacities: Annotated[
        list[Annotated[int, Field(gt=0)]],
        Field(
            min_length=5,
            max_length=5,
            description="Exactly 5 capacity values > 0 (one per sprint, index 0–4).",
        ),
    ],
    ctx: Context,
) -> dict:
    """
    Set capacity on all 5 sprints of a PI in one call.

    Pass a list of exactly 5 positive integers — one per sprint in order (sprint 0 first).
    Fetches sprint IDs from the backend, then acquires the lock once and updates all sprints.
    More efficient than calling update_sprint 5 times separately.
    Returns {"sprints": [list of SprintResponse]}.
    """
    # Read sprint IDs first (no lock needed)
    sprints_data = await call_backend("GET", f"/api/v1/pis/{pi_id}/sprints")
    sprints = sprints_data.get("items", [])
    sprints_sorted = sorted(sprints, key=lambda s: s["sprint_index"])

    if len(sprints_sorted) != len(capacities):
        raise ValueError(
            f"PI has {len(sprints_sorted)} sprint(s) but {len(capacities)} capacity value(s) were provided."
        )

    updated = []
    async with edit_lock(project_id):
        for sprint, capacity in zip(sprints_sorted, capacities):
            result = await call_backend(
                "PATCH",
                f"/api/v1/sprints/{sprint['system_id']}",
                json={"capacity": capacity},
            )
            updated.append(result)
    return {"sprints": updated}


@workflows_mcp.tool()
async def propose_pbi_sprint_plan(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id (UUID) to plan sprints for")],
    ctx: Context,
) -> dict:
    """
    Read-only: propose a PBI-to-sprint assignment plan based on effort and capacity.

    Reads sprint capacities and all unassigned PBIs in the PI, then uses a greedy
    first-fit algorithm to propose which PBIs should go into which sprints.
    Makes NO writes to the database — no lock is acquired.
    Returns a proposed plan for the user to review and adjust before applying.
    Call apply_pbi_sprint_plan with the (possibly edited) assignments to execute the plan.

    Returns:
    {
      "assignments": [{"pbi_id": "...", "sprint_index": 0, "title": "...", "effort": 5}],
      "unassigned": [{"pbi_id": "...", "title": "...", "effort": 13, "reason": "no sprint has enough remaining capacity"}],
      "sprint_summary": [{"sprint_index": 0, "capacity": 50, "planned_effort": 45, "remaining": 5}]
    }
    """
    # Gather all data — no lock, all reads
    sprints_data = await call_backend("GET", f"/api/v1/pis/{pi_id}/sprints")
    sprints = sprints_data.get("items", [])
    sprints_sorted = sorted(sprints, key=lambda s: s["sprint_index"])

    features_data = await call_backend("GET", f"/api/v1/projects/{project_id}/features")
    features = features_data.get("items", [])
    pi_feature_ids = {f["system_id"] for f in features if f.get("pi_id") == pi_id}

    pbis_data = await call_backend("GET", f"/api/v1/projects/{project_id}/pbis")
    pbis = pbis_data.get("items", [])

    # Only consider PBIs that belong to this PI and have no sprint assignment yet
    unassigned_pbis = [
        p for p in pbis
        if p.get("parent_feature_system_id") in pi_feature_ids
        and p.get("group_id") is None
    ]
    unassigned_pbis.sort(key=lambda p: -(p.get("effort") or 0))  # largest effort first

    # Track remaining capacity per sprint
    remaining: dict[int, int] = {s["sprint_index"]: (s.get("capacity") or 0) for s in sprints_sorted}

    assignments = []
    unassigned_out = []

    for pbi in unassigned_pbis:
        effort = pbi.get("effort") or 0
        placed = False
        for sprint in sprints_sorted:
            idx = sprint["sprint_index"]
            if remaining[idx] >= effort:
                assignments.append({
                    "pbi_id": pbi["system_id"],
                    "sprint_index": idx,
                    "title": pbi["title"],
                    "effort": effort,
                })
                remaining[idx] -= effort
                placed = True
                break
        if not placed:
            unassigned_out.append({
                "pbi_id": pbi["system_id"],
                "title": pbi["title"],
                "effort": effort,
                "reason": "no sprint has enough remaining capacity",
            })

    sprint_summary = [
        {
            "sprint_index": s["sprint_index"],
            "capacity": s.get("capacity") or 0,
            "planned_effort": (s.get("capacity") or 0) - remaining[s["sprint_index"]],
            "remaining": remaining[s["sprint_index"]],
        }
        for s in sprints_sorted
    ]

    return {
        "assignments": assignments,
        "unassigned": unassigned_out,
        "sprint_summary": sprint_summary,
    }


@workflows_mcp.tool()
async def apply_pbi_sprint_plan(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    assignments: Annotated[
        list[SprintAssignment],
        Field(max_length=200, description="List of PBI→sprint assignments to execute (max 200). "
              "Typically the output of propose_pbi_sprint_plan after user review."),
    ],
    ctx: Context,
) -> dict:
    """
    Execute a confirmed PBI-to-sprint assignment plan.

    This is the write half of the two-phase propose → confirm → apply workflow.
    Call propose_pbi_sprint_plan first, let the user review/adjust, then call this.
    Acquires the edit lock once for the entire batch.
    Each PBI's parent feature must already be in a PI swimline.
    PBIs that are already in a group are skipped (reported in errors).
    Returns {"placed": n, "errors": [{"pbi_id": "...", "error": "..."}]}.
    """
    placed = 0
    errors = []
    async with edit_lock(project_id):
        for a in assignments:
            try:
                await call_backend(
                    "POST",
                    f"/api/v1/pbis/{a.pbi_id}/place",
                    json={"sprint_index": a.sprint_index},
                )
                placed += 1
            except MCPBackendError as exc:
                if exc.code == "LOCKED":
                    raise  # lock lost mid-batch — abort entirely
                errors.append({"pbi_id": a.pbi_id, "error": exc.code})
    return {"placed": placed, "errors": errors}


@workflows_mcp.tool()
async def summarize_project(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Return a full snapshot of the project: metadata, active PI, sprint utilisation, and backlog counts.

    Read-only — no lock is acquired.
    Useful for getting an overview before planning, or for reporting current status.

    Returns:
    {
      "project": {name, effort_unit, ...},
      "active_pi": {name, state, start_date, end_date} | null,
      "sprints": [{"sprint_index": 0, "capacity": 50, "effort": 30, "utilisation_pct": 60}],
      "features": {"total": 12, "in_backlog": 4, "in_pi": 8},
      "pbis": {"total": 45, "assigned_to_sprint": 30, "unassigned": 15, "total_effort": 120}
    }
    """
    project = await call_backend("GET", f"/api/v1/projects/{project_id}")

    pis_data = await call_backend("GET", f"/api/v1/projects/{project_id}/pis")
    pis = pis_data.get("items", [])
    active_pi = next((p for p in pis if p.get("state") == "in_progress"), None)

    sprints_summary: list[dict] = []
    if active_pi:
        sprints_data = await call_backend("GET", f"/api/v1/pis/{active_pi['system_id']}/sprints")
        sprints = sprints_data.get("items", [])
        for s in sorted(sprints, key=lambda x: x["sprint_index"]):
            cap = s.get("capacity") or 0
            eff = s.get("effort") or 0
            sprints_summary.append({
                "sprint_index": s["sprint_index"],
                "capacity": cap,
                "effort": eff,
                "utilisation_pct": round(eff / cap * 100) if cap else 0,
            })

    features_data = await call_backend("GET", f"/api/v1/projects/{project_id}/features")
    features = features_data.get("items", [])
    in_backlog = sum(1 for f in features if f.get("location") == "backlog")
    in_pi = sum(1 for f in features if f.get("location") == "pi")

    pbis_data = await call_backend("GET", f"/api/v1/projects/{project_id}/pbis")
    pbis = pbis_data.get("items", [])
    assigned = sum(1 for p in pbis if p.get("group_id") is not None)
    total_effort = sum(p.get("effort") or 0 for p in pbis)

    return {
        "project": project,
        "active_pi": active_pi,
        "sprints": sprints_summary,
        "features": {"total": len(features), "in_backlog": in_backlog, "in_pi": in_pi},
        "pbis": {
            "total": len(pbis),
            "assigned_to_sprint": assigned,
            "unassigned": len(pbis) - assigned,
            "total_effort": total_effort,
        },
    }
