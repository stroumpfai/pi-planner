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


# ── Members ───────────────────────────────────────────────────────────────────
#
# Members are addressed **by name**, unlike the team itself: an agent knows a
# person as "Marta", and the id is an implementation detail of a list nested
# inside a team it has already identified. This follows the `resolve_state_id`
# precedent in `states.py`, including its rule — an unrecognised name is
# **rejected with the list of members who do exist**, never created implicitly.
# Creating a person is at least as deliberate an act as creating State
# vocabulary (ADR-0003), which is why `create_member` is its own tool and why
# there is no `delete_member` (§8.2.4, §8.2.6).

#: The 14 half-day slots, in week order. Agents may name a whole day ("mon") or
#: one half of it ("mon_am").
_HALF_DAYS: tuple[str, ...] = tuple(
    f"{day}_{half}"
    for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    for half in ("am", "pm")
)
_DAYS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _half_days_from(working_days: list[str]) -> dict[str, bool]:
    """Turn ``["mon", "tue_am"]`` into the 14 booleans the API stores.

    Anything not named is off. A whole-day token switches both halves on, which
    is what makes the common contract one short list rather than ten flags.
    """
    slots = {slot: False for slot in _HALF_DAYS}
    for raw in working_days:
        token = raw.strip().lower().replace("-", "_")
        if token in slots:
            slots[token] = True
        elif token in _DAYS:
            slots[f"{token}_am"] = True
            slots[f"{token}_pm"] = True
        else:
            raise ValueError(
                f"{raw!r} is not a working-day slot. Use a day (mon, tue, … sun) for "
                "the whole day, or a half-day (mon_am, fri_pm)."
            )
    return slots


async def _members_of(team_id: str, as_of: str | None = None) -> list[dict]:
    params = {"as_of": as_of} if as_of else None
    response = await call_backend("GET", f"/api/v1/teams/{team_id}/members", params=params)
    members: list[dict] = response.get("items", [])
    return members


async def _find_member(team_id: str, name: str, as_of: str | None = None) -> dict:
    """The member row for *name*, or a ValueError naming everyone who does exist."""
    members = await _members_of(team_id, as_of)
    wanted = name.strip().lower()
    for member in members:
        if str(member["name"]).strip().lower() == wanted:
            return member

    existing = ", ".join(repr(m["name"]) for m in members) or "(this team has no members)"
    raise ValueError(
        f"No member named {name!r} on this team. Members: {existing}. "
        "To add them, call create_member deliberately — no other tool creates a person."
    )


async def resolve_members(
    team_id: str, member_names: list[str], all_members: bool
) -> list[str]:
    """The ids an absence or a meeting applies to (§8.2.4).

    ``all_members`` is an explicit flag rather than a magic name because "add
    Christmas for everyone" and "everyone attends the stand-up" are one call each,
    and because a list the agent assembled from an earlier ``list_members`` goes
    stale the moment somebody joins. It **wins over** ``member_names``: an agent
    that says both means everyone, and silently intersecting the two would be a
    rule nobody could predict.

    Named members are resolved one by one, so an unknown name raises with the list
    of members who do exist — never created implicitly.
    """
    if all_members:
        return [str(member["system_id"]) for member in await _members_of(team_id)]
    return [await resolve_member_id(team_id, name) for name in member_names]


async def resolve_member_id(team_id: str, name: str) -> str:
    """Map a member's name to their system_id within one team.

    Raises ValueError when the name is not on the team, listing who is. Mirrors
    `resolve_state_id`: an unknown name is far more likely a typo than an intent
    to hire (§8.2.4).
    """
    return str((await _find_member(team_id, name))["system_id"])


