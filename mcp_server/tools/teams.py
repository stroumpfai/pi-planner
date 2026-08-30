"""Team write tools (spec/teams.md §8.2).

Three things here deliberately break the pattern every other write module in this
package follows. Each looks like an omission unless you read the spec.

**1. No `edit_lock()` wrapper.** Every other write tool wraps its call in
`async with edit_lock(project_id)`. Team writes take no lock: they live at
`/api/v1/teams/…`, carry no `project_id`, and are outside the single-writer lock
*by construction* (§4.1) — `require_edit_lock` on the backend resolves nothing for
these paths. The context manager is not merely unnecessary here, it is unusable:
there is no project to lock. Concurrency is `If-Match`, per row (§4.2), handled
below.

**2. No `delete_team`.** Deletions in this app are permanent, and what an agent may
delete is drawn where the codebase already draws it: leaf records yes, top-level
containers no. There is no `delete_project` and no `delete_pi` either, though both
exist over REST. Deleting a team destroys every member, pattern version, absence
and meeting behind it — that stays a human act through the UI (§8.2.6). Nor does
`update_team` take a `delete` flag; the door is closed, not moved.

**3. Teams are addressed by `system_id`, not by name.** `states.py` resolves State
*names* because an agent knows a State as "In Progress" and the id is an
implementation detail of a list nested inside a project it already identified. A
team is the top-level container itself: `list_teams` is the single call that
discovers them, exactly as `list_projects` discovers projects, and `get_project` /
`update_project` take an id. WP-3F introduces `resolve_member_id(team_id, name)`
for members — records *inside* a team — which is the right level for name
resolution. If this is ever revisited, an unknown team name must be rejected with
the list of teams that exist, never created implicitly (the ADR-0003 rule).
"""

from typing import Annotated

from fastmcp import Context, FastMCP
from pydantic import Field

from mcp_server.backend import MCPBackendError, call_backend, call_backend_raw

teams_mcp = FastMCP("teams")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


async def read_team_with_etag(team_id: str) -> tuple[dict, str]:
    """Read a team and return it with the `ETag` the backend stamped on the read.

    The tag is taken from the **response header**, never rebuilt from
    `modified_at`: the backend's format (`etag_for` in
    `app/services/concurrency.py`) is its business, and a client that reconstructs
    it silently starts failing the day that format changes.

    `call_backend` discards headers, so this uses `call_backend_raw` — which
    applies the same auth headers and the same error classification.
    """
    response = await call_backend_raw("GET", f"/api/v1/teams/{team_id}")
    etag = response.headers.get("ETag", "")
    if not etag:
        raise MCPBackendError(
            428,
            "IF_MATCH_REQUIRED",
            f"Team {team_id} was read without an ETag, so this write cannot be made "
            "safely. Try again shortly.",
        )
    return response.json(), etag


@teams_mcp.tool()
async def create_team(
    name: Annotated[str, Field(max_length=100, description="Team name (max 100 chars, unique)")],
    ctx: Context,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="What this team is for (max 2000 chars)"),
    ] = None,
    normal_day_hours: Annotated[
        float | None,
        Field(
            default=None,
            ge=1.0,
            le=24.0,
            description=(
                "Hours in a normal working day for this team — the divisor turning hours "
                "into person-days. Defaults to 8.0; set 7.5 for a 37.5 h week."
            ),
        ),
    ] = None,
) -> dict:
    """
    Create a team.

    A team is the container for members, working-day patterns, absences and
    meetings — the inputs sprint capacity is computed from. It carries no
    project_id: teams are shared across projects, and a project is assigned to a
    team separately.
    Names are unique across the instance; a duplicate is refused with
    TEAM_NAME_TAKEN rather than returning the existing team. An instance holds at
    most 50 teams (TEAM_LIMIT_REACHED). Call list_teams first to see what exists.
    Takes no edit lock — team writes are outside the single-writer lock.
    There is no delete_team: removing a team is a human act in the web UI.
    Returns the new TeamResponse including system_id.
    """
    body: dict = {"name": name}
    if description is not None:
        body["description"] = description
    if normal_day_hours is not None:
        body["normal_day_hours"] = normal_day_hours
    # No If-Match on a create — a create cannot clobber (§4.2).
    return await call_backend("POST", "/api/v1/teams", json=body)


@teams_mcp.tool()
async def update_team(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    ctx: Context,
    name: Annotated[
        str | None,
        Field(default=None, max_length=100, description="New team name (max 100 chars, unique)"),
    ] = None,
    description: Annotated[
        str | None,
        Field(default=None, max_length=2000, description="New description (max 2000 chars)"),
    ] = None,
    normal_day_hours: Annotated[
        float | None,
        Field(
            default=None,
            ge=1.0,
            le=24.0,
            description="New hours-per-normal-day divisor (1.0–24.0)",
        ),
    ] = None,
) -> dict:
    """
    Update a team's name, description and/or hours-per-normal-day.

    Only supply the fields you want to change — unset fields are left as-is.

    **How this handles concurrency.** The backend refuses a team PATCH that does
    not quote the row's current ETag in If-Match, and you have no way to carry an
    ETag between tool calls — so this tool reads the team and writes it inside one
    call, using the ETag from that read. The window is narrow rather than absent:
    a change a human makes in the milliseconds between this tool's own read and
    its write will be overwritten. That is the honest trade for a usable tool, and
    it is far better than the alternative it replaces — every write blindly
    clobbering whatever it never read.
    A STALE failure is retried once from a fresh read; a second one is returned to
    you rather than looped, and means someone is editing this team right now.
    Re-read it with get_team, see what changed, and reapply your change if it
    still makes sense.

    Renaming onto a name another team already holds is refused with
    TEAM_NAME_TAKEN. Changing normal_day_hours re-scales every person-day figure
    this team produces; it does not change anyone's hours.
    Takes no edit lock — team writes are outside the single-writer lock.
    Returns the updated TeamResponse.
    """
    body: dict = {}
    if name is not None:
        body["name"] = name
    if description is not None:
        body["description"] = description
    if normal_day_hours is not None:
        body["normal_day_hours"] = normal_day_hours

    async def attempt() -> dict:
        _team, etag = await read_team_with_etag(team_id)
        return await call_backend(
            "PATCH",
            f"/api/v1/teams/{team_id}",
            json=body,
            headers={"If-Match": etag},
        )

    try:
        return await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        # Someone wrote the row between our read and our write. Re-read once and
        # reapply; a second STALE is handed to the agent rather than looped —
        # at that point a human is actively editing and should be left alone.
        return await attempt()
