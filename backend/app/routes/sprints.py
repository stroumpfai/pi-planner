from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_edit_lock
from app.models.pi import PI
from app.models.sprint import Sprint
from app.models.user import User
from app.schemas import SprintResponse, SprintUpdate
from app.services import team_push
from app.services.effort import sprint_efforts_for_pi
from app.services.events import broadcaster
from app.services.iteration_placement import iteration_path_taken
from app.services.sprint_alignment import conflicts_for_project, sibling_project_ids

router = APIRouter(tags=["sprints"])


async def _get_or_404(db: AsyncSession, sprint_id: str) -> Sprint:
    sprint = await db.get(Sprint, sprint_id)
    if not sprint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    return sprint


async def _refuse_derived_available(db: AsyncSession, project_id: str) -> None:
    """Available is read-only wherever a team derives it (§6.4, WP-7D).

    Without this an agent — or the sprint dialog — writes a number the next push
    silently reverts, which is worse than a refusal: the value looks accepted
    right up until it disappears. The same guard covers the MCP ``update_sprint``
    and ``set_sprint_capacities`` tools, because both write through this route.
    """
    context = await team_push.load_context(db, project_id)
    if context is None or context.is_manual:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "AVAILABLE_IS_DERIVED",
            "message": (
                f"Available for this project is derived from team '{context.team.name}'. "
                "Push from the team to change it, or switch the assignment back to a "
                "hand-typed budget."
            ),
            "team_id": context.team.system_id,
            "team_name": context.team.name,
        },
    )


async def _refuse_misalignment(db: AsyncSession, project_id: str) -> None:
    """Sprint dates must match across the projects one team serves (§6.8, WP-7G).

    Checked after the change is flushed, so the rule is stated once against the
    would-be state rather than reimplemented against a pending diff. A team
    serving a single project has no siblings and pays one cheap query for the
    check; enforcement only begins once a second project is assigned.
    """
    siblings = await sibling_project_ids(db, project_id)
    if not siblings:
        return
    await db.flush()
    conflicts = await conflicts_for_project(db, project_id, sibling_ids=siblings)
    if not conflicts:
        return
    await db.rollback()
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "SPRINT_DATES_MISALIGNED",
            "message": conflicts[0].message(),
            "conflicts": [conflict.as_dict() for conflict in conflicts],
        },
    )


@router.get("/api/v1/pis/{pi_id}/sprints")
async def list_sprints(
    pi_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[SprintResponse]:
    pi = await db.get(PI, pi_id)
    if not pi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")
    result = await db.execute(
        select(Sprint).where(Sprint.pi_id == pi_id).order_by(Sprint.sprint_index.asc())
    )
    sprints = result.scalars().all()
    efforts = await sprint_efforts_for_pi(db, pi_id)
    return [
        SprintResponse.model_validate(s).model_copy(
            update={"effort": efforts.get(s.sprint_index or 0, 0)}
        )
        for s in sprints
    ]


@router.patch("/api/v1/sprints/{sprint_id}")
async def update_sprint(
    sprint_id: str,
    body: SprintUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> SprintResponse:
    sprint = await _get_or_404(db, sprint_id)

    pi = await db.get(PI, sprint.pi_id)
    if pi and pi.state == "closed":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Closed PIs are read-only")

    fields = body.model_fields_set
    project_id = pi.project_id if pi else None
    if "available" in fields and body.available is not None:
        if project_id:
            await _refuse_derived_available(db, project_id)
        sprint.available = body.available
        # A hand-typed value is not a pushed one, so the header stops claiming a
        # push it no longer reflects. Only reachable on a `manual` project — the
        # guard above turns every other case into a 409.
        sprint.available_pushed_at = None
    if "start_date" in fields:
        sprint.start_date = body.start_date
    if "end_date" in fields:
        sprint.end_date = body.end_date
    if "iteration_path" in fields:
        if body.iteration_path and project_id and await iteration_path_taken(
            db, project_id, body.iteration_path, exclude_sprint_id=sprint.system_id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "ITERATION_PATH_TAKEN",
                    "message": (
                        "Another PI or sprint in this project already has iteration path "
                        f'"{body.iteration_path}"'
                    ),
                },
            )
        sprint.iteration_path = body.iteration_path

    sprint.modified_at = datetime.now(timezone.utc)
    if project_id and fields & {"start_date", "end_date"}:
        await _refuse_misalignment(db, project_id)
    await db.commit()
    await db.refresh(sprint)

    efforts = await sprint_efforts_for_pi(db, sprint.pi_id)
    effort = efforts.get(sprint.sprint_index or 0, 0)
    if pi:
        await broadcaster.broadcast(pi.project_id, "sprint:capacity_changed", {"system_id": sprint_id})
    return SprintResponse.model_validate(sprint).model_copy(update={"effort": effort})
