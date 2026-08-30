"""Test-only reset endpoint — only mounted when ALLOW_TEST_RESET=true."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import require_editor_or_above
from app.models import (
    PBI,
    PI,
    Absence,
    EditLock,
    Feature,
    Group,
    Meeting,
    MeetingAttendee,
    MemberPatternVersion,
    Project,
    Session,
    Sprint,
    Swimline,
    Team,
    TeamMember,
    TeamProject,
)
from app.models.user import User

router = APIRouter(prefix="/api/v1/test", tags=["test"])


@router.post("/reset")
async def reset_database(
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> dict[str, str]:
    """Delete all rows from every table in dependency order. Test use only."""
    # Teams live outside projects (teams.md §3.1), so nothing here cascades them:
    # without these rows a team created by one spec survives into the next, and the
    # Teams section is never empty again. Children first, then TeamProject before
    # Project, since it points at both sides.
    for model in (
        MeetingAttendee,
        Meeting,
        Absence,
        MemberPatternVersion,
        TeamProject,
        TeamMember,
        Team,
        PBI,
        Group,
        Feature,
        EditLock,
        Session,
        Sprint,
        Swimline,
        PI,
        Project,
    ):
        await session.execute(delete(model))
    await session.commit()
    return {"status": "ok"}