@teams_mcp.tool()
async def create_member(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    name: Annotated[str, Field(max_length=100, description="The person's name (unique per team)")],
    ctx: Context,
    role: Annotated[
        str | None,
        Field(default=None, max_length=50, description="Free text, e.g. Dev, Test, PO, SW-Arch — descriptive only"),
    ] = None,
    organisation: Annotated[
        str | None,
        Field(default=None, max_length=50, description="Free text, e.g. the department they come from"),
    ] = None,
    active_from: Annotated[
        str | None,
        Field(default=None, description="First day on the team (YYYY-MM-DD). Blank means always."),
    ] = None,
    active_to: Annotated[
        str | None,
        Field(default=None, description="Last day on the team (YYYY-MM-DD). Blank means open-ended."),
    ] = None,
    working_days: Annotated[
        list[str] | None,
        Field(
            default=None,
            description=(
                "Half-days this person is contracted for: whole days ('mon') or halves "
                "('fri_am'). Anything unnamed is off. Defaults to Mon–Fri, both halves."
            ),
        ),
    ] = None,
    hours_per_day: Annotated[
        float | None,
        Field(default=None, ge=1.0, le=12.0, description="Hours in one full contracted day (default 8.0)"),
    ] = None,
    focus: Annotated[
        float | None,
        Field(
            default=None,
            ge=0.1,
            le=1.0,
            description="Share of contracted time available for planned work, in steps of 0.05 (default 1.0)",
        ),
    ] = None,
    effective_from: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Date this first working pattern starts applying (YYYY-MM-DD). "
                "Defaults to active_from, or today."
            ),
        ),
    ] = None,
    note: Annotated[
        str | None,
        Field(default=None, max_length=100, description="Note on this pattern version, e.g. '80% from July'"),
    ] = None,
) -> dict:
    """
    Add a person to a team, with their first working pattern.

    The two are created together and cannot be separated: a member with no
    pattern has no contracted half-days, which computes as zero capacity and
    reads as a team that does no work rather than as data nobody entered.

    role and organisation are free text — there is no roles list, nothing to
    administer, and no value is rejected. Neither is read by the capacity maths.
    active_from / active_to bound the membership: half-days outside that window
    contribute nothing, which is how a joiner or a leaver is recorded without
    destroying the history a delete would take with it.
    Names are unique per team, case-insensitively (MEMBER_NAME_TAKEN); a team
    holds at most 50 members (MEMBER_LIMIT_REACHED). Call list_members first.
    Takes no edit lock — team writes are outside the single-writer lock.
    There is no delete_member: removing a person is a human act in the web UI.
    Returns the new member including their effective_version.
    """
    pattern: dict = {}
    if working_days is not None:
        pattern.update(_half_days_from(working_days))
    if hours_per_day is not None:
        pattern["hours_per_day"] = hours_per_day
    if focus is not None:
        pattern["focus"] = focus
    if note is not None:
        pattern["note"] = note
    if effective_from is not None:
        pattern["effective_from"] = effective_from

    body: dict = {"name": name, "pattern": pattern}
    for field, value in (
        ("role", role),
        ("organisation", organisation),
        ("active_from", active_from),
        ("active_to", active_to),
    ):
        if value is not None:
            body[field] = value

    return await call_backend("POST", f"/api/v1/teams/{team_id}/members", json=body)


@teams_mcp.tool()
async def update_member(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    member_name: Annotated[str, Field(description="The member's current name — from list_members")],
    ctx: Context,
    new_name: Annotated[
        str | None, Field(default=None, max_length=100, description="Rename this member")
    ] = None,
    role: Annotated[str | None, Field(default=None, max_length=50, description="New role (free text)")] = None,
    organisation: Annotated[
        str | None, Field(default=None, max_length=50, description="New organisation (free text)")
    ] = None,
    active_from: Annotated[
        str | None, Field(default=None, description="New first day on the team (YYYY-MM-DD)")
    ] = None,
    active_to: Annotated[
        str | None,
        Field(
            default=None,
            description="New last day on the team (YYYY-MM-DD) — the non-destructive way to record a leaver",
        ),
    ] = None,
) -> dict:
    """
    Update a member's identity or their membership window.

    **Hours and focus are deliberately not here.** They are contract terms living
    on a dated version, so changing them means dating a new one with
    add_pattern_version, not overwriting a field — otherwise a change today would
    silently restate every sprint already planned.
    Only supply what you want to change; unset fields are left as they are.

    Setting active_to is how a leaver is recorded: their absences, attendance and
    pattern history survive, and half-days after that date simply stop counting.
    Deleting the person would take all of it, and is not available here.

    Concurrency works as it does in update_team: this reads the member and writes
    inside one call, quoting the ETag from that read. A STALE failure is retried
    once from a fresh read; a second means a human is editing this member right
    now — re-read with list_members and reapply if it still makes sense.
    Takes no edit lock — team writes are outside the single-writer lock.
    Returns the updated member.
    """
    body: dict = {}
    if new_name is not None:
        body["name"] = new_name
    for field, value in (
        ("role", role),
        ("organisation", organisation),
        ("active_from", active_from),
        ("active_to", active_to),
    ):
        if value is not None:
            body[field] = value

    async def attempt() -> dict:
        member = await _find_member(team_id, member_name)
        return await call_backend(
            "PATCH",
            f"/api/v1/teams/{team_id}/members/{member['system_id']}",
            json=body,
            headers={"If-Match": member["etag"]},
        )

    try:
        return await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        return await attempt()


