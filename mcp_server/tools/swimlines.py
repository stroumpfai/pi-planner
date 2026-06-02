from typing import Annotated

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend
from mcp_server.lock import edit_lock

swimlines_mcp = FastMCP("swimlines")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


@swimlines_mcp.tool()
async def create_swimline(
    pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    name: Annotated[str, Field(max_length=100, description="Swimline name (max 100 chars, must be unique within the PI)")],
    ctx: Context,
    order_index: Annotated[
        int | None,
        Field(default=None, ge=0, description="Optional display order (0-based). Appended at end if omitted."),
    ] = None,
) -> dict:
    """
    Create a new swimline in a PI.

    Swimlines are the horizontal rows in the PI board (e.g. one per team or value stream).
    Use list_swimlines first to see existing swimlines and their order_index values.
    After creating a swimline, use move_feature to assign backlog features into it.
    Returns the new SwimlineResponse including system_id needed for subsequent calls.
    """
    body: dict = {"name": name}
    if order_index is not None:
        body["order_index"] = order_index

    async with edit_lock(project_id):
        return await call_backend("POST", f"/api/v1/pis/{pi_id}/swimlines", json=body)


@swimlines_mcp.tool()
async def update_swimline(
    swimline_id: Annotated[str, Field(pattern=_UUID_RE, description="Swimline system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    name: Annotated[
        str | None,
        Field(default=None, max_length=100, description="New swimline name (max 100 chars)"),
    ] = None,
    order_index: Annotated[
        int | None,
        Field(default=None, ge=0, description="New display order (0-based)"),
    ] = None,
) -> dict:
    """
    Rename a swimline or change its display order.

    Supply only the fields you want to change — unset fields are left as-is.
    To reorder multiple swimlines at once use reorder_swimlines instead.
    Acquires the edit lock for the duration of the update.
    Returns the updated SwimlineResponse.
    """
    body: dict = {}
    if name is not None:
        body["name"] = name
    if order_index is not None:
        body["order_index"] = order_index

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/swimlines/{swimline_id}", json=body)


@swimlines_mcp.tool()
async def delete_swimline(
    swimline_id: Annotated[str, Field(pattern=_UUID_RE, description="Swimline system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
) -> dict:
    """
    Delete a swimline and return all its features to the backlog.

    All features assigned to this swimline are moved back to location='backlog'.
    Their groups are preserved but their PI/swimlane assignment is cleared.
    This operation is permanent — deleted swimlines cannot be restored.
    Acquires the edit lock for the duration of the operation.
    Returns {} on success.
    """
    async with edit_lock(project_id):
        return await call_backend("DELETE", f"/api/v1/swimlines/{swimline_id}")


@swimlines_mcp.tool()
async def reorder_swimlines(
    swimline_id: Annotated[
        str,
        Field(pattern=_UUID_RE, description="system_id of any swimline in the target PI — used to identify which PI to reorder"),
    ],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    order: Annotated[
        list[Annotated[str, Field(pattern=_UUID_RE)]],
        Field(description="Complete ordered list of all swimline system_ids in the desired display order"),
    ],
    ctx: Context,
) -> dict:
    """
    Bulk-reorder all swimlines in a PI in a single operation.

    Pass the complete list of swimline system_ids in the desired display order.
    All swimlines in the PI must be included — any missing ones are left unchanged.
    Use list_swimlines first to get the current swimline IDs and order.
    Acquires the edit lock for the duration of the operation.
    Returns the full list of SwimlineResponse objects in their new order.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "POST", f"/api/v1/swimlines/{swimline_id}/reorder", json={"order": order}
        )
