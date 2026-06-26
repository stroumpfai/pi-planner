from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.pi import PI
from app.models.sprint import Sprint
from app.models.user import User
from app.schemas import SprintResponse, SprintUpdate
from app.services.effort import sprint_efforts_for_pi
from app.services.events import broadcaster

router = APIRouter(tags=["sprints"])


async def _get_or_404(db: AsyncSession, sprint_id: str) -> Sprint:
    sprint = await db.get(Sprint, sprint_id)
    if not sprint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    return sprint


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
    _: Annotated[User, Depends(get_current_user)],
) -> SprintResponse:
    sprint = await _get_or_404(db, sprint_id)

    pi = await db.get(PI, sprint.pi_id)
    if pi and pi.state == "closed":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Closed PIs are read-only")

    fields = body.model_fields_set
    if "capacity" in fields and body.capacity is not None:
        sprint.capacity = body.capacity
    if "start_date" in fields:
        sprint.start_date = body.start_date
    if "end_date" in fields:
        sprint.end_date = body.end_date

    sprint.modified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(sprint)

    efforts = await sprint_efforts_for_pi(db, sprint.pi_id)
    effort = efforts.get(sprint.sprint_index or 0, 0)
    if pi:
        await broadcaster.broadcast(pi.project_id, "sprint:capacity_changed", {"system_id": sprint_id})
    return SprintResponse.model_validate(sprint).model_copy(update={"effort": effort})
