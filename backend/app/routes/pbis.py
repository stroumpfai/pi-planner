from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.project import Project
from app.models.user import User
from app.schemas import PBICreate, PBIResponse, PBIUpdate
from app.services.events import broadcaster
from app.services.validation import is_user_id_available

router = APIRouter(tags=["pbis"])


def _id_conflict(user_id: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "ID_ALREADY_EXISTS", "message": f"ID {user_id} already used in this project"},
    )


async def _get_or_404(db: AsyncSession, pbi_id: str) -> PBI:
    pbi = await db.get(PBI, pbi_id)
    if not pbi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PBI not found")
    return pbi


@router.get("/api/v1/projects/{project_id}/pbis", response_model=list[PBIResponse])
async def list_pbis(
    project_id: str,
    feature_id: str | None = Query(None),
    db: AsyncSession = Depends(get_session),
) -> list[PBIResponse]:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    q = select(PBI).where(PBI.project_id == project_id)
    if feature_id:
        q = q.where(PBI.parent_feature_system_id == feature_id)
    result = await db.execute(q.order_by(PBI.created_at.asc()))
    return [PBIResponse.model_validate(p) for p in result.scalars().all()]


@router.post(
    "/api/v1/projects/{project_id}/pbis",
    response_model=PBIResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pbi(
    project_id: str,
    body: PBICreate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> PBIResponse:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    feature = await db.get(Feature, body.parent_feature_system_id)
    if not feature or feature.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent feature not found in this project")

    user_id = body.id
    if user_id is not None and not await is_user_id_available(db, project_id, user_id):
        raise _id_conflict(user_id)

    pbi = PBI(
        project_id=project_id,
        parent_feature_system_id=body.parent_feature_system_id,
        user_id=user_id,
        title=body.title,
        description=body.description,
        effort=body.effort,
        item_type=body.item_type,
    )
    db.add(pbi)
    await db.commit()
    await db.refresh(pbi)
    await broadcaster.broadcast(
        project_id, "pbi:created",
        {"system_id": pbi.system_id, "feature_id": body.parent_feature_system_id},
    )
    return PBIResponse.model_validate(pbi)


@router.get("/api/v1/pbis/{pbi_id}", response_model=PBIResponse)
async def get_pbi(pbi_id: str, db: AsyncSession = Depends(get_session)) -> PBIResponse:
    return PBIResponse.model_validate(await _get_or_404(db, pbi_id))


@router.patch("/api/v1/pbis/{pbi_id}", response_model=PBIResponse)
async def update_pbi(
    pbi_id: str,
    body: PBIUpdate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> PBIResponse:
    pbi = await _get_or_404(db, pbi_id)
    fields = body.model_fields_set

    if "id" in fields and body.id != pbi.user_id:
        if body.id is not None and not await is_user_id_available(
            db, pbi.project_id, body.id, exclude_pbi_id=pbi_id
        ):
            raise _id_conflict(body.id)
        pbi.user_id = body.id

    if "item_type" in fields and body.item_type is not None:
        pbi.item_type = body.item_type
    if "title" in fields and body.title is not None:
        pbi.title = body.title
    if "description" in fields:
        pbi.description = body.description
    if "effort" in fields:
        pbi.effort = body.effort
    if "location" in fields and body.location is not None:
        pbi.location = body.location
    if "pi_id" in fields:
        pbi.pi_id = body.pi_id
    if "swimlane_id" in fields:
        pbi.swimlane_id = body.swimlane_id
    if "group_id" in fields:
        pbi.group_id = body.group_id

    pbi.modified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pbi)
    await broadcaster.broadcast(pbi.project_id, "pbi:updated", {"system_id": pbi_id})
    return PBIResponse.model_validate(pbi)


@router.delete("/api/v1/pbis/{pbi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pbi(
    pbi_id: str,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> None:
    pbi = await _get_or_404(db, pbi_id)
    project_id = pbi.project_id
    feature_id = pbi.parent_feature_system_id
    group_id = pbi.group_id

    await db.delete(pbi)
    await db.flush()

    if group_id:
        remaining = (await db.execute(
            select(func.count()).where(PBI.group_id == group_id)
        )).scalar_one()
        if remaining == 0:
            group = await db.get(Group, group_id)
            if group:
                await db.delete(group)

    await db.commit()
    await broadcaster.broadcast(
        project_id, "pbi:deleted",
        {"system_id": pbi_id, "feature_id": feature_id},
    )
