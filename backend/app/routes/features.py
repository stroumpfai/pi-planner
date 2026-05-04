from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.feature import Feature
from app.models.group import Group
from app.models.project import Project
from app.models.swimline import Swimline
from app.models.user import User
from app.schemas import FeatureCreate, FeatureResponse, FeatureUpdate
from app.services.events import broadcaster
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


async def _apply_metadata_fields(
    db: AsyncSession, feature: Feature, body: FeatureUpdate, fields: set[str]
) -> None:
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
    if "effort" in fields:
        feature.effort = body.effort


async def _apply_move_to_swimlane(db: AsyncSession, feature: Feature, body: FeatureUpdate, fields: set[str]) -> None:
    swimline = await db.get(Swimline, body.swimlane_id)
    if not swimline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Swimline not found")
    feature.location = "pi"
    feature.swimlane_id = body.swimlane_id
    feature.pi_id = body.pi_id if "pi_id" in fields else swimline.pi_id


async def _apply_move_to_backlog(db: AsyncSession, feature: Feature) -> None:
    groups = (await db.execute(
        select(Group).where(Group.feature_system_id == feature.system_id)
    )).scalars().all()
    for g in groups:
        await db.delete(g)
    feature.location = "backlog"
    feature.pi_id = None
    feature.swimlane_id = None


def _apply_generic_location_fields(feature: Feature, body: FeatureUpdate, fields: set[str]) -> None:
    if "location" in fields and body.location is not None:
        feature.location = body.location
    if "pi_id" in fields:
        feature.pi_id = body.pi_id
    if "swimlane_id" in fields:
        feature.swimlane_id = body.swimlane_id


@router.get("/api/v1/projects/{project_id}/features", response_model=list[FeatureResponse])
async def list_features(
    project_id: str,
    sort: str = Query("created_at", pattern="^(created_at|name)$"),
    db: AsyncSession = Depends(get_session),
) -> list[FeatureResponse]:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    q = select(Feature).where(Feature.project_id == project_id)
    q = q.order_by(Feature.title.asc() if sort == "name" else Feature.created_at.desc())
    result = await db.execute(q)
    return [FeatureResponse.model_validate(f) for f in result.scalars().all()]


@router.post(
    "/api/v1/projects/{project_id}/features",
    response_model=FeatureResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_feature(
    project_id: str,
    body: FeatureCreate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> FeatureResponse:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    user_id = body.id
    if user_id is not None and not await is_user_id_available(db, project_id, user_id):
        raise _id_conflict(user_id)

    feature = Feature(
        project_id=project_id,
        user_id=user_id,
        title=body.title,
        description=body.description,
        effort=body.effort,
    )
    db.add(feature)
    await db.commit()
    await db.refresh(feature)
    await broadcaster.broadcast(project_id, "feature:created", {"system_id": feature.system_id})
    return FeatureResponse.model_validate(feature)


@router.get("/api/v1/features/{feature_id}", response_model=FeatureResponse)
async def get_feature(feature_id: str, db: AsyncSession = Depends(get_session)) -> FeatureResponse:
    return FeatureResponse.model_validate(await _get_feature_or_404(db, feature_id))


@router.patch("/api/v1/features/{feature_id}", response_model=FeatureResponse)
async def update_feature(
    feature_id: str,
    body: FeatureUpdate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
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
    return FeatureResponse.model_validate(feature)


@router.delete("/api/v1/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature(
    feature_id: str,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> None:
    feature = await _get_feature_or_404(db, feature_id)
    project_id = feature.project_id
    await db.delete(feature)
    await db.commit()
    await broadcaster.broadcast(project_id, "feature:deleted", {"system_id": feature_id})
