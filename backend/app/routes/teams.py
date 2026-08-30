from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.project import Project
from app.models.team import Team, TeamMember, TeamProject
from app.models.user import User
from app.schemas import MAX_TEAMS, TeamCreate, TeamResponse, TeamUpdate
from app.services.concurrency import IfMatch, check_if_match, set_etag
from app.services.events import broadcaster, team_channel

# No require_edit_lock anywhere below. These paths carry no project_id, so
# _resolve_locked_project_id would return None and the dependency would be a
# no-op — team endpoints are outside the single-writer lock by construction
# (spec/teams.md §4.1). Concurrency here is If-Match, per row (§4.2).
router = APIRouter(prefix="/api/v1/teams", tags=["teams"])


async def _get_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


async def _counts(db: AsyncSession, team_ids: list[str]) -> tuple[dict[str, int], dict[str, list[str]]]:
    """Member counts and served project ids for a set of teams, in two queries."""
    if not team_ids:
        return {}, {}
    member_rows = await db.execute(
        select(TeamMember.team_id, func.count(TeamMember.system_id))
        .where(TeamMember.team_id.in_(team_ids))
        .group_by(TeamMember.team_id)
    )
    members = {team_id: count for team_id, count in member_rows.all()}

    project_rows = await db.execute(
        select(TeamProject.team_id, TeamProject.project_id)
        .where(TeamProject.team_id.in_(team_ids))
        .order_by(TeamProject.created_at.asc())
    )
    projects: dict[str, list[str]] = {}
    for team_id, project_id in project_rows.all():
        projects.setdefault(team_id, []).append(project_id)
    return members, projects


def _response(team: Team, member_count: int, project_ids: list[str]) -> TeamResponse:
    return TeamResponse.model_validate(team).model_copy(
        update={"member_count": member_count, "project_ids": project_ids}
    )


async def _one_response(db: AsyncSession, team: Team) -> TeamResponse:
    members, projects = await _counts(db, [team.system_id])
    return _response(team, members.get(team.system_id, 0), projects.get(team.system_id, []))


def _name_taken(name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "TEAM_NAME_TAKEN", "message": f"A team named '{name}' already exists"},
    )


@router.get("")
async def list_teams(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[TeamResponse]:
    result = await db.execute(select(Team).order_by(func.lower(Team.name).asc()))
    teams = list(result.scalars().all())
    members, projects = await _counts(db, [t.system_id for t in teams])
    return [
        _response(t, members.get(t.system_id, 0), projects.get(t.system_id, []))
        for t in teams
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_team(
    body: TeamCreate,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamResponse:
    existing = await db.scalar(select(func.count(Team.system_id)))
    if (existing or 0) >= MAX_TEAMS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "TEAM_LIMIT_REACHED",
                "message": f"An instance holds at most {MAX_TEAMS} teams.",
            },
        )

    team = Team(
        name=body.name,
        description=body.description,
        normal_day_hours=body.normal_day_hours,
    )
    db.add(team)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _name_taken(body.name)
    await db.refresh(team)
    # No create event: a team nobody is watching yet has no channel with listeners,
    # exactly as a newly created project has none.

    # Stamp the tag here too, so "create then immediately rename" does not need a
    # GET in between purely to learn a value this response already knows.
    set_etag(response, team.modified_at)
    return _response(team, 0, [])


@router.get("/{team_id}")
async def get_team(
    team_id: str,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> TeamResponse:
    team = await _get_or_404(db, team_id)
    # The tag a later PATCH or DELETE has to quote back in If-Match (§4.2).
    set_etag(response, team.modified_at)
    return await _one_response(db, team)


@router.patch("/{team_id}")
async def update_team(
    team_id: str,
    body: TeamUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamResponse:
    team = await _get_or_404(db, team_id)
    check_if_match(if_match, team.modified_at, await _one_response(db, team))

    if body.name is not None:
        team.name = body.name
    if "description" in body.model_fields_set:
        team.description = body.description
    if body.normal_day_hours is not None:
        team.normal_day_hours = body.normal_day_hours
    team.modified_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _name_taken(body.name or team.name)
    await db.refresh(team)

    await broadcaster.broadcast(team_channel(team_id), "team:updated", {"system_id": team_id})
    set_etag(response, team.modified_at)
    return await _one_response(db, team)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    team = await _get_or_404(db, team_id)
    check_if_match(if_match, team.modified_at, await _one_response(db, team))

    # Blocked while the team serves anything, so nobody loses a capacity model by
    # accident — unassigning is the explicit step (§10). The names come back with
    # the error because "unassign every project first" is useless without them.
    assigned = await db.execute(
        select(TeamProject.project_id, Project.name)
        .join(Project, Project.system_id == TeamProject.project_id)
        .where(TeamProject.team_id == team_id)
        .order_by(Project.name.asc())
    )
    projects = [{"system_id": pid, "name": name} for pid, name in assigned.all()]
    if projects:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "TEAM_HAS_PROJECTS",
                "message": "Unassign this team's projects before deleting it.",
                "projects": projects,
            },
        )

    await db.delete(team)
    await db.commit()
    await broadcaster.broadcast(team_channel(team_id), "team:deleted", {"system_id": team_id})
