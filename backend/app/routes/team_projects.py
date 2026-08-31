"""Which projects a team serves, and the capacity it has for them.

Assignment is a join and almost nothing else: **a project is served by at most
one team, a team serves many** (spec/teams.md §6.1). The one-team rule is a unique
index on ``project_id``, so a second team assigning the same project is refused
rather than resolved.

Two rules here read as omissions and are not:

**Shares over 100% are allowed.** ``share_pct`` is validated 1–100 per assignment,
but a team's shares may sum past 100 and nothing here blocks it. Teams really are
overcommitted, and a planner that refuses to represent the situation it exists to
reveal is worse than one that colours it amber (§6.3). The warning is the
frontend's, computed from the same list this returns.

**Unassigning writes nothing to the project.** Every sprint's Available stays
exactly as it stands, at whatever was last pushed, and the project is back to
manual because the row carrying ``available_source`` is gone. This falls out of
the push model for free: Available is always a value someone wrote, never a live
view, so removing the team removes nothing and plans do not silently deflate
(§6.1).

No ``require_edit_lock``: these paths carry a ``project_id`` in the body or the
path, but they write **team** data, not project data — nothing here touches a
sprint. The push that does is step 7's, and it is project-scoped and locked.
"""

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.project import Project
from app.models.team import Team, TeamProject
from app.models.user import User
from app.schemas import (
    MAX_PROJECTS_PER_TEAM,
    TeamCapacityResponse,
    TeamProjectCreate,
    TeamProjectResponse,
    TeamProjectUpdate,
)
from app.services.concurrency import IfMatch, check_if_match, etag_for, set_etag
from app.services.events import broadcaster, team_channel
from app.services.team_capacity_report import build_report, load_assignments

router = APIRouter(prefix="/api/v1/teams/{team_id}", tags=["team-projects"])


async def _team_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


def _response(assignment: TeamProject, project: Project, is_anchor: bool) -> TeamProjectResponse:
    """One assignment, joined to the project it names.

    Built field by field rather than validated from the row: ``project_name`` and
    ``effort_unit`` live on the project, and both are required here — the Projects
    tab has no second read to fill them in from.
    """
    return TeamProjectResponse(
        system_id=assignment.system_id,
        team_id=assignment.team_id,
        project_id=assignment.project_id,
        project_name=project.name,
        effort_unit=project.effort_unit,
        share_pct=assignment.share_pct,
        available_source=assignment.available_source,
        units_per_pd=assignment.units_per_pd,
        is_anchor=is_anchor,
        created_at=assignment.created_at,
        modified_at=assignment.modified_at,
        etag=etag_for(assignment.modified_at),
    )


async def _all_responses(db: AsyncSession, team_id: str) -> list[TeamProjectResponse]:
    rows = await load_assignments(db, team_id)
    return [
        _response(assignment, project, is_anchor=index == 0)
        for index, (assignment, project) in enumerate(rows)
    ]


async def _one_response(db: AsyncSession, team_id: str, project_id: str) -> TeamProjectResponse:
    for response in await _all_responses(db, team_id):
        if response.project_id == project_id:
            return response
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")


async def _assignment_or_404(db: AsyncSession, team_id: str, project_id: str) -> TeamProject:
    assignment = await db.scalar(
        select(TeamProject).where(
            TeamProject.team_id == team_id, TeamProject.project_id == project_id
        )
    )
    if not assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This team does not serve that project"
        )
    return assignment


@router.get("/projects")
async def list_team_projects(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[TeamProjectResponse]:
    """The projects this team serves, **anchor first**.

    Order is by assignment time and is not a preference: the earliest assignment
    is the anchor whose sprint calendar the team's own views count in (§6.8).
    """
    await _team_or_404(db, team_id)
    return await _all_responses(db, team_id)


@router.post("/projects", status_code=status.HTTP_201_CREATED)
async def assign_project(
    team_id: str,
    body: TeamProjectCreate,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamProjectResponse:
    await _team_or_404(db, team_id)

    project = await db.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    existing = await db.scalar(
        select(TeamProject).where(TeamProject.project_id == body.project_id)
    )
    if existing is not None:
        # Naming the holder matters: "already assigned" without it leaves the user
        # hunting through every team for the one that has it.
        holder = await db.get(Team, existing.team_id)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "PROJECT_ALREADY_ASSIGNED",
                "message": (
                    f"'{project.name}' is already served by "
                    f"'{holder.name if holder else 'another team'}'. A project has at most "
                    "one team — unassign it there first."
                ),
                "team_id": existing.team_id,
            },
        )

    count = await db.scalar(
        select(func.count(TeamProject.system_id)).where(TeamProject.team_id == team_id)
    )
    if (count or 0) >= MAX_PROJECTS_PER_TEAM:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "PROJECT_LIMIT_REACHED",
                "message": f"A team serves at most {MAX_PROJECTS_PER_TEAM} projects.",
            },
        )

    assignment = TeamProject(
        team_id=team_id,
        project_id=body.project_id,
        share_pct=body.share_pct,
        available_source=body.available_source,
        units_per_pd=body.units_per_pd,
    )
    db.add(assignment)
    try:
        await db.commit()
    except IntegrityError:
        # The unique index, in case two assignments raced past the check above.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "PROJECT_ALREADY_ASSIGNED",
                "message": f"'{project.name}' is already served by a team.",
            },
        )
    await db.refresh(assignment)

    await broadcaster.broadcast(
        team_channel(team_id), "team:project:assigned", {"project_id": body.project_id}
    )
    set_etag(response, assignment.modified_at)
    return await _one_response(db, team_id, body.project_id)


@router.patch("/projects/{project_id}")
async def update_assignment(
    team_id: str,
    project_id: str,
    body: TeamProjectUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamProjectResponse:
    await _team_or_404(db, team_id)
    assignment = await _assignment_or_404(db, team_id, project_id)
    check_if_match(
        if_match, assignment.modified_at, await _one_response(db, team_id, project_id)
    )

    if body.share_pct is not None:
        assignment.share_pct = body.share_pct
    if body.available_source is not None:
        assignment.available_source = body.available_source
    if body.units_per_pd is not None:
        assignment.units_per_pd = body.units_per_pd
    assignment.modified_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(assignment)

    await broadcaster.broadcast(
        team_channel(team_id), "team:project:updated", {"project_id": project_id}
    )
    set_etag(response, assignment.modified_at)
    return await _one_response(db, team_id, project_id)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_project(
    team_id: str,
    project_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    """Stop serving a project. **Nothing is written to the project** (§6.1)."""
    await _team_or_404(db, team_id)
    assignment = await _assignment_or_404(db, team_id, project_id)
    check_if_match(
        if_match, assignment.modified_at, await _one_response(db, team_id, project_id)
    )

    await db.delete(assignment)
    await db.commit()

    await broadcaster.broadcast(
        team_channel(team_id), "team:project:unassigned", {"project_id": project_id}
    )


@router.get("/capacity")
async def get_team_capacity(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    window_from: Annotated[
        date | None,
        Query(alias="from", description="Only sprints ending on or after this date"),
    ] = None,
    window_to: Annotated[
        date | None,
        Query(alias="to", description="Only sprints starting on or before this date"),
    ] = None,
) -> TeamCapacityResponse:
    """Capacity per member, per sprint, for the team's anchor project calendar.

    A read, and only a read: nothing here writes a sprint. The number reaches a
    project through an explicit push (§6.7), which is why this endpoint is
    available to anyone who can see the team.
    """
    team = await _team_or_404(db, team_id)
    return await build_report(db, team, window_from=window_from, window_to=window_to)
