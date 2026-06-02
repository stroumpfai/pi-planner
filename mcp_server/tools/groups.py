from typing import Annotated, Any

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend
from mcp_server.lock import edit_lock

groups_mcp = FastMCP("groups")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Sentinel: distinguishes "caller omitted this field" from "caller passed null to clear it".
_UNSET: Any = object()


@groups_mcp.tool()
async def create_group(
    swimline_id: Annotated[str, Field(pattern=_UUID_RE, description="Swimline system_id (UUID) the group belongs to")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    name: Annotated[str, Field(max_length=100, description="Group name (max 100 chars, must be unique within the swimline)")],
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Feature system_id (UUID) — the feature must already be in this swimline")],
    ctx: Context,
    sprint_index: Annotated[
        int | None,
        Field(default=None, ge=0, le=4, description="Sprint index (0–4) to assign this group to"),
    ] = None,
    pbi_ids: Annotated[
        list[str] | None,
        Field(default=None, description="Optional list of PBI system_ids to include in this group. "
              "All PBIs must belong to the specified feature."),
    ] = None,
    order_index: Annotated[
        int | None,
        Field(default=None, description="Optional display order within the swimline"),
    ] = None,
) -> dict:
    """
    Create an explicit group within a swimline to organise PBIs.

    Groups let you cluster related PBIs under a named heading in the PI board.
    The feature must already be assigned to this swimline (use move_feature first).
    All provided PBI IDs must belong to the specified feature.
    For single-PBI placement use place_pbi_in_sprint instead — it creates an implicit group automatically.
    Acquires the edit lock for the duration of the operation.
    Returns the new GroupResponse including system_id.
    """
    body: dict = {
        "name": name,
        "feature_system_id": feature_id,
        "pbi_ids": pbi_ids or [],
    }
    if sprint_index is not None:
        body["sprint_index"] = sprint_index
    if order_index is not None:
        body["order_index"] = order_index

    async with edit_lock(project_id):
        return await call_backend("POST", f"/api/v1/swimlines/{swimline_id}/groups", json=body)


@groups_mcp.tool()
async def update_group(
    group_id: Annotated[str, Field(pattern=_UUID_RE, description="Group system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    name: Annotated[
        str | None,
        Field(default=None, max_length=100, description="New group name (max 100 chars)"),
    ] = None,
    sprint_index: Annotated[
        int | None,
        Field(default=None, ge=0, le=4, description="New sprint index (0–4). Pass null to unassign from sprint."),
    ] = _UNSET,
    order_index: Annotated[
        int | None,
        Field(default=None, description="New display order within the swimline"),
    ] = None,
) -> dict:
    """
    Rename a group, move it to a different sprint, or change its display order.

    Supply only the fields you want to change — unset fields are left as-is.
    Pass null for sprint_index to remove the group's sprint assignment entirely.
    Note: renaming an implicit group (auto-created by place_pbi_in_sprint) converts
    it to an explicit group.
    Acquires the edit lock for the duration of the update.
    Returns the updated GroupResponse.
    """
    body: dict = {}
    if name is not None:
        body["name"] = name
    if sprint_index is not _UNSET:
        body["sprint_index"] = sprint_index  # None sends null → clears sprint assignment
    if order_index is not None:
        body["order_index"] = order_index

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/groups/{group_id}", json=body)


@groups_mcp.tool()
async def delete_group(
    group_id: Annotated[str, Field(pattern=_UUID_RE, description="Group system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
) -> dict:
    """
    Delete a group. PBIs in the group become ungrouped (not deleted).

    After deletion the PBIs remain under their parent feature but have no
    sprint or group assignment. Use place_pbi_in_sprint or create_group to
    reassign them.
    This operation is permanent — deleted groups cannot be restored.
    Acquires the edit lock for the duration of the operation.
    Returns {} on success.
    """
    async with edit_lock(project_id):
        return await call_backend("DELETE", f"/api/v1/groups/{group_id}")
