from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.feature import Feature
from app.models.pi import PI
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.models.user import User
from app.schemas import PICreate, PIResponse, PIUpdate
from app.services.events import broadcaster

router = APIRouter(tags=["pis"])

SPRINT_COUNT = 5


async def _get_or_404(db: AsyncSession, pi_id: str) -> PI:
    pi = await db.get(PI, pi_id)
    if not pi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")
    return pi


def _assert_not_closed(pi: PI) -> None:
    if pi.state == "closed":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Closed PIs are read-only",
        )


async def _check_no_active_pi(db: AsyncSession, project_id: str, exclude_pi_id: str | None = None) -> None:
    q = select(PI).where(PI.project_id == project_id, PI.state == "in_progress")
    if exclude_pi_id:
        q = q.where(PI.system_id != exclude_pi_id)
    result = await db.execute(q)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "ACTIVE_PI_EXISTS",
                "message": "Another PI is already in progress. Close it before starting a new one.",
            },
        )


def _create_sprints(db: AsyncSession, pi_id: str) -> None:
    for i in range(SPRINT_COUNT):
        db.add(Sprint(pi_id=pi_id, sprint_index=i, capacity=0))


@router.get("/api/v1/projects/{project_id}/pis", response_model=list[PIResponse])
async def list_pis(
    project_id: str,
    db: AsyncSession = Depends(get_session),
) -> list[PIResponse]:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    result = await db.execute(
        select(PI).where(PI.project_id == project_id).order_by(PI.created_at.asc())
    )
    return [PIResponse.model_validate(p) for p in result.scalars().all()]


@router.post(
    "/api/v1/projects/{project_id}/pis",
    response_model=PIResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pi(
    project_id: str,
    body: PICreate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> PIResponse:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if body.state == "in_progress":
        await _check_no_active_pi(db, project_id)

    pi = PI(
        project_id=project_id,
        name=body.name,
        description=body.description,
        state=body.state,
        start_date=body.start_date,
        end_date=body.end_date,
    )
    db.add(pi)
    await db.flush()  # obtain pi.system_id before creating sprints
    _create_sprints(db, pi.system_id)
    await db.commit()
    await db.refresh(pi)
    await broadcaster.broadcast(project_id, "pi:created", {"system_id": pi.system_id})
    return PIResponse.model_validate(pi)


@router.get("/api/v1/pis/{pi_id}", response_model=PIResponse)
async def get_pi(pi_id: str, db: AsyncSession = Depends(get_session)) -> PIResponse:
    return PIResponse.model_validate(await _get_or_404(db, pi_id))


@router.patch("/api/v1/pis/{pi_id}", response_model=PIResponse)
async def update_pi(
    pi_id: str,
    body: PIUpdate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> PIResponse:
    pi = await _get_or_404(db, pi_id)
    _assert_not_closed(pi)

    fields = body.model_fields_set

    if "state" in fields and body.state is not None and body.state != pi.state:
        if body.state == "in_progress":
            await _check_no_active_pi(db, pi.project_id, exclude_pi_id=pi_id)
        pi.state = body.state

    if "name" in fields and body.name is not None:
        pi.name = body.name
    if "description" in fields:
        pi.description = body.description
    if "start_date" in fields:
        pi.start_date = body.start_date
    if "end_date" in fields:
        pi.end_date = body.end_date

    pi.modified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pi)

    event = "pi:state_changed" if "state" in fields else "pi:updated"
    await broadcaster.broadcast(pi.project_id, event, {"system_id": pi_id, "state": pi.state})
    return PIResponse.model_validate(pi)


@router.delete("/api/v1/pis/{pi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pi(
    pi_id: str,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> None:
    pi = await _get_or_404(db, pi_id)
    project_id = pi.project_id

    # Return all features in this PI's swimlines back to backlog
    swimlines = (await db.execute(
        select(Swimline).where(Swimline.pi_id == pi_id)
    )).scalars().all()
    swimline_ids = [s.system_id for s in swimlines]

    if swimline_ids:
        features = (await db.execute(
            select(Feature).where(Feature.swimlane_id.in_(swimline_ids))
        )).scalars().all()
        for f in features:
            f.location = "backlog"
            f.pi_id = None
            f.swimlane_id = None

    await db.delete(pi)
    await db.commit()
    await broadcaster.broadcast(project_id, "pi:deleted", {"system_id": pi_id})
