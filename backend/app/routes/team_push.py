"""Getting a team's number onto the board — review, then apply (§6.7).

This is the only place team data is written into project data, and the guards
reflect that. The two project-scoped routes carry ``project_id``, so they inherit
the existing ``require_edit_lock`` and its 409 body with no new code: no acquire,
no release, no heartbeat. The team-scoped multi-project push cannot — it names no
single project — so it checks each project's lock itself and reports the locked
ones as failed rows rather than failing the whole call (§6.7).

The staleness read is guarded by ``get_current_user`` alone, and that is the
point: a reader watching the board must be able to see that a project has fallen
behind its team. Staleness is information, not an action.
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_edit_lock, require_editor_or_above
from app.models.activity_log import ActorType
from app.models.team import Team
from app.models.user import User
from app.schemas import (
    ProjectPushResult,
    ProjectPushStatus,
    PushPreview,
    TeamPushResponse,
)
from app.services import team_push
from app.services.activity import log_activity
from app.services.events import broadcaster, team_channel
from app.services.team_capacity_report import load_assignments

router = APIRouter(tags=["team-push"])

WindowFrom = Annotated[
    date | None, Query(alias="from", description="Only sprints ending on or after this date")
]
WindowTo = Annotated[
    date | None, Query(alias="to", description="Only sprints starting on or before this date")
]


async def _context_or_error(db: AsyncSession, project_id: str) -> team_push.PushContext:
    """The project's team, or the 404/409 that says why there is nothing to push.

    ``manual`` is a 409 rather than an empty success on purpose: silently doing
    nothing would look like a bug, and the fix — switch the assignment to
    `factor` — is one the message can name.
    """
    context = await team_push.load_context(db, project_id)
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": "PROJECT_HAS_NO_TEAM",
                "message": "No team serves this project, so there is no capacity to push.",
            },
        )
    if context.is_manual:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "AVAILABLE_SOURCE_IS_MANUAL",
                "message": (
                    f"'{context.project.name}' types its Available by hand. Switch the "
                    "assignment to a conversion factor before pushing."
                ),
            },
        )
    return context


@router.get("/api/v1/team-capacity/status")
async def team_capacity_status(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    project_id: Annotated[
        str | None, Query(description="Limit to one project; omit for every served project")
    ] = None,
) -> list[ProjectPushStatus]:
    """How far each served project has drifted from its team (§6.6).

    One route serves both surfaces — the home page reads them all, the PI board
    header reads one — because the answer is the same computation either way and
    a second endpoint would only differ in its ``where``.
    """
    return await team_push.status_for(db, project_id)


@router.get("/api/v1/projects/{project_id}/team-capacity/preview")
async def preview_push(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> PushPreview:
    """What a push would write. Writes nothing."""
    context = await _context_or_error(db, project_id)
    rows = await team_push.compute_rows(db, context, window_from=window_from, window_to=window_to)
    return team_push.build_preview(context, rows)


@router.post("/api/v1/projects/{project_id}/team-capacity/apply")
async def apply_push(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_edit_lock)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> ProjectPushResult:
    """Write the proposed values. Idempotent — an unchanged push writes nothing."""
    context = await _context_or_error(db, project_id)
    rows = await team_push.compute_rows(db, context, window_from=window_from, window_to=window_to)
    written, delta = await team_push.apply_rows(db, rows)

    if written:
        await _record(db, context, user, written, delta)
    return ProjectPushResult(
        project_id=project_id,
        project_name=context.project.name,
        status="updated" if written else "no_change",
        updated_sprints=written,
        total_delta=delta,
    )


@router.post("/api/v1/teams/{team_id}/push")
async def push_team(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_editor_or_above)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> TeamPushResponse:
    """Push into every project this team serves — **per project, not atomic**.

    A project someone else is editing fails on its own row and the others still
    apply. Projects are independent aggregates; the alignment between them is on
    dates (§6.8), which a push never changes, so there is nothing a partial
    result can leave inconsistent.
    """
    if not await db.get(Team, team_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    results: list[ProjectPushResult] = []
    for _, project in await load_assignments(db, team_id):
        context = await team_push.load_context(db, project.system_id)
        if context is None:  # pragma: no cover - the join guarantees it exists
            continue
        result = await team_push.push_one(
            db, context, user.username, window_from=window_from, window_to=window_to
        )
        if result.updated_sprints:
            await _record(db, context, user, result.updated_sprints, result.total_delta)
        results.append(result)

    await broadcaster.broadcast(team_channel(team_id), "team:pushed", {"team_id": team_id})
    return TeamPushResponse(team_id=team_id, results=results)


async def _record(
    db: AsyncSession,
    context: team_push.PushContext,
    user: User,
    written: int,
    delta: int,
) -> None:
    """Tell the project's watchers, and leave a trace naming what moved.

    Both are required of any push (§6.7). The SSE event is what makes an open
    board update its headers without a reload; the log entry is what answers
    "who changed the numbers" a fortnight later.
    """
    await broadcaster.broadcast(
        context.project.system_id,
        "sprint:available:pushed",
        {"project_id": context.project.system_id, "sprints": written},
    )
    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=user.username,
        action="team_capacity.push",
        # Against the team, and against the project: a push is the one write that
        # belongs to both, and logging it under either alone hides it from the
        # other's history (§8.2, "two consequences outside the team tools").
        resource_type="team",
        resource_id=context.team.system_id,
        project_id=context.project.system_id,
        details={
            "project_name": context.project.name,
            "team_name": context.team.name,
            "sprints_updated": written,
            "total_delta": delta,
        },
    )
