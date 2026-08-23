from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select
from sqlalchemy import update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_edit_lock
from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.project import Project
from app.models.swimline import Swimline
from app.models.user import User
from app.schemas import (
    BulkDeleteResponse,
    FeatureCreate,
    FeatureResponse,
    FeatureSplitRequest,
    FeatureUpdate,
)
from app.services.effort import feature_efforts
from app.services.events import broadcaster
from app.services.project_state import resolve_state_assignment, validate_state_id
from app.services.validation import is_user_id_available

router = APIRouter(tags=["features"])


def _id_conflict(user_id: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "ID_ALREADY_EXISTS", "message": f"ID {user_id} already used in this project"},
    )


async def _get_feature_or_404(db: AsyncSession, feature_id: str) -> Feature:
    feature = await db.get(Feature, feature_id)
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")
    return feature


async def _enrich(db: AsyncSession, feature: Feature) -> FeatureResponse:
    efforts = await feature_efforts(db, [feature.system_id])
    return FeatureResponse.model_validate(feature).model_copy(
        update={"effort": efforts.get(feature.system_id, 0)}
    )


async def _apply_metadata_fields(
    db: AsyncSession, feature: Feature, body: FeatureUpdate, fields: set[str]
) -> None:
    """Apply the title/description/id/State fields present on the body."""
    if "id" in fields and body.id != feature.user_id:
        if body.id is not None and not await is_user_id_available(
            db, feature.project_id, body.id, exclude_feature_id=feature.system_id
        ):
            raise _id_conflict(body.id)
        feature.user_id = body.id
    if "title" in fields and body.title is not None:
        feature.title = body.title
    if "description" in fields:
        feature.description = body.description

    assignment = await resolve_state_assignment(
        db, feature.project_id, "feature", fields, body.state_id
    )
    if assignment.changed:
        feature.state_id = assignment.state_id


async def _apply_move_to_swimlane(db: AsyncSession, feature: Feature, body: FeatureUpdate, fields: set[str]) -> None:
    if body.swimlane_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="swimlane_id required")
    swimline = await db.get(Swimline, body.swimlane_id)
    if not swimline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swimline not found")

    # Carry groups to the new swimlane, preserving their sprint assignment
    groups = (await db.execute(
        select(Group).where(Group.feature_system_id == feature.system_id)
    )).scalars().all()
    for g in groups:
        g.swimline_id = body.swimlane_id

    feature.location = "pi"
    feature.swimlane_id = body.swimlane_id
    feature.pi_id = body.pi_id if "pi_id" in fields else swimline.pi_id


async def _apply_move_to_backlog(db: AsyncSession, feature: Feature) -> None:
    groups = (await db.execute(
        select(Group).where(Group.feature_system_id == feature.system_id)
    )).scalars().all()
    if groups:
        group_ids = [g.system_id for g in groups]
        await db.execute(sql_update(PBI).where(PBI.group_id.in_(group_ids)).values(group_id=None))
    for g in groups:
        await db.delete(g)
    feature.location = "backlog"
    feature.pi_id = None
    feature.swimlane_id = None


async def _detach_pbi_from_group(db: AsyncSession, pbi: PBI) -> None:
    old_group_id = pbi.group_id
    if not old_group_id:
        return
    pbi.group_id = None
    await db.flush()
    remaining = (await db.execute(
        select(func.count()).where(PBI.group_id == old_group_id)
    )).scalar_one()
    if remaining == 0:
        old_group = await db.get(Group, old_group_id)
        if old_group and old_group.is_implicit:
            await db.delete(old_group)


def _apply_generic_location_fields(feature: Feature, body: FeatureUpdate, fields: set[str]) -> None:
    if "location" in fields and body.location is not None:
        feature.location = body.location
    if "pi_id" in fields:
        feature.pi_id = body.pi_id
    if "swimlane_id" in fields:
        feature.swimlane_id = body.swimlane_id


@router.get("/api/v1/projects/{project_id}/features")
async def list_features(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    sort: Annotated[str, Query(pattern="^(created_at|name)$")] = "created_at",
) -> list[FeatureResponse]:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    q = select(Feature).where(Feature.project_id == project_id)
    q = q.order_by(Feature.title.asc() if sort == "name" else Feature.created_at.desc())
    features = (await db.execute(q)).scalars().all()
    efforts = await feature_efforts(db, [f.system_id for f in features])
    return [
        FeatureResponse.model_validate(f).model_copy(update={"effort": efforts.get(f.system_id, 0)})
        for f in features
    ]


