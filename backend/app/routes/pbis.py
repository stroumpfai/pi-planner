from datetime import datetime, timezone

from typing import Annotated

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
from app.schemas import PBICreate, PBIResponse, PBIUpdate, PlaceStoryRequest, PlaceStoryResponse
from app.schemas.group import GroupResponse
from app.services.events import broadcaster
from app.services.validation import is_user_id_available

router = APIRouter(tags=["pbis"])

_EVT_PBI_UPDATED = "pbi:updated"
_EVT_PBI_CREATED = "pbi:created"
_EVT_PBI_DELETED = "pbi:deleted"
_EVT_GROUP_CREATED = "group:created"
_EVT_GROUP_DELETED = "group:deleted"


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


@router.get("/api/v1/projects/{project_id}/pbis")
async def list_pbis(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    feature_id: Annotated[str | None, Query()] = None,
) -> list[PBIResponse]:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    q = select(PBI).where(PBI.project_id == project_id)
    if feature_id:
        q = q.where(PBI.parent_feature_system_id == feature_id)
    result = await db.execute(q.order_by(PBI.created_at.asc()))
    return [PBIResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/api/v1/projects/{project_id}/pbis", status_code=status.HTTP_201_CREATED)
async def create_pbi(
    project_id: str,
    body: PBICreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
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
        project_id, _EVT_PBI_CREATED,
        {"system_id": pbi.system_id, "feature_id": body.parent_feature_system_id},
    )
    return PBIResponse.model_validate(pbi)


@router.get("/api/v1/pbis/{pbi_id}")
async def get_pbi(pbi_id: str, db: Annotated[AsyncSession, Depends(get_session)]) -> PBIResponse:
    return PBIResponse.model_validate(await _get_or_404(db, pbi_id))


async def _apply_pbi_id(db: AsyncSession, pbi: PBI, body: PBIUpdate, fields: set[str]) -> None:
    if "id" not in fields or body.id == pbi.user_id:
        return
    if body.id is not None and not await is_user_id_available(
        db, pbi.project_id, body.id, exclude_pbi_id=pbi.system_id
    ):
        raise _id_conflict(body.id)
    pbi.user_id = body.id


def _apply_scalar_fields(pbi: PBI, body: PBIUpdate, fields: set[str]) -> None:
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


async def _apply_group_change(db: AsyncSession, pbi: PBI, new_group_id: str | None) -> None:
    old_group_id = pbi.group_id
    pbi.group_id = new_group_id
    if not old_group_id or old_group_id == new_group_id:
        return
    await db.flush()
    remaining = (await db.execute(
        select(func.count()).where(PBI.group_id == old_group_id)
    )).scalar_one()
    if remaining == 0:
        old_group = await db.get(Group, old_group_id)
        if old_group and old_group.is_implicit:
            await db.delete(old_group)


@router.patch("/api/v1/pbis/{pbi_id}")
async def update_pbi(
    pbi_id: str,
    body: PBIUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> PBIResponse:
    pbi = await _get_or_404(db, pbi_id)
    fields = body.model_fields_set
    await _apply_pbi_id(db, pbi, body, fields)
    _apply_scalar_fields(pbi, body, fields)
    if "group_id" in fields:
        await _apply_group_change(db, pbi, body.group_id)
    pbi.modified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pbi)
    await broadcaster.broadcast(pbi.project_id, _EVT_PBI_UPDATED, {"system_id": pbi_id})
    return PBIResponse.model_validate(pbi)


@router.post("/api/v1/pbis/{pbi_id}/place")
async def place_story_in_sprint(
    pbi_id: str,
    body: PlaceStoryRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> PlaceStoryResponse:
    pbi = await _get_or_404(db, pbi_id)

    if pbi.group_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "STORY_ALREADY_GROUPED", "message": "Story is already in a group"},
        )

    feature = await db.get(Feature, pbi.parent_feature_system_id)
    if not feature or feature.location != "pi":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "FEATURE_NOT_IN_PI", "message": "Parent feature must be in a PI"},
        )
    if not feature.swimlane_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "FEATURE_NOT_IN_SWIMLANE", "message": "Parent feature has no swimlane"},
        )

    group = Group(
        swimline_id=feature.swimlane_id,
        feature_system_id=feature.system_id,
        name=pbi.title,
        sprint_index=body.sprint_index,
        is_implicit=True,
        story_system_id=pbi.system_id,
    )
    db.add(group)
    await db.flush()

    pbi.group_id = group.system_id
    pbi.swimlane_id = feature.swimlane_id
    pbi.modified_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(group)
    await db.refresh(pbi)

    await broadcaster.broadcast(pbi.project_id, _EVT_GROUP_CREATED, {"system_id": group.system_id, "swimlane_id": group.swimline_id})
    await broadcaster.broadcast(pbi.project_id, _EVT_PBI_UPDATED, {"system_id": pbi_id})

    return PlaceStoryResponse(
        story=PBIResponse.model_validate(pbi),
        group=GroupResponse.model_validate(group),
    )


@router.delete("/api/v1/pbis/{pbi_id}/place", status_code=status.HTTP_204_NO_CONTENT)
async def unplace_story(
    pbi_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> None:
    pbi = await _get_or_404(db, pbi_id)
    old_group_id = pbi.group_id

    pbi.group_id = None
    pbi.swimlane_id = None
    pbi.modified_at = datetime.now(timezone.utc)

    deleted_group_id: str | None = None
    if old_group_id:
        group = await db.get(Group, old_group_id)
        if group and group.is_implicit:
            await db.delete(group)
            deleted_group_id = old_group_id

    await db.commit()
    await broadcaster.broadcast(pbi.project_id, _EVT_PBI_UPDATED, {"system_id": pbi_id})
    if deleted_group_id:
        await broadcaster.broadcast(pbi.project_id, _EVT_GROUP_DELETED, {"system_id": deleted_group_id})


@router.delete("/api/v1/pbis/{pbi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pbi(
    pbi_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
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
        project_id, _EVT_PBI_DELETED,
        {"system_id": pbi_id, "feature_id": feature_id},
    )
