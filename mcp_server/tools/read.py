from typing import Annotated

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend

read_mcp = FastMCP("read")


@read_mcp.tool()
async def list_projects(ctx: Context) -> dict:
    """
    List all projects.

    Call this first to discover available projects and get their system_id values,
    which are needed for all subsequent project-scoped calls.
    Returns a list of ProjectResponse objects with system_id, name, description,
    effort_unit, and timestamps.
    """
    return await call_backend("GET", "/api/v1/projects/")


@read_mcp.tool()
async def get_project(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Get a single project by ID.

    Returns name, description, effort_unit, and timestamps.
    Use list_projects first to find the correct project_id.
    """
    return await call_backend("GET", f"/api/v1/projects/{project_id}")


@read_mcp.tool()
async def list_pis(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all PIs (Program Increments) for a project.

    Returns each PI with total_effort and total_capacity summaries, state
    (draft | in_progress | closed), and date ranges. Use get_pi for detailed
    sprint-level breakdown of a single PI.
    """
    return await call_backend("GET", f"/api/v1/projects/{project_id}/pis")


@read_mcp.tool()
async def get_pi(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Get a single PI with effort and capacity summary.

    Returns state, dates, total_effort (sum of all PBI efforts in this PI),
    and total_capacity (sum of sprint capacities).
    Use list_pis first to find the pi_id.
    """
    return await call_backend("GET", f"/api/v1/pis/{pi_id}")


@read_mcp.tool()
async def list_sprints(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all sprints in a PI with their effort totals and capacity.

    Returns 5 sprints (sprint_index 0–4) each with capacity, current effort,
    and optional date range. Use this to understand capacity utilisation before
    assigning PBIs to sprints.
    """
    return await call_backend("GET", f"/api/v1/pis/{pi_id}/sprints")


@read_mcp.tool()
async def list_swimlines(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all swimlines in a PI with effort per swimline.

    Swimlines are horizontal rows on the PI board, each representing a team or
    value stream. Returns system_id, name, order_index, effort, and capacity.
    Use get_edit_lock_status before creating or reordering swimlines.
    """
    return await call_backend("GET", f"/api/v1/pis/{pi_id}/swimlines")


@read_mcp.tool()
async def list_states(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List the project's State Lists — the labels its work items can carry.

    Each project has three independent lists keyed by item_type: 'feature', 'story',
    and 'bug'. They start empty and are populated by CSV import (from the file's State
    column) or by a user typing a new State in the web UI. Returns system_id, item_type,
    value, and position for every entry, ordered by item type then position.
    Call this before setting `state` on create_feature, update_feature, create_pbi, or
    update_pbi — those tools reject names that are not already in the matching list.
    """
    return await call_backend("GET", f"/api/v1/projects/{project_id}/states/")


@read_mcp.tool()
async def list_features(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all features for a project.

    Returns features from both the backlog (location='backlog') and those
    assigned to PIs (location='pi'). Each feature includes system_id, user_id
    (the business ID shown as [101] in the UI), title, effort, and PI/swimline
    assignment.
    """
    return await call_backend("GET", f"/api/v1/projects/{project_id}/features")


@read_mcp.tool()
async def get_feature(
    feature_id: Annotated[str, Field(description="Feature system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Get a single feature with full detail.

    Returns title, user_id (the business ID), description, effort (sum of child
    PBI efforts), location, and PI/swimline assignment.
    Use list_features first to find the feature_id.
    """
    return await call_backend("GET", f"/api/v1/features/{feature_id}")


@read_mcp.tool()
async def list_pbis(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
    feature_id: Annotated[
        str | None,
        Field(default=None, description="Optional: filter PBIs by feature system_id (UUID)"),
    ] = None,
) -> dict:
    """
    List PBIs (Product Backlog Items) for a project.

    Pass feature_id to filter to a specific feature's PBIs.
    Returns sprint assignment, effort, group_id, and location for each PBI.
    Use this before propose_pbi_sprint_plan to understand current assignments.
    """
    params: dict = {}
    if feature_id:
        params["feature_id"] = feature_id
    return await call_backend(
         "GET", f"/api/v1/projects/{project_id}/pbis", params=params
    )


@read_mcp.tool()
async def list_groups(
    swimline_id: Annotated[str, Field(description="Swimline system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all groups in a swimline.

    Groups are containers for PBIs within a swimline, optionally assigned to a
    sprint. Returns system_id, name, feature_system_id, sprint_index, and
    order_index. Use list_swimlines first to obtain the swimline_id.
    """
    return await call_backend("GET", f"/api/v1/swimlines/{swimline_id}/groups")


@read_mcp.tool()
async def list_snapshots(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List available named snapshots for a project.

    Snapshots are point-in-time captures of a project's full state (PIs,
    features, PBIs, swimlines, sprints, groups), created via create_snapshot.
    Returns each snapshot's system_id, name, created_at, and created_by —
    the system_id can be passed to restore_snapshot to roll the project back
    to that captured state.
    """
    # Trailing slash is required: this collection route is registered as
    # prefix="…/snapshots" + get("/"), so the canonical path ends in "/". Omitting
    # it triggers a 307 redirect that the httpx client does not follow.
    return await call_backend("GET", f"/api/v1/projects/{project_id}/snapshots/")


@read_mcp.tool()
async def diff_snapshot(
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
) -> dict:
    """
    Diff the current project state against a snapshot ("what changed since?").

    Compares the live plan to a baseline snapshot (the latest one unless you pass
    snapshot_id) and returns what was added, removed, and changed per entity type
    (features, pbis, pis, swimlines, sprints, groups, events), each 'changed' item
    listing the specific fields that moved (from → to). Also returns a 'summary'
    with counts and a total-effort delta, and a 'narrative' — a compact
    human-readable rundown suitable to show the user.

    Pass pi_id to focus on one PI; items pulled into or pushed out of that PI still
    appear. Read-only, no lock. Use list_snapshots to find snapshot_id values.
    Ideal at the end of a planning session: call this to review the delta, then
    create_snapshot to capture the new baseline.
    """
    params: dict = {}
    if snapshot_id:
        params["snapshot_id"] = snapshot_id
    if pi_id:
        params["pi_id"] = pi_id
    return await call_backend(
        "GET", f"/api/v1/projects/{project_id}/snapshots/diff", params=params
    )


@read_mcp.tool()
async def list_pi_events(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all events (milestone markers) for a PI, ordered by event_date ascending.

    Returns each event's system_id, name, event_date, event_type, and timestamps.
    Use the system_id with update_pi_event or delete_pi_event to modify events.
    Event types: 'release', 'milestone', 'deadline', 'pilot', 'go_no_go', 'other'.
    """
    return await call_backend("GET", f"/api/v1/pis/{pi_id}/events")


@read_mcp.tool()
async def get_edit_lock_status(
    project_id: Annotated[str, Field(description="Project system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    Check the current edit lock state for a project.

    Returns is_locked (bool), locked_by_username, locked_at, and expires_at.
    Returns {"is_locked": false} when no lock is held.
    Call this before any write tool if you want to check availability first,
    especially before starting a compound workflow that will hold the lock for
    multiple operations.
    """
    return await call_backend("GET", f"/api/v1/projects/{project_id}/edit-lock")