@router.post("/api/v1/projects/{project_id}/features", status_code=status.HTTP_201_CREATED)
async def create_feature(
    project_id: str,
    body: FeatureCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> FeatureResponse:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    user_id = body.id
    if user_id is not None and not await is_user_id_available(db, project_id, user_id):
        raise _id_conflict(user_id)

    state_id = await validate_state_id(db, project_id, "feature", body.state_id)

    feature = Feature(
        project_id=project_id,
        user_id=user_id,
        title=body.title,
        description=body.description,
        state_id=state_id,
    )
    db.add(feature)
    await db.commit()
    await db.refresh(feature)
    await broadcaster.broadcast(project_id, "feature:created", {"system_id": feature.system_id})
    return await _enrich(db, feature)


@router.get("/api/v1/features/{feature_id}")
async def get_feature(
    feature_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> FeatureResponse:
    return await _enrich(db, await _get_feature_or_404(db, feature_id))


@router.patch("/api/v1/features/{feature_id}")
async def update_feature(
    feature_id: str,
    body: FeatureUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> FeatureResponse:
    feature = await _get_feature_or_404(db, feature_id)
    fields = body.model_fields_set

    await _apply_metadata_fields(db, feature, body, fields)

    moving_to_swimlane = "swimlane_id" in fields and body.swimlane_id is not None
    moving_to_backlog = "location" in fields and body.location == "backlog"

    if moving_to_swimlane:
        await _apply_move_to_swimlane(db, feature, body, fields)
    elif moving_to_backlog:
        await _apply_move_to_backlog(db, feature)
    else:
        _apply_generic_location_fields(feature, body, fields)

    feature.modified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(feature)
    event = "feature:moved" if (moving_to_swimlane or moving_to_backlog) else "feature:updated"
    await broadcaster.broadcast(feature.project_id, event, {"system_id": feature_id})
    return await _enrich(db, feature)


@router.post("/api/v1/features/{feature_id}/split")
async def split_feature(
    feature_id: str,
    body: FeatureSplitRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> FeatureResponse:
    feature = await _get_feature_or_404(db, feature_id)
    if feature.location != "pi":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "FEATURE_NOT_IN_PI", "message": "Feature must be in a PI to split"},
        )

    swimline = await db.get(Swimline, body.target_swimline_id)
    if not swimline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swimline not found")
    if swimline.pi_id != body.target_pi_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "SWIMLANE_PI_MISMATCH", "message": "Swimline does not belong to target PI"},
        )

    all_pbi_ids = set((await db.execute(
        select(PBI.system_id).where(PBI.parent_feature_system_id == feature.system_id)
    )).scalars().all())
    selected_ids = set(body.pbi_ids)
    if not selected_ids.issubset(all_pbi_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "PBI_NOT_IN_FEATURE", "message": "One or more PBIs do not belong to this feature"},
        )

    if selected_ids == all_pbi_ids:
        # Every PBI is moving — no split needed, just relocate the whole feature.
        update_body = FeatureUpdate(swimlane_id=body.target_swimline_id, pi_id=body.target_pi_id)
        await _apply_move_to_swimlane(db, feature, update_body, update_body.model_fields_set)
        feature.modified_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(feature)
        await broadcaster.broadcast(feature.project_id, "feature:moved", {"system_id": feature.system_id})
        return await _enrich(db, feature)

    new_feature = Feature(
        project_id=feature.project_id,
        title=feature.title,
        description=feature.description,
        location="pi",
        pi_id=body.target_pi_id,
        swimlane_id=body.target_swimline_id,
        continued_from_feature_id=feature.system_id,
        # The continuation is the same work carried into a later PI, so it starts from
        # the same State. Both lists are the project's feature list, so the id is valid.
        state_id=feature.state_id,
    )
    db.add(new_feature)
    await db.flush()

    pbis = (await db.execute(select(PBI).where(PBI.system_id.in_(selected_ids)))).scalars().all()
    for pbi in pbis:
        await _detach_pbi_from_group(db, pbi)
        pbi.parent_feature_system_id = new_feature.system_id
        pbi.pi_id = body.target_pi_id
        pbi.swimlane_id = body.target_swimline_id
        pbi.modified_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(new_feature)

    await broadcaster.broadcast(feature.project_id, "feature:created", {"system_id": new_feature.system_id})
    await broadcaster.broadcast(feature.project_id, "feature:updated", {"system_id": feature.system_id})
    for pbi_id in selected_ids:
        await broadcaster.broadcast(feature.project_id, "pbi:updated", {"system_id": pbi_id})

    return await _enrich(db, new_feature)


