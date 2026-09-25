"""The team's Achievement view (spec/team-achievement.md §5, §8.1).

Thin routes over `services/achievement_report.py`, which assembles the §5.3
grid. The §6.3 velocity suggestion is read off that same grid, never computed a
second way, so the suggestion and the grid's Velocity row cannot disagree.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.team import Team
from app.models.user import User
from app.schemas.team_achievement import ProjectVelocityResponse, TeamAchievementResponse
from app.services.achievement_report import build_achievement_report, project_velocity

router = APIRouter(prefix="/api/v1/teams/{team_id}", tags=["team-achievement"])


async def _team_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


@router.get("/achievement")
async def get_team_achievement(
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
) -> TeamAchievementResponse:
    """Points achieved per sprint, per served project, and the team's PD total.

    A read, and only a read: every figure is computed from item data on request,
    nothing is stored or frozen (§5.6).
    \f
    Attribution runs over the anchor's **full** calendar even when a window is
    given, so narrowing the window never moves a point between columns or into
    "outside the calendar"; it only hides columns.
    """
    team = await _team_or_404(db, team_id)
    return await build_achievement_report(db, team, window_from=window_from, window_to=window_to)


@router.get("/projects/{project_id}/velocity")
async def get_project_velocity(
    team_id: str,
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    sprints: Annotated[
        int, Query(ge=1, le=10, description="How many of the latest closed sprints to measure over")
    ] = 3,
) -> ProjectVelocityResponse:
    """The measured points per person-day for one served project, over closed sprints.

    A suggestion for the assignment editor, never applied by itself: the typed
    units_per_pd stays the user's (spec/team-achievement.md §6.3).
    \f
    Read off the full, unwindowed Achievement grid: the latest ``sprints`` closed,
    dated columns where the project was given PD and has a done State. The
    velocity is a ratio of sums, so a short sprint weighs less than a long one.
    404 when the team is unknown or does not serve the project.
    """
    team = await _team_or_404(db, team_id)
    report = await build_achievement_report(db, team)
    measured = project_velocity(report, project_id, sprints)
    if measured is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not served by this team"
        )
    return measured
