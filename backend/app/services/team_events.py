"""Telling a team's viewers that project data behind their views has changed.

Team writes and project writes broadcast on separate channels (teams.md §8.1), so a
team view never hears a project event. The Achievement view is the exception that
needs to: every figure on it is computed from project items, so a story completed,
re-estimated or moved between sprints in a served project changes what it shows
(team-achievement.md §8.2).

This is a broadcast, never a write. It crosses from the project into the team
aggregate without touching a row or taking a lock, and a project no team serves
costs one indexed lookup.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import TeamProject
from app.services.events import broadcaster, team_channel

ACHIEVEMENT_CHANGED = "team:achievement:changed"


async def notify_team_achievement(db: AsyncSession, project_id: str) -> None:
    """Broadcast on the serving team's channel, if a team serves this project.

    Called once per request, after the commit, by every project write that can move
    an Achievement figure: an item's completion date, effort or sprint placement, a
    State's category, a deletion, an import or a restore.
    """
    if not project_id:
        return
    team_id = (await db.execute(
        select(TeamProject.team_id).where(TeamProject.project_id == project_id)
    )).scalar_one_or_none()
    if team_id is not None:
        await broadcaster.broadcast(
            team_channel(team_id), ACHIEVEMENT_CHANGED, {"project_id": project_id}
        )