@teams_mcp.tool()
async def add_pattern_version(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    member_name: Annotated[str, Field(description="The member's name — from list_members")],
    effective_from: Annotated[
        str, Field(description="Date the new contract starts applying (YYYY-MM-DD)")
    ],
    ctx: Context,
    working_days: Annotated[
        list[str] | None,
        Field(
            default=None,
            description=(
                "Half-days contracted from that date: whole days ('mon') or halves "
                "('fri_am'). Anything unnamed is off. Omit to keep the current days."
            ),
        ),
    ] = None,
    hours_per_day: Annotated[
        float | None,
        Field(default=None, ge=1.0, le=12.0, description="Hours in one full contracted day. Omit to keep."),
    ] = None,
    focus: Annotated[
        float | None,
        Field(
            default=None,
            ge=0.1,
            le=1.0,
            description="Share available for planned work, in steps of 0.05. Omit to keep.",
        ),
    ] = None,
    note: Annotated[
        str | None,
        Field(default=None, max_length=100, description="Why the contract changed, e.g. '80% from September'"),
    ] = None,
) -> dict:
    """
    Date a change to a member's working pattern.

    This is how hours, focus and working days change: a contract change has a
    date, so it becomes a new version rather than an edit of the old one. Figures
    before that date do not move — which is the whole reason patterns are
    versioned.

    A version holds from its effective_from until the day before the next one,
    and the latest holds indefinitely. There is no end date to supply, and no way
    to leave a gap. Posting a version onto a date that already has one **edits
    that version**.

    Fields you omit are carried over from the pattern in force on effective_from,
    so "drop to 6 hours from 1 September" is one argument and changes nothing
    else. A member holds at most 50 versions.

    Back-dating into a closed PI is allowed but does **not** recompute those
    sprints, and nothing warns you here — check what you are moving first.
    Takes no edit lock — team writes are outside the single-writer lock.
    Returns the new (or edited) pattern version.
    """
    member = await _find_member(team_id, member_name, as_of=effective_from)
    current = member.get("effective_version") or {}

    body: dict = {"effective_from": effective_from}
    if working_days is not None:
        body.update(_half_days_from(working_days))
    else:
        body.update({slot: bool(current.get(slot, False)) for slot in _HALF_DAYS})
    body["hours_per_day"] = hours_per_day if hours_per_day is not None else current.get("hours_per_day", 8.0)
    body["focus"] = focus if focus is not None else current.get("focus", 1.0)
    if note is not None:
        body["note"] = note

    return await call_backend(
        "POST",
        f"/api/v1/teams/{team_id}/members/{member['system_id']}/working-days",
        json=body,
    )


# ── Project assignment ────────────────────────────────────────────────────────
#
# Assigning is a team write, not a project write: it takes no edit lock and
# changes no sprint. The number reaches a project only through an explicit push
# (§6.7), which is the one team tool that *does* take the lock — and it arrives
# with step 7.


async def _assignment_of(team_id: str, project_id: str) -> dict:
    """This team's assignment for one project, with the ETag a PATCH must quote."""
    response = await call_backend("GET", f"/api/v1/teams/{team_id}/projects")
    assignments: list[dict] = response.get("items", [])
    for assignment in assignments:
        if assignment["project_id"] == project_id:
            return assignment

    served = ", ".join(repr(a["project_name"]) for a in assignments) or "(none)"
    raise ValueError(
        f"This team does not serve project {project_id}. It serves: {served}. "
        "Assign it with assign_project first."
    )


@teams_mcp.tool()
async def assign_project(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) — from list_projects")],
    ctx: Context,
    share_pct: Annotated[
        int | None,
        Field(
            default=None,
            ge=1,
            le=100,
            description="Percentage of this team's capacity this project gets (default 100)",
        ),
    ] = None,
    available_source: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "'manual' (default — Available stays typed by hand, team capacity is "
                "shown beside it) or 'factor' (Available is derived from team PD)"
            ),
        ),
    ] = None,
    units_per_pd: Annotated[
        float | None,
        Field(
            default=None,
            gt=0,
            description=(
                "How many of the project's effort units one person-day buys. Only used "
                "with available_source='factor'. 1.0 for a project measured in days."
            ),
        ),
    ] = None,
) -> dict:
    """
    Assign a team to a project.

    A project is served by **at most one team**; assigning one that another team
    already serves is refused with PROJECT_ALREADY_ASSIGNED naming the holder.
    A team serves at most 20 projects.

    **The first project assigned is the anchor**: its sprint calendar is the one
    every capacity figure for this team is counted in. Assign the project whose
    PI dates the team actually plans against first.

    Shares are per project and may sum past 100% across a team — that is an
    over-allocation warning in the UI, never a refusal, because teams really are
    overcommitted and the tool exists to show it.

    available_source defaults to 'manual', which changes nothing about the
    project: Available stays whatever a human typed. 'factor' makes it derivable,
    but still writes nothing until someone pushes.
    Takes no edit lock, and writes no sprint.
    Returns the new assignment.
    """
    body: dict = {"project_id": project_id}
    if share_pct is not None:
        body["share_pct"] = share_pct
    if available_source is not None:
        body["available_source"] = available_source
    if units_per_pd is not None:
        body["units_per_pd"] = units_per_pd
    return await call_backend("POST", f"/api/v1/teams/{team_id}/projects", json=body)


