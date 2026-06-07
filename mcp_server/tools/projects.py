from typing import Annotated

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend
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
    return await call_backend(
        "POST", f"/api/v1/projects/{project_id}/snapshots", json={"name": name}
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
