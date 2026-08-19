"""State List tools, and the name→id resolution the item write tools share.

Agents know a State by its name, not its system_id. An unrecognised name passed to an
item write is rejected rather than creating vocabulary: there it is far more likely a
typo than an intent. Extending a list is a deliberate act, so it has its own tool —
`create_state` — mirroring the human path through the States editor in the web UI.
"""

from typing import Annotated, Literal

from fastmcp import Context, FastMCP
from pydantic import Field

from mcp_server.backend import call_backend
from mcp_server.lock import edit_lock


def _normalise(value: str) -> str:
    return value.strip().lower()


def state_item_type_for_pbi(item_type: str) -> str:
    """Stories and Bugs draw from separate State Lists."""
    return "bug" if item_type == "bug" else "story"


async def resolve_state_id(project_id: str, item_type: str, state: str) -> str | None:
    """Map a State name to its system_id within one project's list for `item_type`.

    Returns None for a blank name (meaning "no State"). Raises ValueError when the
    name is not in the list, listing what is.
    """
    if _normalise(state) == "":
        return None

    # call_backend wraps list payloads as {"items": [...]} to keep tool returns dict-only.
    response = await call_backend("GET", f"/api/v1/projects/{project_id}/states/")
    states = response.get("items", [])
    candidates = [s for s in states if s["item_type"] == item_type]

    for entry in candidates:
        if _normalise(entry["value"]) == _normalise(state):
            return str(entry["system_id"])

    available = ", ".join(repr(s["value"]) for s in candidates) or "(the list is empty)"
    raise ValueError(
        f"No State named {state!r} for {item_type} items in this project. "
        f"Available: {available}. To add it, call create_state deliberately."
    )


states_mcp = FastMCP("states")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


@states_mcp.tool()
async def create_state(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    item_type: Annotated[
        Literal["feature", "story", "bug"],
        Field(description="Which of the project's three State Lists to add to"),
    ],
    value: Annotated[str, Field(max_length=100, description="The State name (max 100 chars)")],
    ctx: Context,
) -> dict:
    """
    Add a State to one of the project's three State Lists.

    This is the only way an agent creates State vocabulary — passing an unrecognised
    name to update_feature or update_pbi is rejected, because there it is far more
    likely a typo than an intent to extend the list.
    Values are compared case-insensitively after trimming; a duplicate is refused
    with STATE_VALUE_TAKEN rather than silently returning the existing entry.
    Use list_states first to see what the list already holds.
    Acquires the edit lock for the duration of the operation.
    Returns the new ProjectStateResponse including system_id.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "POST",
            f"/api/v1/projects/{project_id}/states/",
            json={"item_type": item_type, "value": value},
        )


@states_mcp.tool()
async def rename_state(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    state_id: Annotated[str, Field(pattern=_UUID_RE, description="State system_id (UUID) — from list_states")],
    value: Annotated[str, Field(max_length=100, description="The new State name (max 100 chars)")],
    ctx: Context,
) -> dict:
    """
    Rename a State in place — for example to fix a typo discovered after an import.

    Items reference States by id, so every feature and PBI carrying this State follows
    the new name automatically; nothing else needs updating.
    Renaming onto a value the same list already holds is refused with
    STATE_VALUE_TAKEN — the two entries are not merged. Delete one instead, after
    moving its items.
    Acquires the edit lock for the duration of the operation.
    Returns the updated ProjectStateResponse.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "PATCH",
            f"/api/v1/projects/{project_id}/states/{state_id}",
            json={"value": value},
        )


@states_mcp.tool()
async def reorder_states(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    item_type: Annotated[
        Literal["feature", "story", "bug"],
        Field(description="Which of the project's three State Lists to reorder"),
    ],
    order: Annotated[
        list[Annotated[str, Field(pattern=_UUID_RE)]],
        Field(description="Complete ordered list of the State system_ids in this list"),
    ],
    ctx: Context,
) -> dict:
    """
    Set the display order of one State List.

    The three lists are ordered independently — every id in `order` must belong to
    this project's list for `item_type`, or the call is rejected.
    Import discovery order is arbitrary, so this is how a list is put into a sensible
    workflow order (e.g. New → In Progress → Done).
    Use list_states first to get the current ids and order.
    Acquires the edit lock for the duration of the operation.
    Returns the reordered list.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "POST",
            f"/api/v1/projects/{project_id}/states/reorder",
            json={"item_type": item_type, "order": order},
        )


@states_mcp.tool()
async def delete_state(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    state_id: Annotated[str, Field(pattern=_UUID_RE, description="State system_id (UUID) — from list_states")],
    ctx: Context,
) -> dict:
    """
    Remove a State from its list.

    Refused with STATE_IN_USE while any feature or PBI still holds it — the error
    reports how many. Reassign or clear those items first.
    Deletion is permanent; there is no trash.
    Acquires the edit lock for the duration of the operation.
    Returns {} on success.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "DELETE", f"/api/v1/projects/{project_id}/states/{state_id}"
        )
