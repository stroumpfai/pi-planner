from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.pi import PI
from app.models.pi_event import PIEvent
from app.models.user import User
from app.schemas import PIEventCreate, PIEventResponse, PIEventUpdate
from app.services.events import broadcaster

router = APIRouter(tags=["pi_events"])


async def _get_pi_or_404(db: AsyncSession, pi_id: str) -> PI:
    pi = await db.get(PI, pi_id)
    if not pi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")
    return pi


async def _get_event_or_404(db: AsyncSession, event_id: str) -> PIEvent:
    event = await db.get(PIEvent, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


@router.get("/api/v1/pis/{pi_id}/events")
async def list_events(
    pi_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[PIEventResponse]:
    await _get_pi_or_404(db, pi_id)
    result = await db.execute(
        select(PIEvent)
        .where(PIEvent.pi_id == pi_id)
        .order_by(PIEvent.event_date.asc())
    )
    return [PIEventResponse.model_validate(e) for e in result.scalars().all()]


@router.post("/api/v1/pis/{pi_id}/events", status_code=status.HTTP_201_CREATED)
async def create_event(
    pi_id: str,
    body: PIEventCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_editor_or_above)],
) -> PIEventResponse:
    pi = await _get_pi_or_404(db, pi_id)
    event = PIEvent(
        pi_id=pi_id,
        name=body.name,
        event_date=body.event_date,
        event_type=body.event_type,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    await broadcaster.broadcast(pi.project_id, "pi_event:created", {"system_id": event.system_id, "pi_id": pi_id})
    return PIEventResponse.model_validate(event)


@router.patch("/api/v1/pis/{pi_id}/events/{event_id}")
async def update_event(
    pi_id: str,
    event_id: str,
    body: PIEventUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> PIEventResponse:
    await _get_pi_or_404(db, pi_id)
    event = await _get_event_or_404(db, event_id)
    if event.pi_id != pi_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    fields = body.model_fields_set
    if "name" in fields and body.name is not None:
        event.name = body.name
    if "event_date" in fields and body.event_date is not None:
        event.event_date = body.event_date
    if "event_type" in fields and body.event_type is not None:
        event.event_type = body.event_type

    event.modified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(event)

    pi = await db.get(PI, pi_id)
    if pi:
        await broadcaster.broadcast(pi.project_id, "pi_event:updated", {"system_id": event_id, "pi_id": pi_id})
    return PIEventResponse.model_validate(event)


@router.delete("/api/v1/pis/{pi_id}/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    pi_id: str,
    event_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    await _get_pi_or_404(db, pi_id)
    event = await _get_event_or_404(db, event_id)
    if event.pi_id != pi_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    pi = await db.get(PI, pi_id)
    await db.delete(event)
    await db.commit()
    if pi:
        await broadcaster.broadcast(pi.project_id, "pi_event:deleted", {"system_id": event_id, "pi_id": pi_id})
