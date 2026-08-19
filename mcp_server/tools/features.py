from typing import Annotated, Any, Literal

from fastmcp import FastMCP, Context
from pydantic import Field

from mcp_server.backend import call_backend
from mcp_server.lock import edit_lock
from mcp_server.tools.states import resolve_state_id, state_item_type_for_pbi

features_mcp = FastMCP("features")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Sentinel that distinguishes "caller omitted this field" from "caller explicitly
# passed null to clear the field".  FastMCP calls tools with **kwargs, so omitted
# params arrive as the Python default (_UNSET); explicitly-null params arrive as None.
_UNSET: Any = object()


@features_mcp.tool()
async def create_feature(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    title: Annotated[str, Field(max_length=255, description="Feature title (max 255 chars)")],
    ctx: Context,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="Optional plain-text description (max 2000 chars)"),
    ] = None,
    user_id: Annotated[
        int | None,
        Field(default=None, ge=1, le=999999,
              description="Optional business ID shown in UI as [101]. Must be unique per project."),
    ] = None,
    state: Annotated[
        str | None,
        Field(default=None, max_length=100,
              description="Optional State name. Must already exist in the project's feature "
                          "State List (see list_states); unknown names are rejected."),
    ] = None,
) -> dict:
    """
    Create a new feature in the project backlog.

    Features are the parent container for PBIs (user stories / bugs).
    The feature starts in the backlog (location='backlog').
    Use move_feature afterwards to assign it to a PI and swimline.
    Use create_pbi to add user stories or bugs under this feature.
    Returns a FeatureResponse including system_id needed for subsequent calls.
    """
    body: dict = {"title": title}
    if description is not None:
        body["description"] = description
    if user_id is not None:
        body["id"] = user_id
    if state is not None:
        # Resolved here so an unknown name is rejected before the write, and so the
        # backend — which only accepts ids — never has to interpret a name.
        state_id = await resolve_state_id(project_id, "feature", state)
        if state_id is not None:
            body["state_id"] = state_id

    async with edit_lock(project_id):
        return await call_backend("POST", f"/api/v1/projects/{project_id}/features", json=body)


@features_mcp.tool()
async def update_feature(
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Feature system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    title: Annotated[
        str | None,
        Field(default=None, max_length=255, description="New title (max 255 chars)"),
    ] = None,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="New description (max 2000 chars). Pass null to clear."),
    ] = _UNSET,
    user_id: Annotated[
        int | None,
        Field(default=None, ge=1, le=999999,
              description="New business ID (1–999999, unique per project). Pass null to clear."),
    ] = _UNSET,
    state: Annotated[
        str | None,
        Field(default=None, max_length=100,
              description="New State name. Must already exist in the project's feature State "
                          "List (see list_states); unknown names are rejected. Pass null to clear."),
    ] = _UNSET,
) -> dict:
    """
    Update a feature's metadata: title, description, and/or business ID.

    Use this to rename a feature or change its visible ID — not to move it between
    the backlog and a PI (use move_feature for that).
    Supply only the fields you want to change — unset fields are left as-is.
    Pass null explicitly for description or user_id to clear those fields.
    Acquires the edit lock for the duration of the update.
    Returns the updated FeatureResponse.
    """
    body: dict = {}
    if title is not None:
        body["title"] = title
    if description is not _UNSET:
        body["description"] = description  # None sends null → clears the field
    if user_id is not _UNSET:
        body["id"] = user_id  # None sends null → clears the field
    if state is not _UNSET:
        # Validated against the list first: unknown names raise rather than creating an entry.
        body["state_id"] = await resolve_state_id(project_id, "feature", state or "")

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/features/{feature_id}", json=body)


@features_mcp.tool()
async def move_feature(
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Feature system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    swimlane_id: Annotated[
        str | None,
        Field(default=None, description="Swimline system_id to move this feature into a PI. "
              "The backend derives the PI from the swimline automatically."),
    ] = None,
    location: Annotated[
        Literal["backlog"] | None,
        Field(default=None, description="Pass 'backlog' to return this feature to the backlog. "
              "Its groups will be deleted and PI/swimlane assignment cleared."),
    ] = None,
) -> dict:
    """
    Move a feature between the backlog and a PI swimline.

    To move to a PI: provide swimlane_id (the target swimline's system_id).
      The PI is derived automatically from the swimline.
      Existing groups are carried over to the new swimlane.
    To return to backlog: provide location='backlog'.
      All groups are deleted and PI/swimlane assignment is cleared.
    Provide exactly one of swimlane_id or location='backlog'.
    Acquires the edit lock for the duration of the move.
    Returns the updated FeatureResponse.
    """
    body: dict = {}
    if swimlane_id is not None:
        body["swimlane_id"] = swimlane_id
    if location is not None:
        body["location"] = location

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/features/{feature_id}", json=body)


