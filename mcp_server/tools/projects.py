import base64
from typing import Annotated
from urllib.parse import urlencode

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend, call_backend_raw
from mcp_server.lock import edit_lock

projects_mcp = FastMCP("projects")


@projects_mcp.tool()
async def create_project(
    name: Annotated[str, Field(max_length=255, description="Project name (max 255 chars, must be unique)")],
    ctx: Context,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="Optional project description (max 2000 chars)"),
    ] = None,
) -> dict:
    """
    Create a new project.

    Projects are the top-level container. After creation, use create_pi to add
    Program Increments and list_features to manage the backlog.
    Returns the new ProjectResponse including system_id needed for all subsequent calls.
    Note: effort_unit defaults to 'pts' and can be changed later with update_project.
    """
    return await call_backend(
                "POST",
        "/api/v1/projects/",
        json={"name": name, "description": description},
    )


@projects_mcp.tool()
async def update_project(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
    name: Annotated[
        str | None,
        Field(default=None, max_length=255, description="New project name (max 255 chars)"),
    ] = None,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="New description (max 2000 chars)"),
    ] = None,
    effort_unit: Annotated[
        str | None,
        Field(default=None, max_length=20, description="Unit label for effort estimates, e.g. 'points', 'days', 'pts'"),
    ] = None,
) -> dict:
    """
    Update project metadata: name, description, and/or effort unit.

    Acquires the edit lock for the duration of the update.
    Only supply the fields you want to change — unset fields are left as-is.
    Returns the updated ProjectResponse.
    """
    body = {}
    if name is not None:
        body["name"] = name
    if description is not None:
        body["description"] = description
    if effort_unit is not None:
        body["effort_unit"] = effort_unit

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/projects/{project_id}", json=body)


