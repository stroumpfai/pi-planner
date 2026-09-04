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

    Returns each PI with total_effort and total_available summaries, state
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
    Get a single PI with effort and Available summary.

    Returns state, dates, total_effort (sum of all PBI efforts in this PI),
    and total_available (sum of sprint Available budgets).
    Use list_pis first to find the pi_id.
    """
    return await call_backend("GET", f"/api/v1/pis/{pi_id}")


@read_mcp.tool()
async def list_sprints(
    pi_id: Annotated[str, Field(description="PI system_id (UUID)")],
    ctx: Context,
) -> dict:
    """
    List all sprints in a PI with their effort totals and Available budget.

    Returns 5 sprints (sprint_index 0–4) each with available, current effort,
    and optional date range. Use this to understand utilisation before
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
    value stream. Returns system_id, name, order_index, effort, and available.
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
    column), from the States editor in the web UI, or with create_state. Returns
    system_id, item_type, value, and position for every entry, ordered by item type
    then position.
    Call this before setting `state` on create_feature, update_feature, create_pbi, or
    update_pbi — those tools reject names that are not already in the matching list —
    and before rename_state, reorder_states or delete_state, which take system_ids.
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


# --- Teams -----------------------------------------------------------------
# Teams are a top-level container like projects, so they are addressed by
# system_id, not by name: list_teams is the one call that discovers them, exactly
# as list_projects does. (Name resolution — resolve_state_id in states.py — is for
# records *inside* a container the agent has already identified.)


@read_mcp.tool()
async def list_teams(ctx: Context) -> dict:
    """
    List all teams.

    Call this first to discover teams and their system_id values, which every
    other team call needs. Returns each team with name, description,
    normal_day_hours (the divisor turning hours into person-days), member_count,
    project_ids (the projects this team serves) and timestamps.
    Teams are not planning items: there is no user-facing id beside system_id.
    """
    return await call_backend("GET", "/api/v1/teams")


@read_mcp.tool()
async def get_team(
    team_id: Annotated[str, Field(description="Team system_id (UUID) — from list_teams")],
    ctx: Context,
) -> dict:
    """
    Get a single team by ID.

    Returns name, description, normal_day_hours, member_count, project_ids and
    timestamps. Use list_teams first to find the team_id.
    """
    return await call_backend("GET", f"/api/v1/teams/{team_id}")


@read_mcp.tool()
async def list_members(
    team_id: Annotated[str, Field(description="Team system_id (UUID) — from list_teams")],
    ctx: Context,
    as_of: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Show each member's working pattern as it stands on this date "
                "(YYYY-MM-DD). Defaults to today."
            ),
        ),
    ] = None,
) -> dict:
    """
    List a team's members, with the working pattern in force on a given date.

    Members are the people capacity is computed from. Each carries name, role and
    organisation (free text, never computed on), active_from / active_to (their
    membership window — half-days outside it count for nothing), order_index, and:

    - effective_version: the working pattern in force on `as_of` — 14 half-day
      booleans (mon_am … sun_pm), hours_per_day, focus, and the effective_from
      date it started applying from.
    - version_dates: every date this member's contract changed on.
    - absence_count / meeting_count: what deleting them would take with them.

    A member always has at least one version, and the earliest extends backwards
    without limit, so every date resolves. Pass `as_of` to see a past or future
    contract — the same member reads differently before and after a change.
    Use the `name` values here for the member_name argument of the write tools.
    """
    params = {"as_of": as_of} if as_of else None
    return await call_backend("GET", f"/api/v1/teams/{team_id}/members", params=params)


@read_mcp.tool()
async def list_absences(
    team_id: Annotated[str, Field(description="Team system_id (UUID) — from list_teams")],
    ctx: Context,
    date_from: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Expand occurrences from this date (YYYY-MM-DD). Defaults to the start "
                "of the current month."
            ),
        ),
    ] = None,
    date_to: Annotated[
        str | None,
        Field(
            default=None,
            description="Expand occurrences up to this date (YYYY-MM-DD). Defaults to a year out.",
        ),
    ] = None,
    member_id: Annotated[
        str | None, Field(default=None, description="Only this member's absences")
    ] = None,
) -> dict:
    """
    List a team's absences, with the days each one actually covers.

    Every rule the team holds is returned; only the **occurrences** are windowed.
    A rule with no occurrence in the window still appears with an empty
    `occurrences` list — it exists, it is simply not in view.

    Each absence carries its schedule rule (kind, dates, weekday, halves,
    interval_weeks), a plain-language `summary` of it, the expanded occurrences
    inside the window, and the `etag` a write must quote.

    Absences reduce contracted half-days before focus. Overlaps count **once**,
    and an absence on a half-day the member does not work has no effect. There is
    no absence category, and `label` is never interpreted.
    Recurring entries have no per-occurrence exceptions: an occurrence you see
    here can only be removed by changing or deleting the whole series.
    """
    params = {}
    if date_from:
        params["from"] = date_from
    if date_to:
        params["to"] = date_to
    if member_id:
        params["member_id"] = member_id
    return await call_backend("GET", f"/api/v1/teams/{team_id}/absences", params=params or None)