@teams_mcp.tool()
async def update_assignment(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    project_id: Annotated[str, Field(pattern=_UUID_RE, description="Project system_id (UUID) this team serves")],
    ctx: Context,
    share_pct: Annotated[
        int | None, Field(default=None, ge=1, le=100, description="New share of the team's capacity")
    ] = None,
    available_source: Annotated[
        str | None, Field(default=None, description="'manual' or 'factor'")
    ] = None,
    units_per_pd: Annotated[
        float | None,
        Field(default=None, gt=0, description="New effort units per person-day (factor projects)"),
    ] = None,
) -> dict:
    """
    Change a project's share, conversion factor, or how its Available is produced.

    Only supply what you want to change. Switching to 'factor' makes Available
    derivable from the team; it does not write it — a push does, and the preview
    (preview_team_capacity) is where a wrong units_per_pd shows up as visibly
    wrong integers before anything is stored.
    Switching back to 'manual' leaves every sprint exactly as it stands.

    Concurrency works as in update_team: the assignment is read and written inside
    one call, quoting the ETag from that read, and a STALE failure is retried once
    from a fresh read.
    There is no unassign tool — removing a team from a project is a human act in
    the web UI, like every other container removal.
    Takes no edit lock, and writes no sprint.
    Returns the updated assignment.
    """
    body: dict = {}
    if share_pct is not None:
        body["share_pct"] = share_pct
    if available_source is not None:
        body["available_source"] = available_source
    if units_per_pd is not None:
        body["units_per_pd"] = units_per_pd

    async def attempt() -> dict:
        assignment = await _assignment_of(team_id, project_id)
        return await call_backend(
            "PATCH",
            f"/api/v1/teams/{team_id}/projects/{project_id}",
            json=body,
            headers={"If-Match": assignment["etag"]},
        )

    try:
        return await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        return await attempt()


# ── Absences ──────────────────────────────────────────────────────────────────
#
# These are the only destructive team tools (§8.2.6): an absence is a leaf
# record, and `delete_absence` follows the line this codebase already draws —
# leaves yes, containers no.
#
# They are also the **bulk data path**. The planning inputs live on a Confluence
# page read by a model, not in a CSV, so `bulk_create_absences` writes a whole
# window in one transaction and *replaces* within it rather than appending. That
# is the only rule that survives a re-read of the page after an entry was deleted
# from it — a merge would keep the deleted entry forever (§8.2.7).


def _schedule(
    kind: str,
    start_date: str,
    end_date: str | None,
    start_half: str | None,
    end_half: str | None,
    weekday: int | None,
    halves: list[str] | None,
    interval_weeks: int | None,
    label: str | None,
) -> dict:
    """The schedule rule as the API takes it, with nothing invented."""
    body: dict = {"kind": kind, "start_date": start_date}
    for name, value in (
        ("end_date", end_date),
        ("start_half", start_half),
        ("end_half", end_half),
        ("weekday", weekday),
        ("halves", halves),
        ("interval_weeks", interval_weeks),
        ("label", label),
    ):
        if value is not None:
            body[name] = value
    return body


_KIND = (
    "'range' (a block of consecutive days — a holiday, or a one-day public "
    "holiday), 'weekly' (the same slot every week) or 'interval' (the same slot "
    "every N weeks — a 90% contract's free Friday)"
)
_START_DATE = (
    "For 'range', the first day (YYYY-MM-DD). For 'weekly' and 'interval' this is "
    "the ANCHOR: the first occurrence is the first matching weekday on or after "
    "it, and later ones fall every interval from there. It decides which alternate "
    "weeks are hit, so check the summary in the result before trusting it."
)
_HALVES = "Which halves a recurring rule covers: ['am'], ['pm'] or ['am','pm']"


async def _absence_with_etag(team_id: str, absence_id: str) -> dict:
    absences: list[dict] = (
        await call_backend("GET", f"/api/v1/teams/{team_id}/absences")
    ).get("items", [])
    for row in absences:
        if row["system_id"] == absence_id:
            return row
    raise ValueError(
        f"No absence {absence_id} on this team. Call list_absences to see what exists."
    )


@teams_mcp.tool()
async def create_absence(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    kind: Annotated[str, Field(description=_KIND)],
    start_date: Annotated[str, Field(description=_START_DATE)],
    ctx: Context,
    member_names: Annotated[
        list[str],
        Field(
            max_length=50,
            description=(
                "The people this applies to, by name as list_members reports them. "
                "One record is created per person, each editable afterwards. Leave "
                "empty and set all_members instead for a public holiday."
            ),
        ),
    ] = [],
    all_members: Annotated[
        bool,
        Field(
            default=False,
            description=(
                "Apply to everyone currently on the team — the public-holiday flow. "
                "Overrides member_names, and stays right as the team changes, which a "
                "list copied from list_members does not."
            ),
        ),
    ] = False,
    end_date: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "For 'range', the last day, inclusive — omit for a one-day absence. "
                "For a recurring rule, when it stops; omit for open-ended."
            ),
        ),
    ] = None,
    start_half: Annotated[
        str | None,
        Field(default=None, description="'range' only: 'am' (default) or 'pm' — which half the block opens on"),
    ] = None,
    end_half: Annotated[
        str | None,
        Field(default=None, description="'range' only: 'pm' (default) or 'am' — which half it closes on"),
    ] = None,
    weekday: Annotated[
        int | None,
        Field(default=None, ge=0, le=6, description="Recurring only: 0 = Monday … 6 = Sunday"),
    ] = None,
    halves: Annotated[list[str] | None, Field(default=None, description=_HALVES)] = None,
    interval_weeks: Annotated[
        int | None,
        Field(
            default=None,
            ge=2,
            le=52,
            description="'interval' only: weeks between occurrences. Starts at 2 — every week is kind='weekly'.",
        ),
    ] = None,
    label: Annotated[
        str | None,
        Field(default=None, max_length=100, description="Free text for the human reading the row, e.g. 'Christmas'"),
    ] = None,
) -> dict:
    """
    Record when one or more members are not available.

    There is no absence category — an absence is an absence, and `label` is never
    interpreted by the capacity maths. Absences reduce contracted half-days before
    focus is applied; overlapping ones are counted **once**, never summed. An
    absence on a half-day the member does not work is allowed and simply has no
    effect, so entering an office shutdown for everyone produces no warnings for
    the part-timers.

    Naming several members creates **one record each**, independently editable
    afterwards — that is deliberate, so "everyone's Christmas" can be corrected
    for the one person on call without deleting and recreating the lot. Pass
    all_members=true for the whole team rather than listing everybody: it is the
    public-holiday flow, and it cannot go stale when somebody joins.
    Unknown names are rejected with the list of members who do exist; no tool
    creates a person implicitly (use create_member).

    A recurring entry has **no per-occurrence exceptions**: editing or deleting
    acts on the whole series. For one stray day, add a one-day 'range' alongside
    it; for a changed pattern, give the rule an end_date and start a new one.

    Takes no edit lock, and writes no sprint — capacity reaches a project only
    through a push.
    Returns every record created, each with a plain-language `summary` of the
    rule. Read that summary: an off-by-one week is invisible in the fields.
    """
    member_ids = await resolve_members(team_id, member_names, all_members)
    if not member_ids:
        raise ValueError(
            "An absence belongs to somebody: name them in member_names, or set "
            "all_members=true for a team-wide entry."
        )
    body = _schedule(
        kind, start_date, end_date, start_half, end_half, weekday, halves, interval_weeks, label
    )
    body["member_ids"] = member_ids
    return await call_backend("POST", f"/api/v1/teams/{team_id}/absences", json=body)