@features_mcp.tool()
async def split_feature(
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Feature system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    target_pi_id: Annotated[str, Field(pattern=_UUID_RE, description="PI system_id to carry the selected PBIs into")],
    target_swimline_id: Annotated[str, Field(pattern=_UUID_RE, description="Swimline system_id within the target PI")],
    pbi_ids: Annotated[
        list[str],
        Field(min_length=1, description="system_ids of this feature's PBIs to carry over to the target PI"),
    ],
    ctx: Context,
) -> dict:
    """
    Carry unfinished PBIs of a feature over into a later PI.

    Use this when a feature can't be finished within its current PI and the remaining
    (unfinished) PBIs need to be planned into a following PI's sprints, while finished
    PBIs stay recorded in the current PI.

    If pbi_ids covers every PBI currently under the feature, the whole feature is simply
    relocated to the target PI/swimline (same as move_feature) — no split occurs.
    Otherwise, a new linked "continuation" feature is created in the target PI/swimline
    (same title and State, continued_from_feature_id pointing back to this feature)
    holding only the selected PBIs; the original feature keeps the rest. The moved PBIs land unsprinted
    in the target swimline — use place_pbi_in_sprint afterwards to assign them to sprints.
    A continuation feature can itself be split again later, forming a chain across more
    than two PIs.
    Acquires the edit lock for the duration of the operation.
    Returns the FeatureResponse of the continuation feature (or the original, whole-move case).
    """
    body = {
        "target_pi_id": target_pi_id,
        "target_swimline_id": target_swimline_id,
        "pbi_ids": pbi_ids,
    }
    async with edit_lock(project_id):
        return await call_backend("POST", f"/api/v1/features/{feature_id}/split", json=body)


@features_mcp.tool()
async def cancel_continuation(
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Continuation feature system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
) -> dict:
    """
    Undo a feature split by reabsorbing a continuation back into its origin.

    Use this to reverse a previous split_feature. The continuation's PBIs are moved
    back under the origin feature (landing wherever the origin currently is — its
    PI/swimline unsprinted, or the backlog if the origin was moved there), and the
    now-empty continuation feature is deleted.

    Only a "leaf" continuation can be cancelled — one that has not itself been split
    further. If this continuation has its own downstream continuations, cancel those
    first (HAS_CONTINUATIONS). The feature must be a continuation (NOT_A_CONTINUATION
    otherwise).
    Acquires the edit lock for the duration of the operation.
    Returns the FeatureResponse of the origin feature.
    """
    async with edit_lock(project_id):
        return await call_backend("POST", f"/api/v1/features/{feature_id}/cancel-continuation")


@features_mcp.tool()
async def delete_feature(
    feature_id: Annotated[str, Field(pattern=_UUID_RE, description="Feature system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
) -> dict:
    """
    Permanently delete a feature and all its PBIs and groups.

    This operation is irreversible. All PBIs under this feature are also deleted.
    Acquires the edit lock for the duration of the operation.
    Returns {} on success.
    """
    async with edit_lock(project_id):
        return await call_backend("DELETE", f"/api/v1/features/{feature_id}")


@features_mcp.tool()
async def create_pbi(
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID)")],
    feature_id: Annotated[str, Field(description="Parent feature system_id (UUID)")],
    title: Annotated[str, Field(max_length=255, description="PBI title (max 255 chars)")],
    ctx: Context,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="Optional description (max 2000 chars)"),
    ] = None,
    effort: Annotated[
        float | None,
        Field(default=None, description="Effort estimate. Must be one of: 0, 0.5, 1, 2, 3, 5, 8, 13, 21."),
    ] = None,
    user_id: Annotated[
        int | None,
        Field(default=None, ge=1, le=999999,
              description="Optional business ID (1–999999, unique per project)"),
    ] = None,
    item_type: Annotated[
        Literal["story", "bug"],
        Field(default="story", description="PBI type: 'story' (default) or 'bug'"),
    ] = "story",
    state: Annotated[
        str | None,
        Field(default=None, max_length=100,
              description="Optional State name. Stories and bugs have separate State Lists; the "
                          "name must already exist in the one matching item_type (see list_states)."),
    ] = None,
) -> dict:
    """
    Create a new PBI (user story or bug) under a feature.

    PBIs are the individual work items that get estimated, prioritised, and assigned to sprints.
    The parent feature must exist in the same project.
    After creating PBIs, use place_pbi_in_sprint to assign them to a sprint
    (the feature must be in a PI swimline first).
    Returns a PBIResponse including system_id needed for subsequent calls.
    """
    body: dict = {
        "title": title,
        "parent_feature_system_id": feature_id,
        "item_type": item_type,
    }
    if description is not None:
        body["description"] = description
    if effort is not None:
        body["effort"] = effort
    if user_id is not None:
        body["id"] = user_id
    if state is not None:
        state_id = await resolve_state_id(project_id, state_item_type_for_pbi(item_type), state)
        if state_id is not None:
            body["state_id"] = state_id

    async with edit_lock(project_id):
        return await call_backend("POST", f"/api/v1/projects/{project_id}/pbis", json=body)