@read_mcp.tool()
async def list_meetings(
    team_id: Annotated[str, Field(description="Team system_id (UUID) — from list_teams")],
    ctx: Context,
    date_from: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Expand occurrences from this date (YYYY-MM-DD). Defaults to the start "
                "of the current month."
            ),
        ),
    ] = None,
    date_to: Annotated[
        str | None,
        Field(
            default=None,
            description="Expand occurrences up to this date (YYYY-MM-DD). Defaults to a year out.",
        ),
    ] = None,
) -> dict:
    """
    List a team's meetings, with who attends and the days each one falls on.

    A meeting is **one row with an attendee set**, and a recurring one is one row
    rather than one per occurrence — a daily stand-up is one weekly rule per
    weekday. Every rule the team holds is returned; only the **occurrences** are
    windowed, so a meeting outside the window still appears with an empty
    `occurrences` list.

    Each meeting carries its schedule rule (kind, dates, weekday, interval_weeks),
    a plain-language `summary`, the `half` an occurrence starts in,
    `duration_minutes`, `member_ids` for the attendees, `order_index` (the team's
    own column order in the Meetings view), and the `etag` a write must quote.

    What a meeting costs is not simply its length: it consumes from the half it
    starts in, spills into the rest of that day, and stops at the hours that
    survived absences. Meetings are subtracted **before** focus.
    """
    params = {}
    if date_from:
        params["from"] = date_from
    if date_to:
        params["to"] = date_to
    return await call_backend("GET", f"/api/v1/teams/{team_id}/meetings", params=params or None)


@read_mcp.tool()
async def get_team_capacity(
    team_id: Annotated[str, Field(description="Team system_id (UUID) — from list_teams")],
    ctx: Context,
    date_from: Annotated[
        str | None,
        Field(default=None, description="Only sprints ending on or after this date (YYYY-MM-DD)"),
    ] = None,
    date_to: Annotated[
        str | None,
        Field(default=None, description="Only sprints starting on or before this date (YYYY-MM-DD)"),
    ] = None,
) -> dict:
    """
    Compute a team's capacity per member, per sprint.

    The sprint calendar comes from the team's **anchor project** — the first
    project assigned to it. A team serving no project has no calendar and returns
    no sprints rather than inventing months.

    Each cell is the chain from spec §5.4 in order: contracted half-days →
    absences → meetings → focus → ÷ normal_day_hours. A person-day is the team's
    normal_day_hours of work for everyone, never the member's own day, so a
    6 h/day part-timer's full day is 0.75 PD.
    A sprint missing either date returns **null**, not 0 — unknown and empty are
    different, and a zero would read as a team that does no work.
    `present_days` answers a different question from `person_days`: someone can be
    around for 9 days and contribute 6.3 PD.

    Also returns one row per served project with the share-adjusted PD, the value
    in that project's own effort unit, and — for `factor` projects — the integer a
    push would write. Reading this changes nothing: capacity reaches a project
    only through an explicit push.
    """
    params = {}
    if date_from:
        params["from"] = date_from
    if date_to:
        params["to"] = date_to
    return await call_backend("GET", f"/api/v1/teams/{team_id}/capacity", params=params or None)


@read_mcp.tool()
async def preview_team_capacity(
    team_id: Annotated[str, Field(description="Team system_id (UUID) — from list_teams")],
    project_id: Annotated[str, Field(description="Project system_id (UUID) this team serves")],
    ctx: Context,
    date_from: Annotated[
        str | None,
        Field(default=None, description="Only sprints ending on or after this date (YYYY-MM-DD)"),
    ] = None,
    date_to: Annotated[
        str | None,
        Field(default=None, description="Only sprints starting on or before this date (YYYY-MM-DD)"),
    ] = None,
) -> dict:
    """
    Show what pushing this team's capacity would write into one project's sprints.

    A **read**, deliberately: "what would this do" should be answerable without
    holding a write capability, and it is the review step of the update flow.
    Nothing is written — the push itself is a separate, explicit act.

    Per sprint it returns the label, the dates, the Available the sprint holds
    now, the value the team's capacity produces (PD → the project's unit), and the
    integer that value rounds to — half-up, per sprint independently, which is the
    single rounding in the whole chain.
    `proposed` is null for a sprint without both dates, and the whole preview is
    empty of proposals when the project's available_source is `manual`: nothing is
    meant to flow into a manual project. Switch it to `factor` with
    update_assignment first, and set units_per_pd — a wrong factor shows up here
    as visibly wrong integers, which is the point of previewing.
    """
    params = {}
    if date_from:
        params["from"] = date_from
    if date_to:
        params["to"] = date_to
    report = await call_backend("GET", f"/api/v1/teams/{team_id}/capacity", params=params or None)

    row = next((p for p in report["projects"] if p["project_id"] == project_id), None)
    if row is None:
        served = ", ".join(repr(p["name"]) for p in report["projects"]) or "(none)"
        raise ValueError(
            f"This team does not serve project {project_id}. It serves: {served}. "
            "Assign it with assign_project first."
        )

    sprints = []
    for index, sprint in enumerate(report["sprints"]):
        sprints.append(
            {
                "sprint_id": sprint["sprint_id"],
                "label": sprint["label"],
                "pi_name": sprint["pi_name"],
                "pi_state": sprint["pi_state"],
                "start_date": sprint["start_date"],
                "end_date": sprint["end_date"],
                "current_available": sprint["available"],
                "team_person_days": (report["team"][index] or {}).get("person_days"),
                "share_adjusted_person_days": row["person_days"][index],
                "in_project_units": row["units"][index],
                "proposed_available": row["proposed_available"][index],
            }
        )

    return {
        "team_id": team_id,
        "project_id": project_id,
        "project_name": row["name"],
        "effort_unit": row["effort_unit"],
        "share_pct": row["share_pct"],
        "available_source": row["available_source"],
        "units_per_pd": row["units_per_pd"],
        "sprints": sprints,
    }