@teams_mcp.tool()
async def update_absence(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    absence_id: Annotated[str, Field(pattern=_UUID_RE, description="Absence system_id (UUID) — from list_absences")],
    ctx: Context,
    kind: Annotated[str | None, Field(default=None, description=_KIND)] = None,
    start_date: Annotated[str | None, Field(default=None, description=_START_DATE)] = None,
    end_date: Annotated[
        str | None, Field(default=None, description="New end date (inclusive), or when a recurrence stops")
    ] = None,
    start_half: Annotated[str | None, Field(default=None, description="'range' only: 'am' or 'pm'")] = None,
    end_half: Annotated[str | None, Field(default=None, description="'range' only: 'am' or 'pm'")] = None,
    weekday: Annotated[
        int | None, Field(default=None, ge=0, le=6, description="Recurring only: 0 = Monday … 6 = Sunday")
    ] = None,
    halves: Annotated[list[str] | None, Field(default=None, description=_HALVES)] = None,
    interval_weeks: Annotated[
        int | None, Field(default=None, ge=2, le=52, description="'interval' only: weeks between occurrences")
    ] = None,
    label: Annotated[str | None, Field(default=None, max_length=100, description="New label")] = None,
) -> dict:
    """
    Change an absence — **the whole series**, always.

    There is no "just this occurrence": recurring entries have no exception list,
    by design. To end a recurrence early, set end_date. To drop one stray day, you
    cannot — end the rule and start a new one, which is the truer record anyway.

    Only supply what you want to change; the patch is merged onto the stored rule
    and the *result* must be coherent, so switching kind to 'weekly' without a
    weekday is refused with INVALID_SCHEDULE.
    The member cannot be changed here: moving an absence to someone else is a
    delete and a create.

    Concurrency works as in update_team — read, write quoting the ETag, one retry
    on STALE.
    Returns the updated absence with its new plain-language summary.
    """
    body: dict = {}
    for name, value in (
        ("kind", kind),
        ("start_date", start_date),
        ("end_date", end_date),
        ("start_half", start_half),
        ("end_half", end_half),
        ("weekday", weekday),
        ("halves", halves),
        ("interval_weeks", interval_weeks),
        ("label", label),
    ):
        if value is not None:
            body[name] = value

    async def attempt() -> dict:
        absence = await _absence_with_etag(team_id, absence_id)
        return await call_backend(
            "PATCH",
            f"/api/v1/teams/{team_id}/absences/{absence_id}",
            json=body,
            headers={"If-Match": absence["etag"]},
        )

    try:
        return await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        return await attempt()


@teams_mcp.tool()
async def delete_absence(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    absence_id: Annotated[str, Field(pattern=_UUID_RE, description="Absence system_id (UUID) — from list_absences")],
    ctx: Context,
) -> dict:
    """
    Delete an absence, and with it every occurrence of a recurring one.

    Permanent — this app has no trash. A recurring entry goes as a whole; there is
    no way to remove a single occurrence, because there are no per-occurrence
    exceptions in the model.

    This and delete_meeting are the only destructive team tools: teams, members,
    pattern versions and project assignments are removed by a human in the web UI.
    Capacity for the affected days goes back up immediately, but no sprint changes
    until someone pushes.
    Returns {"deleted": absence_id}.
    """

    async def attempt() -> None:
        absence = await _absence_with_etag(team_id, absence_id)
        await call_backend(
            "DELETE",
            f"/api/v1/teams/{team_id}/absences/{absence_id}",
            headers={"If-Match": absence["etag"]},
        )

    try:
        await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        await attempt()
    return {"deleted": absence_id}


