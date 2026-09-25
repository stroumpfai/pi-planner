"""The team's Achievement view (spec/team-achievement.md §5, §8.1)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.user import User
from app.schemas.team_achievement import TeamAchievementResponse

router = APIRouter(prefix="/api/v1/teams/{team_id}", tags=["team-achievement"])


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
    """
    # Contract stub; WP-3B implements it.
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED)
