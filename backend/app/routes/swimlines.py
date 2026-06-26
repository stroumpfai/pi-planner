from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.feature import Feature
from app.models.pi import PI
from app.models.swimline import Swimline
from app.models.user import User
from app.schemas import SwimlineCreate, SwimlineResponse, SwimlineUpdate
from app.schemas.swimline import SwimlineReorder
from app.services.effort import pi_capacity, swimline_efforts
from app.services.events import broadcaster

router = APIRouter(tags=["swimlines"])


async def _swimline_response(db: AsyncSession, swimline: Swimline) -> SwimlineResponse:
    efforts = await swimline_efforts(db, [swimline.system_id])
    cap = await pi_capacity(db, swimline.pi_id)
    return SwimlineResponse.model_validate(swimline).model_copy(
        update={"effort": efforts.get(swimline.system_id, 0), "capacity": cap}
    )


async def _get_swimline_or_404(db: AsyncSession, swimline_id: str) -> Swimline:
    swimline = await db.get(Swimline, swimline_id)
    if not swimline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swimline not found")
    return swimline


async def _next_order_index(db: AsyncSession, pi_id: str) -> int:
    result = await db.execute(
        select(Swimline.order_index)
        .where(Swimline.pi_id == pi_id)
        .order_by(Swimline.order_index.desc())
        .limit(1)
    )
    current_max = result.scalar_one_or_none()
    return (current_max or 0) + 1


@router.get("/api/v1/pis/{pi_id}/swimlines")
async def list_swimlines(
    pi_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[SwimlineResponse]:
    if not await db.get(PI, pi_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")
    result = await db.execute(
        select(Swimline)
        .where(Swimline.pi_id == pi_id)
        .order_by(Swimline.order_index.asc(), Swimline.created_at.asc())
    )
    swimlines = result.scalars().all()
    if not swimlines:
        return []
    efforts = await swimline_efforts(db, [s.system_id for s in swimlines])
    cap = await pi_capacity(db, pi_id)
    return [
        SwimlineResponse.model_validate(s).model_copy(
            update={"effort": efforts.get(s.system_id, 0), "capacity": cap}
        )
        for s in swimlines
    ]


@router.post("/api/v1/pis/{pi_id}/swimlines", status_code=status.HTTP_201_CREATED)
async def create_swimline(
    pi_id: str,
    body: SwimlineCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> SwimlineResponse:
    pi = await db.get(PI, pi_id)
    if not pi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")

    order_index = body.order_index if body.order_index is not None else await _next_order_index(db, pi_id)

    swimline = Swimline(pi_id=pi_id, name=body.name, order_index=order_index)
    db.add(swimline)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "NAME_TAKEN", "message": f"A swimline named '{body.name}' already exists in this PI"},
        )
    await db.refresh(swimline)
    await broadcaster.broadcast(pi.project_id, "swimline:created", {"system_id": swimline.system_id})
    return await _swimline_response(db, swimline)


@router.get("/api/v1/swimlines/{swimline_id}")
async def get_swimline(
    swimline_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> SwimlineResponse:
    return await _swimline_response(db, await _get_swimline_or_404(db, swimline_id))


@router.patch("/api/v1/swimlines/{swimline_id}")
async def update_swimline(
    swimline_id: str,
    body: SwimlineUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> SwimlineResponse:
    swimline = await _get_swimline_or_404(db, swimline_id)
    fields = body.model_fields_set

    if "name" in fields and body.name is not None:
        swimline.name = body.name
    if "order_index" in fields:
        swimline.order_index = body.order_index

    swimline.modified_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "NAME_TAKEN", "message": "A swimline with this name already exists in this PI"},
        )
    await db.refresh(swimline)

    pi = await db.get(PI, swimline.pi_id)
    project_id = pi.project_id if pi else ""
    await broadcaster.broadcast(project_id, "swimline:updated", {"system_id": swimline_id})
    return await _swimline_response(db, swimline)


@router.delete("/api/v1/swimlines/{swimline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_swimline(
    swimline_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> None:
    swimline = await _get_swimline_or_404(db, swimline_id)
    pi = await db.get(PI, swimline.pi_id)
    project_id = pi.project_id if pi else ""

    # Return features to backlog before deleting swimline
    features = (await db.execute(
        select(Feature).where(Feature.swimlane_id == swimline_id)
    )).scalars().all()
    for f in features:
        f.location = "backlog"
        f.pi_id = None
        f.swimlane_id = None

    await db.delete(swimline)
    await db.commit()
    await broadcaster.broadcast(project_id, "swimline:deleted", {"system_id": swimline_id})


@router.post("/api/v1/swimlines/{swimline_id}/reorder")
async def reorder_swimlines(
    swimline_id: str,
    body: SwimlineReorder,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[SwimlineResponse]:
    swimline = await _get_swimline_or_404(db, swimline_id)
    pi_id = swimline.pi_id
    pi = await db.get(PI, pi_id)
    project_id = pi.project_id if pi else ""

    # Bulk-update order_index for all swimlines in the PI
    all_swimlines = (await db.execute(
        select(Swimline).where(Swimline.pi_id == pi_id)
    )).scalars().all()
    swimline_map = {s.system_id: s for s in all_swimlines}

    for idx, sid in enumerate(body.order):
        if sid in swimline_map:
            swimline_map[sid].order_index = idx

    await db.commit()
    await broadcaster.broadcast(project_id, "swimline:reordered", {"pi_id": pi_id})

    result = await db.execute(
        select(Swimline)
        .where(Swimline.pi_id == pi_id)
        .order_by(Swimline.order_index.asc(), Swimline.created_at.asc())
    )
    reordered_swimlines = result.scalars().all()
    efforts = await swimline_efforts(db, [s.system_id for s in reordered_swimlines])
    cap = await pi_capacity(db, pi_id)
    return [
        SwimlineResponse.model_validate(s).model_copy(
            update={"effort": efforts.get(s.system_id, 0), "capacity": cap}
        )
        for s in reordered_swimlines
    ]
