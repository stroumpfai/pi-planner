from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.swimline import Swimline
from app.models.user import User
from app.schemas import GroupCreate, GroupResponse, GroupUpdate
from app.services.events import broadcaster

router = APIRouter(tags=["groups"])


async def _get_group_or_404(db: AsyncSession, group_id: str) -> Group:
    group = await db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group


async def _validate_pbis_for_feature(
    db: AsyncSession, pbi_ids: list[str], feature_system_id: str
) -> list[PBI]:
    if not pbi_ids:
        return []
    pbis = (
        await db.execute(select(PBI).where(PBI.system_id.in_(pbi_ids)))
    ).scalars().all()
    for pbi in pbis:
        if pbi.parent_feature_system_id != feature_system_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "error": "PBI_WRONG_FEATURE",
                    "message": f"PBI {pbi.system_id} does not belong to feature {feature_system_id}",
                },
            )
    return list(pbis)


@router.get("/api/v1/swimlines/{swimline_id}/groups")
async def list_groups(
    swimline_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[GroupResponse]:
    if not await db.get(Swimline, swimline_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swimline not found")
    result = await db.execute(
        select(Group)
        .where(Group.swimline_id == swimline_id)
        .order_by(Group.sprint_index.asc().nulls_first(), Group.order_index.asc().nulls_first())
    )
    return [GroupResponse.model_validate(g) for g in result.scalars().all()]


@router.post("/api/v1/swimlines/{swimline_id}/groups", status_code=status.HTTP_201_CREATED)
async def create_group(
    swimline_id: str,
    body: GroupCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> GroupResponse:
    swimline = await db.get(Swimline, swimline_id)
    if not swimline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swimline not found")

    feature = await db.get(Feature, body.feature_system_id)
    if not feature or feature.swimlane_id != swimline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "FEATURE_NOT_IN_SWIMLANE",
                "message": "Feature is not assigned to this swimlane",
            },
        )

    pbis = await _validate_pbis_for_feature(db, body.pbi_ids, body.feature_system_id)

    group = Group(
        swimline_id=swimline_id,
        feature_system_id=body.feature_system_id,
        name=body.name,
        sprint_index=body.sprint_index,
        order_index=body.order_index,
    )
    db.add(group)
    try:
        await db.flush()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "NAME_TAKEN",
                "message": f"A group named '{body.name}' already exists in this swimlane",
            },
        )

    for pbi in pbis:
        pbi.group_id = group.system_id

    await db.commit()
    await db.refresh(group)

    pi = await db.get(PI, swimline.pi_id)
    project_id = pi.project_id if pi else ""
    await broadcaster.broadcast(project_id, "group:created", {"system_id": group.system_id})
    return GroupResponse.model_validate(group)


@router.get("/api/v1/groups/{group_id}")
async def get_group(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> GroupResponse:
    return GroupResponse.model_validate(await _get_group_or_404(db, group_id))


@router.patch("/api/v1/groups/{group_id}")
async def update_group(
    group_id: str,
    body: GroupUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> GroupResponse:
    group = await _get_group_or_404(db, group_id)
    fields = body.model_fields_set

    if "name" in fields and body.name is not None:
        group.name = body.name
        if group.is_implicit:
            group.is_implicit = False
            group.story_system_id = None
    if "sprint_index" in fields:
        group.sprint_index = body.sprint_index
    if "order_index" in fields:
        group.order_index = body.order_index

    group.modified_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "NAME_TAKEN", "message": "A group with this name already exists in this swimlane"},
        )
    await db.refresh(group)

    swimline = await db.get(Swimline, group.swimline_id)
    pi = await db.get(PI, swimline.pi_id) if swimline else None
    project_id = pi.project_id if pi else ""
    await broadcaster.broadcast(project_id, "group:updated", {"system_id": group_id})
    return GroupResponse.model_validate(group)


@router.delete("/api/v1/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> None:
    group = await _get_group_or_404(db, group_id)

    swimline = await db.get(Swimline, group.swimline_id)
    pi = await db.get(PI, swimline.pi_id) if swimline else None
    project_id = pi.project_id if pi else ""

    # Clear group_id on all PBIs in this group so they return to ungrouped state
    pbis = (await db.execute(
        select(PBI).where(PBI.group_id == group_id)
    )).scalars().all()
    for pbi in pbis:
        pbi.group_id = None

    await db.delete(group)
    await db.commit()
    await broadcaster.broadcast(project_id, "group:deleted", {"system_id": group_id})
