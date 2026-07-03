from typing import Annotated, Literal

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend
from mcp_server.lock import edit_lock

pi_events_mcp = FastMCP("pi_events")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

_EventType = Literal["release", "milestone", "deadline", "pilot", "go_no_go", "other"]


@pi_events_mcp.tool()
async def create_pi_event(
    pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    name: Annotated[str, Field(max_length=100, description="Event name (max 100 chars)")],
    event_date: Annotated[str, Field(description="Event date in ISO 8601 format YYYY-MM-DD")],
    event_type: Annotated[
        _EventType,
        Field(description="Event type: 'release', 'milestone', 'deadline', 'pilot', 'go_no_go', or 'other'"),
    ],
    ctx: Context,
) -> dict:
    """
    Create a PI event (milestone marker) visible on the PI board.

    Events are date-anchored markers that appear as vertical lines on the board.
    Typical uses: mark a release date, a go/no-go decision, a pilot deployment, or any deadline.
    Returns a PIEventResponse including system_id needed for update_pi_event / delete_pi_event.
    Acquires the edit lock for the duration of the operation.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "POST",
            f"/api/v1/pis/{pi_id}/events",
            json={"name": name, "event_date": event_date, "event_type": event_type},
        )


@pi_events_mcp.tool()
async def update_pi_event(
    event_id: Annotated[str, Field(pattern=_UUID_RE, description="PI event system_id (UUID)")],
    pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    name: Annotated[
        str | None,
        Field(default=None, max_length=100, description="New event name (max 100 chars)"),
    ] = None,
    event_date: Annotated[
        str | None,
        Field(default=None, description="New event date in ISO 8601 format YYYY-MM-DD"),
    ] = None,
    event_type: Annotated[
        _EventType | None,
        Field(default=None, description="New event type"),
    ] = None,
) -> dict:
    """
    Update a PI event's name, date, and/or type.

    Supply only the fields you want to change — unset fields are left as-is.
    Use list_pi_events (read module) to find the event_id.
    Acquires the edit lock for the duration of the update.
    Returns the updated PIEventResponse.
    """
    body: dict = {}
    if name is not None:
        body["name"] = name
    if event_date is not None:
        body["event_date"] = event_date
    if event_type is not None:
        body["event_type"] = event_type

    async with edit_lock(project_id):
        return await call_backend(
            "PATCH",
            f"/api/v1/pis/{pi_id}/events/{event_id}",
            json=body,
        )


@pi_events_mcp.tool()
async def delete_pi_event(
    event_id: Annotated[str, Field(pattern=_UUID_RE, description="PI event system_id (UUID)")],
    pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
) -> dict:
    """
    Permanently delete a PI event.

    This operation is irreversible. Use list_pi_events (read module) to find the event_id.
    Acquires the edit lock for the duration of the operation.
    Returns {} on success.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "DELETE",
            f"/api/v1/pis/{pi_id}/events/{event_id}",
        )