@projects_mcp.tool()
async def export_project(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Export the full project as a JSON snapshot.

    Returns a complete export payload (version, exported_at, project with all
    features, PBIs, PIs, swimlines, groups, and sprints).
    This is a read-only operation — no lock is acquired.
    The export format can be re-imported via the backend's import endpoint.
    """
    return await call_backend("GET", f"/api/v1/projects/{project_id}/export")


@projects_mcp.tool()
async def create_snapshot(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    name: Annotated[str, Field(max_length=255, description="User-given name for the snapshot (max 255 chars)")],
    ctx: Context,
) -> dict:
    """
    Capture the full current state of the project under a user-given name, for later restoration.

    Snapshots record everything (PIs, features, PBIs, swimlines, sprints, groups)
    as of the moment they're taken. Use list_snapshots to see existing snapshots
    and restore_snapshot to roll the project back to one of them.
    This does not change project structure — like export_project, no lock is acquired.
    Returns the new snapshot object (system_id, name, created_at, created_by).
    """
    # Trailing slash required: the route is prefix="…/snapshots" + post("/"), so the
    # canonical path ends in "/". Without it the backend 307-redirects the POST and
    # the non-redirect-following client silently drops the write (no snapshot created).
    return await call_backend(
        "POST", f"/api/v1/projects/{project_id}/snapshots/", json={"name": name}
    )


@projects_mcp.tool()
async def restore_snapshot(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    snapshot_id: Annotated[str, Field(description="Snapshot system_id (UUID) — use list_snapshots to find it")],
    ctx: Context,
) -> dict:
    """
    Restore the project to a previously captured snapshot — a heavyweight, destructive operation.

    ⚠️ This OVERWRITES all current PIs, features, PBIs, swimlines, sprints, and
    groups with the data captured in the target snapshot. Anything created or
    changed since that snapshot was taken will be wiped from the project.
    Reassurance: a safety snapshot of the current state is automatically created
    first, so the operation itself is recoverable — you can restore_snapshot back
    to that safety snapshot if needed.
    Acquires the edit lock for the duration of the operation (it rebuilds the
    entire project).
    Returns the updated project object (same shape as update_project/export_project).
    """
    async with edit_lock(project_id):
        return await call_backend(
            "POST", f"/api/v1/projects/{project_id}/snapshots/{snapshot_id}/restore"
        )


@projects_mcp.tool()
async def create_pi(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    name: Annotated[str, Field(max_length=100, description="PI name (max 100 chars)")],
    ctx: Context,
    description: Annotated[
        str | None,
        Field(default=None, max_length=500, description="Optional PI description (max 500 chars)"),
    ] = None,
    state: Annotated[
        str,
        Field(
            default="draft",
            description="Initial PI state: 'draft' (default), 'in_progress', or 'closed'. Only one PI can be 'in_progress' at a time.",
        ),
    ] = "draft",
    start_date: Annotated[
        str | None,
        Field(default=None, description="Start date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
    end_date: Annotated[
        str | None,
        Field(default=None, description="End date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
) -> dict:
    """
    Create a new PI (Program Increment) within a project.

    Automatically creates 5 sprints (sprint_index 0–4) with zero capacity.
    Use update_sprint afterwards to set capacity and dates on each sprint.
    Only one PI can be in 'in_progress' state at a time — attempting to create
    a second active PI returns a 409 error.
    Acquires the edit lock for the duration of the operation.
    Returns the new PIResponse including system_id and effort/capacity totals.
    """
    body: dict = {"name": name, "state": state}
    if description is not None:
        body["description"] = description
    if start_date is not None:
        body["start_date"] = start_date
    if end_date is not None:
        body["end_date"] = end_date

    async with edit_lock(project_id):
        return await call_backend(
             "POST", f"/api/v1/projects/{project_id}/pis", json=body
        )


@projects_mcp.tool()
async def update_pi(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    project_id: Annotated[str, Field(description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    name: Annotated[
        str | None,
        Field(default=None, max_length=100, description="New PI name (max 100 chars)"),
    ] = None,
    description: Annotated[
        str | None,
        Field(default=None, max_length=500, description="New description (max 500 chars)"),
    ] = None,
    state: Annotated[
        str | None,
        Field(
            default=None,
            description="New state: 'draft', 'in_progress', or 'closed'. Closed PIs become read-only.",
        ),
    ] = None,
    start_date: Annotated[
        str | None,
        Field(default=None, description="Start date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
    end_date: Annotated[
        str | None,
        Field(default=None, description="End date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
) -> dict:
    """
    Update PI fields or transition its state.

    Supply only the fields you want to change. State transitions:
    - draft → in_progress: starts the PI (only one can be active at a time)
    - in_progress → closed: closes the PI (makes it read-only permanently)
    - closed → any: not allowed (closed PIs are immutable)
    Acquires the edit lock for the duration of the update.
    Returns the updated PIResponse.
    """
    body: dict = {}
    if name is not None:
        body["name"] = name
    if description is not None:
        body["description"] = description
    if state is not None:
        body["state"] = state
    if start_date is not None:
        body["start_date"] = start_date
    if end_date is not None:
        body["end_date"] = end_date

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/pis/{pi_id}", json=body)


@projects_mcp.tool()
async def update_sprint(
    sprint_id: Annotated[str, Field(description="Sprint system_id (UUID)")],
    project_id: Annotated[str, Field(description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    capacity: Annotated[
        int | None,
        Field(default=None, gt=0, description="Sprint capacity in effort units (must be > 0)"),
    ] = None,
    start_date: Annotated[
        str | None,
        Field(default=None, description="Sprint start date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
    end_date: Annotated[
        str | None,
        Field(default=None, description="Sprint end date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
) -> dict:
    """
    Set capacity and/or dates on a sprint.

    Use list_sprints to find sprint system_ids within a PI.
    Capacity must be a positive integer in the project's effort unit.
    Supply only the fields you want to change.
    Acquires the edit lock for the duration of the update.
    Returns the updated SprintResponse including current effort and capacity.
    """
    body: dict = {}
    if capacity is not None:
        body["capacity"] = capacity
    if start_date is not None:
        body["start_date"] = start_date
    if end_date is not None:
        body["end_date"] = end_date

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/sprints/{sprint_id}", json=body)


@projects_mcp.tool()
async def export_pi_csv(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Export a PI's PBIs as a CSV list.

    Returns the CSV content as a plain text string in {"csv": "..."}.
    Columns typically include feature, PBI title, effort, sprint assignment, and status.
    This is a read-only operation — no lock is acquired.
    Use list_pis first to find the pi_id.
    """
    r = await call_backend_raw("GET", f"/api/v1/pis/{pi_id}/export/csv")
    return {"csv": r.text}


@projects_mcp.tool()
async def export_pi_png(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
    layout: Annotated[str, Field(default="roadmap", description="'roadmap' (swimlane bars), 'list' (PBIs per sprint), 'heatmap' (team × sprint capacity grid), or 'composition' (team × sprint PBI/bug counts)")] = "roadmap",
    show_pi_effort: Annotated[bool, Field(default=False, description="Show total effort/capacity in the PI title")] = False,
    show_sprint_effort: Annotated[bool, Field(default=False, description="Show effort, capacity and ratio bar in each sprint header")] = False,
    show_swimlane_effort: Annotated[bool, Field(default=False, description="Show effort value inside each swimlane bar")] = False,
    show_events: Annotated[bool, Field(default=False, description="Show PI events as vertical lines on the chart")] = False,
    swimlane_text_center: Annotated[bool, Field(default=False, description="Center swimlane labels inside bars (default: left-aligned)")] = False,
    show_export_date: Annotated[bool, Field(default=False, description="Show export date in the bottom-right corner")] = False,
) -> dict:
    """
    Export a PI as a PNG image (base64-encoded).

    Returns {"png_base64": "<base64 string>"} — decode and save as a .png file to view.
    The `layout` selects the view: 'roadmap' shows swimlane bars across sprints, 'list'
    lists each sprint's PBIs, 'heatmap' renders a team × sprint grid coloured by capacity
    utilization (green/amber/red) — the fastest way to spot over-committed teams — and
    'composition' shows a team × sprint grid of PBI and bug counts (with per-team and
    per-sprint totals).
    All display options default to off — enable what you need.
    This is a read-only operation — no lock is acquired.
    Use list_pis first to find the pi_id.
    """
    params = urlencode({
        "layout": layout,
        "show_pi_effort": str(show_pi_effort).lower(),
        "show_sprint_effort": str(show_sprint_effort).lower(),
        "show_swimlane_effort": str(show_swimlane_effort).lower(),
        "show_events": str(show_events).lower(),
        "swimlane_text_center": str(swimlane_text_center).lower(),
        "show_export_date": str(show_export_date).lower(),
    })
    r = await call_backend_raw("GET", f"/api/v1/pis/{pi_id}/export/png?{params}")
    return {"png_base64": base64.b64encode(r.content).decode()}


@projects_mcp.tool()
async def export_pi_report(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
    report_type: Annotated[str, Field(default="readiness", description="'readiness' (data-quality checks) or 'readout' (planning summary)")] = "readiness",
    fmt: Annotated[str, Field(default="markdown", description="'markdown' or 'pdf'")] = "markdown",
    show_ids: Annotated[bool, Field(default=True, description="Include [user_id] prefixes on item names")] = True,
) -> dict:
    """
    Export a management report for a PI.

    Two report types:
    - 'readiness': a data-quality checklist (unestimated PBIs, over-capacity sprints,
      features with no PBIs, unplaced PBIs, orphaned items, duplicate/invalid user IDs).
    - 'readout': an end-of-planning summary (dates, per-team committed load, sprint
      capacity, over-capacity warnings, and the milestone timeline).

    For fmt='markdown' returns {"report_markdown": "..."} (ready to read/paste).
    For fmt='pdf' returns {"pdf_base64": "<base64 string>"} — decode and save as a .pdf.
    This is a read-only operation — no lock is acquired. Use list_pis first to find the pi_id.
    """
    params = urlencode({
        "report_type": report_type,
        "fmt": fmt,
        "show_ids": str(show_ids).lower(),
    })
    r = await call_backend_raw("GET", f"/api/v1/pis/{pi_id}/report?{params}")
    if fmt == "pdf":
        return {"pdf_base64": base64.b64encode(r.content).decode()}
    return {"report_markdown": r.text}


@projects_mcp.tool()
async def export_pi_dashboard(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
    refresh_seconds: Annotated[int, Field(default=0, ge=0, le=3600, description="Auto-refresh interval in seconds when the page is opened in a browser; 0 disables it")] = 0,
    show_ids: Annotated[bool, Field(default=False, description="Include [user_id] prefixes on item names")] = False,
) -> dict:
    """
    Export a live, self-contained HTML dashboard for a PI.

    Bundles the glanceable planning views into one page: capacity gauges per sprint,
    the capacity-vs-load heatmap (team × sprint, coloured green/amber/red), the
    backlog-composition grid (PBI/bug counts per team × sprint), and a milestone
    timeline. The HTML inlines all CSS/JS and makes no external calls, so it can be
    saved and opened directly or embedded anywhere.

    Returns {"html": "<!doctype html>..."}. `refresh_seconds` only matters when the
    page is opened in a browser (it re-fetches itself on that interval); leave it 0
    for a static snapshot. This is a read-only operation — no lock is acquired.
    Use list_pis first to find the pi_id. See also the dashboard://pi/{pi_id} resource.
    """
    params = urlencode({
        "refresh_seconds": refresh_seconds,
        "show_ids": str(show_ids).lower(),
    })
    r = await call_backend_raw("GET", f"/api/v1/pis/{pi_id}/export/html?{params}")
    return {"html": r.text}


@projects_mcp.tool()
async def export_snapshot_diff(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
    snapshot_id: Annotated[
        str | None,
        Field(default=None, description="Snapshot system_id to compare against; omit for the latest snapshot"),
    ] = None,
    pi_id: Annotated[
        str | None,
        Field(default=None, description="Optional: scope the diff to a single PI (system_id)"),
    ] = None,
    refresh_seconds: Annotated[int, Field(default=0, ge=0, le=3600, description="Auto-refresh interval in seconds when the page is opened in a browser; 0 disables it")] = 0,
) -> dict:
    """
    Export a self-contained HTML page of the snapshot diff (twin of diff_snapshot).

    Renders the same delta that diff_snapshot returns as JSON — added/removed/changed
    per entity type with field-level from → to deltas and an effort headline — as a
    single page with all CSS/JS inlined and no external calls, so it can be saved and
    opened directly. Compares against the latest snapshot unless snapshot_id is given;
    pass pi_id to scope to one PI.

    Returns {"html": "<!doctype html>..."}. `refresh_seconds` only matters in a
    browser. Read-only — no lock. See also the snapshot-diff://project/{project_id}
    resource for the latest whole-project diff.
    """
    params: dict = {"refresh_seconds": refresh_seconds}
    if snapshot_id:
        params["snapshot_id"] = snapshot_id
    if pi_id:
        params["pi_id"] = pi_id
    r = await call_backend_raw(
        "GET", f"/api/v1/projects/{project_id}/snapshots/diff/html?{urlencode(params)}"
    )
    return {"html": r.text}