def _bulk_body(
    window_from: str, window_to: str, entries: list[dict], dry_run: bool
) -> dict:
    return {
        "window_from": window_from,
        "window_to": window_to,
        "dry_run": dry_run,
        "entries": entries,
    }


_BULK_ENTRIES = (
    "One object per absence rule. Each takes member_names (a list of names as "
    "list_members reports them), kind, start_date, and whatever that kind needs: "
    "end_date, start_half/end_half for 'range'; weekday and halves for 'weekly'; "
    "plus interval_weeks for 'interval'. label is optional free text."
)


@teams_mcp.tool()
async def bulk_create_absences(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    window_from: Annotated[str, Field(description="First day of the window being replaced (YYYY-MM-DD)")],
    window_to: Annotated[str, Field(description="Last day of the window being replaced (YYYY-MM-DD)")],
    entries: Annotated[list[dict], Field(max_length=2000, description=_BULK_ENTRIES)],
    ctx: Context,
) -> dict:
    """
    Replace a team's absences inside a date window, in one transaction.

    This is the import path for the planning page: there is no CSV import for
    teams, because the source is a hand-maintained wiki table whose shape drifts —
    which a model reads well and a parser does not.

    **Replace, not append**: everything the team has anchored inside
    [window_from, window_to] is replaced by `entries`. Membership is decided by an
    absence's start_date, so a recurring rule anchored before the window survives
    even though it reaches into it — pick a window that matches the section of the
    page you read.
    Re-running the same import is therefore idempotent, and an entry deleted from
    the source page disappears here too — which a merge could never do.

    Every unresolved member name is reported **at once**, and nothing is written
    when there are any: spelling variants ("Anders Michel" / "Michel Anders")
    arrive in groups, and a batch that reports one per call is a batch nobody
    finishes. Members are never created implicitly — call create_member first,
    deliberately, and note that there is no way for you to undo that.

    Call preview_bulk_absences with the same arguments first. The review step is
    worth more here than anywhere else in this API: the input is free text a model
    interpreted, and a misread column is caught there rather than in a plan.
    Returns created/deleted counts and every record written.
    """
    return await call_backend(
        "POST",
        f"/api/v1/teams/{team_id}/absences/bulk",
        json=_bulk_body(window_from, window_to, entries, dry_run=False),
    )


@teams_mcp.tool()
async def preview_bulk_absences(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    window_from: Annotated[str, Field(description="First day of the window that would be replaced (YYYY-MM-DD)")],
    window_to: Annotated[str, Field(description="Last day of the window that would be replaced (YYYY-MM-DD)")],
    entries: Annotated[list[dict], Field(max_length=2000, description=_BULK_ENTRIES)],
    ctx: Context,
) -> dict:
    """
    Show what bulk_create_absences would do, without writing anything.

    Same arguments, same validation, no side effects: it reports how many records
    would be created, how many existing ones would be replaced, and — the reason
    to call it — **every member name it could not resolve**.

    Show the result to the human before applying. The input came from free text a
    model interpreted, and this is where a misread column or a name spelled two
    ways is caught, while it is still cheap.
    Returns the same shape as bulk_create_absences with dry_run: true and no
    records.
    """
    return await call_backend(
        "POST",
        f"/api/v1/teams/{team_id}/absences/bulk",
        json=_bulk_body(window_from, window_to, entries, dry_run=True),
    )


# ── Meetings ──────────────────────────────────────────────────────────────────
#
# A meeting carries the **same schedule rule as an absence** (§3.5) — one shape,
# one generator, one set of validation — plus the three things an absence has no
# use for: the half-day an occurrence starts in, how long it runs, and who
# attends.
#
# Two differences to hold on to when reading these tools beside the absence ones:
#
# 1. **One row, many attendees.** `create_absence` fans a rule out into one record
#    per person; `create_meeting` writes a single row with an attendee set, because
#    a meeting is a shared event and what changes week to week is who is in it.
#    `update_meeting` therefore edits attendance too.
# 2. **A recurring meeting is one row, not one per occurrence.** A daily stand-up
#    over a year is five weekly rules, which is why §9 caps meeting *definitions*
#    at 100 against 2000 absences.
#
# `delete_meeting` joins `delete_absence` as the only destructive team tools: a
# meeting is a leaf record, recreated in one call if removed by mistake (§8.2.6).


_MEETING_KIND = (
    "'range' (a block of consecutive days — a one-off is a one-day range, and each "
    "day of a longer block costs the full duration), 'weekly' (the same slot every "
    "week — a stand-up) or 'interval' (every N weeks — a fortnightly retro)"
)
_HALF = (
    "The half-day an occurrence STARTS in: 'am' or 'pm'. A meeting is not confined "
    "there — anything longer spills into the rest of the same day — but placement is "
    "what lets it be cancelled against an absence: a meeting starting on a morning "
    "the member is away costs nothing."
)
_DURATION = (
    "How long one occurrence runs, in minutes: 5–480, in steps of 5. Independent of "
    "the attendee's contracted day — an 8 h workshop is fine for a 6 h/day member and "
    "costs their whole day, never more."
)
_ATTENDEES = (
    "Who attends, by name as list_members reports them. May be empty — a meeting "
    "nobody attends is allowed and costs nothing, so the schedule can be entered "
    "first and attendance ticked afterwards."
)
_ALL_MEMBERS = (
    "Everyone currently on the team attends — 'the whole team is in the stand-up' "
    "without listing them. Overrides member_names."
)