@router.post("/api/v1/features/{feature_id}/cancel-continuation")
async def cancel_continuation(
    feature_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> FeatureResponse:
    feature = await _get_feature_or_404(db, feature_id)
    if feature.continued_from_feature_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "NOT_A_CONTINUATION", "message": "Feature is not a continuation"},
        )

    downstream = (await db.execute(
        select(func.count()).where(Feature.continued_from_feature_id == feature.system_id)
    )).scalar_one()
    if downstream > 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "HAS_CONTINUATIONS", "message": "Cancel its downstream continuations first"},
        )

    origin = await db.get(Feature, feature.continued_from_feature_id)
    if not origin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Origin feature not found")

    pbis = (await db.execute(
        select(PBI).where(PBI.parent_feature_system_id == feature.system_id)
    )).scalars().all()
    moved_ids = [pbi.system_id for pbi in pbis]
    for pbi in pbis:
        await _detach_pbi_from_group(db, pbi)
        pbi.parent_feature_system_id = origin.system_id
        pbi.pi_id = origin.pi_id
        pbi.swimlane_id = origin.swimlane_id
        pbi.location = origin.location
        pbi.modified_at = datetime.now(timezone.utc)

    # Re-parent the PBIs before deleting, then drop the stale ORM collection so the
    # delete-orphan cascade doesn't destroy the PBIs we just moved to the origin.
    await db.flush()
    db.expire(feature, ["pbis"])
    await db.delete(feature)
    await db.commit()
    await db.refresh(origin)

    await broadcaster.broadcast(origin.project_id, "feature:deleted", {"system_id": feature_id})
    await broadcaster.broadcast(origin.project_id, "feature:updated", {"system_id": origin.system_id})
    for pbi_id in moved_ids:
        await broadcaster.broadcast(origin.project_id, "pbi:updated", {"system_id": pbi_id})

    return await _enrich(db, origin)


@router.delete("/api/v1/projects/{project_id}/backlog")
async def clear_backlog(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> BulkDeleteResponse:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    count = (await db.execute(
        select(func.count()).select_from(Feature).where(
            Feature.project_id == project_id, Feature.location == "backlog"
        )
    )).scalar_one()
    backlog_ids = select(Feature.system_id).where(
        Feature.project_id == project_id, Feature.location == "backlog"
    )
    await db.execute(sql_delete(PBI).where(PBI.parent_feature_system_id.in_(backlog_ids)))
    await db.execute(sql_delete(Feature).where(Feature.project_id == project_id, Feature.location == "backlog"))
    await db.commit()
    await broadcaster.broadcast(project_id, "backlog:cleared", {"project_id": project_id})
    return BulkDeleteResponse(deleted_features=count)


@router.delete("/api/v1/projects/{project_id}/features")
async def clear_all_features(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> BulkDeleteResponse:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    count = (await db.execute(
        select(func.count()).select_from(Feature).where(Feature.project_id == project_id)
    )).scalar_one()
    # PBI.group_id → Group and Group.story_system_id → PBI form a cycle that SQLAlchemy's
    # unit-of-work cannot topologically sort. Delete in explicit dependency order instead.
    feature_ids = select(Feature.system_id).where(Feature.project_id == project_id)
    group_ids = select(Group.system_id).where(Group.feature_system_id.in_(feature_ids))
    await db.execute(sql_update(PBI).where(PBI.group_id.in_(group_ids)).values(group_id=None))
    await db.execute(sql_delete(Group).where(Group.feature_system_id.in_(feature_ids)))
    await db.execute(sql_delete(PBI).where(PBI.project_id == project_id))
    await db.execute(sql_delete(Feature).where(Feature.project_id == project_id))
    await db.commit()
    await broadcaster.broadcast(project_id, "features:cleared", {"project_id": project_id})
    return BulkDeleteResponse(deleted_features=count)


@router.delete("/api/v1/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature(
    feature_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> None:
    feature = await _get_feature_or_404(db, feature_id)
    project_id = feature.project_id
    await db.delete(feature)
    await db.commit()
    await broadcaster.broadcast(project_id, "feature:deleted", {"system_id": feature_id})