@features_mcp.tool()
async def update_pbi(
    pbi_id: Annotated[str, Field(pattern=_UUID_RE, description="PBI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
    title: Annotated[
        str | None,
        Field(default=None, max_length=255, description="New title (max 255 chars)"),
    ] = None,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="New description (max 2000 chars). Pass null to clear."),
    ] = _UNSET,
    effort: Annotated[
        float | None,
        Field(default=None, description="New effort estimate. Must be one of: 0, 0.5, 1, 2, 3, 5, 8, 13, 21. Pass null to clear."),
    ] = _UNSET,
    user_id: Annotated[
        int | None,
        Field(default=None, ge=1, le=999999, description="New business ID (1–999999). Pass null to clear."),
    ] = _UNSET,
    item_type: Annotated[
        Literal["story", "bug"] | None,
        Field(default=None, description="New type: 'story' or 'bug'"),
    ] = None,
    state: Annotated[
        str | None,
        Field(default=None, max_length=100,
              description="New State name, from the list matching the PBI's type (see list_states). "
                          "Unknown names are rejected. Pass null to clear. Note: changing item_type "
                          "without also passing a state clears the State, since the lists differ."),
    ] = _UNSET,
) -> dict:
    """
    Update a PBI's metadata: title, description, effort, business ID, or type.

    Supply only the fields you want to change — unset fields are left as-is.
    Pass null explicitly for description, effort, or user_id to clear those fields.
    To move a PBI to a sprint use place_pbi_in_sprint instead.
    Acquires the edit lock for the duration of the update.
    Returns the updated PBIResponse.
    """
    body: dict = {}
    if title is not None:
        body["title"] = title
    if description is not _UNSET:
        body["description"] = description  # None sends null → clears the field
    if effort is not _UNSET:
        body["effort"] = effort  # None sends null → clears the field
    if user_id is not _UNSET:
        body["id"] = user_id  # None sends null → clears the field
    if item_type is not None:
        body["item_type"] = item_type
    if state is not _UNSET:
        # Which list applies depends on the type the PBI will have after this update.
        effective_type = item_type
        if effective_type is None:
            current = await call_backend("GET", f"/api/v1/pbis/{pbi_id}")
            effective_type = current.get("item_type", "story")
        body["state_id"] = await resolve_state_id(
            project_id, state_item_type_for_pbi(effective_type), state or ""
        )

    async with edit_lock(project_id):
        return await call_backend("PATCH", f"/api/v1/pbis/{pbi_id}", json=body)


@features_mcp.tool()
async def place_pbi_in_sprint(
    pbi_id: Annotated[str, Field(pattern=_UUID_RE, description="PBI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    sprint_index: Annotated[
        int,
        Field(ge=0, le=4, description="Sprint index (0–4) within the PI to assign this PBI to"),
    ],
    ctx: Context,
) -> dict:
    """
    Assign a PBI to a sprint within the PI board.

    Prerequisites:
    - The PBI's parent feature must be in a PI swimline (location='pi')
    - The PBI must not already be in a group (remove_pbi_from_sprint first if needed)
    Creates an implicit group for the PBI in the swimline at the given sprint.
    Acquires the edit lock for the duration of the operation.
    Returns PlaceStoryResponse: {story: PBIResponse, group: GroupResponse}.
    """
    async with edit_lock(project_id):
        return await call_backend(
            "POST", f"/api/v1/pbis/{pbi_id}/place", json={"sprint_index": sprint_index}
        )


@features_mcp.tool()
async def remove_pbi_from_sprint(
    pbi_id: Annotated[str, Field(pattern=_UUID_RE, description="PBI system_id (UUID)")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — needed to acquire the edit lock")],
    ctx: Context,
) -> dict:
    """
    Remove a PBI from its current sprint assignment.

    Clears the PBI's group assignment. If the group was implicit (auto-created by
    place_pbi_in_sprint), it is also deleted. Explicit groups are not affected.
    The PBI remains under its feature — only the sprint assignment is removed.
    Acquires the edit lock for the duration of the operation.
    Returns {} on success.
    """
    async with edit_lock(project_id):
        return await call_backend("DELETE", f"/api/v1/pbis/{pbi_id}/place")