def _meeting_body(
    title: str | None,
    kind: str | None,
    start_date: str | None,
    end_date: str | None,
    weekday: int | None,
    interval_weeks: int | None,
    half: str | None,
    duration_minutes: int | None,
) -> dict:
    """The meeting fields as the API takes them, with nothing invented."""
    body: dict = {}
    for name, value in (
        ("title", title),
        ("kind", kind),
        ("start_date", start_date),
        ("end_date", end_date),
        ("weekday", weekday),
        ("interval_weeks", interval_weeks),
        ("half", half),
        ("duration_minutes", duration_minutes),
    ):
        if value is not None:
            body[name] = value
    return body


async def _meeting_with_etag(team_id: str, meeting_id: str) -> dict:
    meetings: list[dict] = (
        await call_backend("GET", f"/api/v1/teams/{team_id}/meetings")
    ).get("items", [])
    for row in meetings:
        if row["system_id"] == meeting_id:
            return row
    raise ValueError(
        f"No meeting {meeting_id} on this team. Call list_meetings to see what exists."
    )


@teams_mcp.tool()
async def create_meeting(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    title: Annotated[str, Field(max_length=100, description="What the meeting is called")],
    kind: Annotated[str, Field(description=_MEETING_KIND)],
    start_date: Annotated[str, Field(description=_START_DATE)],
    duration_minutes: Annotated[int, Field(ge=5, le=480, description=_DURATION)],
    ctx: Context,
    end_date: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "For 'range', the last day, inclusive — omit for a one-off. For a "
                "recurring rule, when it stops; omit for open-ended."
            ),
        ),
    ] = None,
    weekday: Annotated[
        int | None,
        Field(default=None, ge=0, le=6, description="Recurring only: 0 = Monday … 6 = Sunday"),
    ] = None,
    interval_weeks: Annotated[
        int | None,
        Field(
            default=None,
            ge=2,
            le=52,
            description="'interval' only: weeks between occurrences. Starts at 2 — every week is kind='weekly'.",
        ),
    ] = None,
    half: Annotated[str, Field(default="am", description=_HALF)] = "am",
    member_names: Annotated[list[str], Field(max_length=50, description=_ATTENDEES)] = [],
    all_members: Annotated[bool, Field(default=False, description=_ALL_MEMBERS)] = False,
) -> dict:
    """
    Add a meeting: booked time that comes off capacity before focus is applied.

    A meeting is **one row with an attendee set**, not one row per person and not
    one row per occurrence — a daily stand-up over a year is one weekly rule per
    weekday. That is why a team holds at most 100 meetings and why the recurrence
    shape matters: use 'weekly' or 'interval' rather than creating occurrences.

    What an occurrence costs is not simply its length. It consumes hours from the
    half-day it starts in, spills into the other half of the same day, and stops
    at the hours that survived absences: an 8 h workshop for a 6 h/day member
    costs their whole day and no more, and a meeting starting on a half the member
    is absent costs nothing at all. Do not also raise focus to account for
    meetings, or the time is paid for twice.

    Unknown attendee names are rejected with the list of members who exist; no
    tool creates a person implicitly (use create_member).
    Takes no edit lock and writes no sprint — capacity reaches a project only
    through a push.
    Returns the meeting with a plain-language `summary` of its schedule. Read it:
    an off-by-one week is invisible in the fields and obvious in the sentence.
    """
    body = _meeting_body(
        title, kind, start_date, end_date, weekday, interval_weeks, half, duration_minutes
    )
    body["member_ids"] = await resolve_members(team_id, member_names, all_members)
    return await call_backend("POST", f"/api/v1/teams/{team_id}/meetings", json=body)


@teams_mcp.tool()
async def update_meeting(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    meeting_id: Annotated[str, Field(pattern=_UUID_RE, description="Meeting system_id (UUID) — from list_meetings")],
    ctx: Context,
    title: Annotated[str | None, Field(default=None, max_length=100, description="New title")] = None,
    kind: Annotated[str | None, Field(default=None, description=_MEETING_KIND)] = None,
    start_date: Annotated[str | None, Field(default=None, description=_START_DATE)] = None,
    end_date: Annotated[
        str | None, Field(default=None, description="New end date, or when a recurrence stops")
    ] = None,
    weekday: Annotated[
        int | None, Field(default=None, ge=0, le=6, description="Recurring only: 0 = Monday … 6 = Sunday")
    ] = None,
    interval_weeks: Annotated[
        int | None, Field(default=None, ge=2, le=52, description="'interval' only: weeks between occurrences")
    ] = None,
    half: Annotated[str | None, Field(default=None, description=_HALF)] = None,
    duration_minutes: Annotated[int | None, Field(default=None, ge=5, le=480, description=_DURATION)] = None,
    member_names: Annotated[
        list[str] | None,
        Field(
            default=None,
            max_length=50,
            description=(
                "Replaces the attendee list when given; omit to leave attendance "
                "untouched. Send the whole set, not a difference."
            ),
        ),
    ] = None,
    all_members: Annotated[bool, Field(default=False, description=_ALL_MEMBERS)] = False,
) -> dict:
    """
    Change a meeting — **the whole series**, always — and optionally who attends.

    There is no "just this occurrence": recurring entries have no exception list,
    by design. To end a recurrence early, set end_date; to move it, change the
    rule and accept that every occurrence moves.

    Attendance is edited here rather than through a tool of its own, because it
    belongs to the meeting and shares its concurrency token. Omit both
    member_names and all_members to leave the attendee set alone; sending
    member_names **replaces** it, so include everyone who should still be in.

    Only supply what you want to change; the patch is merged onto the stored rule
    and the *result* must be coherent, so switching kind to 'weekly' without a
    weekday is refused with INVALID_SCHEDULE.
    Concurrency works as in update_team — read, write quoting the ETag, one retry
    on STALE.
    Returns the updated meeting with its new summary.
    """
    body = _meeting_body(
        title, kind, start_date, end_date, weekday, interval_weeks, half, duration_minutes
    )
    if all_members or member_names is not None:
        body["member_ids"] = await resolve_members(team_id, member_names or [], all_members)

    async def attempt() -> dict:
        meeting = await _meeting_with_etag(team_id, meeting_id)
        return await call_backend(
            "PATCH",
            f"/api/v1/teams/{team_id}/meetings/{meeting_id}",
            json=body,
            headers={"If-Match": meeting["etag"]},
        )

    try:
        return await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        return await attempt()


@teams_mcp.tool()
async def delete_meeting(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    meeting_id: Annotated[str, Field(pattern=_UUID_RE, description="Meeting system_id (UUID) — from list_meetings")],
    ctx: Context,
) -> dict:
    """
    Delete a meeting, its attendance, and every occurrence of a recurring one.

    Permanent — this app has no trash. A recurring meeting goes as a whole; there
    is no way to remove a single occurrence, because there are no per-occurrence
    exceptions in the model.

    This and delete_absence are the only destructive team tools: teams, members,
    pattern versions and project assignments are removed by a human in the web UI.
    Capacity for the affected days goes back up immediately, but no sprint changes
    until someone pushes.
    Returns {"deleted": meeting_id}.
    """

    async def attempt() -> None:
        meeting = await _meeting_with_etag(team_id, meeting_id)
        await call_backend(
            "DELETE",
            f"/api/v1/teams/{team_id}/meetings/{meeting_id}",
            headers={"If-Match": meeting["etag"]},
        )

    try:
        await attempt()
    except MCPBackendError as exc:
        if exc.code != "STALE":
            raise
        await attempt()
    return {"deleted": meeting_id}


_MEETING_ENTRIES = (
    "One object per meeting definition. Each takes title, kind, start_date, "
    "duration_minutes and half, plus whatever that kind needs: end_date for a "
    "'range'; weekday for 'weekly'; weekday and interval_weeks for 'interval'. "
    "Attendance is member_names (a list of names as list_members reports them) or "
    "all_members: true."
)


@teams_mcp.tool()
async def bulk_create_meetings(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    window_from: Annotated[str, Field(description="First day of the window being replaced (YYYY-MM-DD)")],
    window_to: Annotated[str, Field(description="Last day of the window being replaced (YYYY-MM-DD)")],
    entries: Annotated[list[dict], Field(max_length=100, description=_MEETING_ENTRIES)],
    ctx: Context,
    dry_run: Annotated[
        bool,
        Field(
            default=False,
            description=(
                "Report what would be created and replaced without writing anything. "
                "Worth a call first: the input is free text a model interpreted."
            ),
        ),
    ] = False,
) -> dict:
    """
    Replace a team's meetings anchored inside a date window, in one transaction.

    The import path for the meeting calendar, which lives on the same wiki page
    the absences do — there is no CSV import for teams.

    **Replace, not append**: every meeting the team has anchored inside
    [window_from, window_to] is replaced by `entries`, so re-running an unchanged
    import writes the same rows and a meeting deleted from the source disappears
    here too. Membership is decided by a meeting's start_date, so a stand-up
    anchored last year survives a window covering next month even though it occurs
    inside it — pick a window matching the section you read.

    Remember that recurrence collapses occurrences: a daily stand-up is five
    weekly entries, not one per day, and a team holds at most 100 definitions.
    Every unresolved attendee name is reported **at once**, and nothing is written
    when there are any. Members are never created implicitly.
    Returns created/deleted counts and every meeting written.
    """
    return await call_backend(
        "POST",
        f"/api/v1/teams/{team_id}/meetings/bulk",
        json={
            "window_from": window_from,
            "window_to": window_to,
            "dry_run": dry_run,
            "entries": entries,
        },
    )
