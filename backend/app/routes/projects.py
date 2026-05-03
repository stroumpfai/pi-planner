from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.feature import Feature
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.models.group import Group
from app.models.user import User
from app.schemas import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services.events import broadcaster

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


async def _get_or_404(db: AsyncSession, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(db: AsyncSession = Depends(get_session)) -> list[ProjectResponse]:
    result = await db.execute(select(Project).order_by(Project.modified_at.desc()))
    return [ProjectResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> ProjectResponse:
    project = Project(name=body.name, description=body.description)
    db.add(project)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "NAME_TAKEN", "message": f"A project named '{body.name}' already exists"},
        )
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: AsyncSession = Depends(get_session)) -> ProjectResponse:
    return ProjectResponse.model_validate(await _get_or_404(db, project_id))


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> ProjectResponse:
    project = await _get_or_404(db, project_id)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    project.modified_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "NAME_TAKEN", "message": f"A project named '{body.name}' already exists"},
        )
    await db.refresh(project)
    await broadcaster.broadcast(project_id, "project:updated", {"system_id": project_id})
    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
) -> None:
    project = await _get_or_404(db, project_id)
    await db.delete(project)
    await db.commit()
    await broadcaster.broadcast(project_id, "project:deleted", {"system_id": project_id})


@router.get("/{project_id}/export")
async def export_project(
    project_id: str,
    db: AsyncSession = Depends(get_session),
) -> Response:
    project = await _get_or_404(db, project_id)

    features_result = await db.execute(
        select(Feature).where(Feature.project_id == project_id).order_by(Feature.created_at)
    )
    features = features_result.scalars().all()

    pbis_result = await db.execute(
        select(PBI).where(PBI.project_id == project_id).order_by(PBI.created_at)
    )
    pbis = pbis_result.scalars().all()

    pis_result = await db.execute(
        select(PI).where(PI.project_id == project_id).order_by(PI.created_at)
    )
    pis = pis_result.scalars().all()

    pi_data = []
    for pi in pis:
        swimlines_result = await db.execute(
            select(Swimline).where(Swimline.pi_id == pi.system_id).order_by(Swimline.order_index)
        )
        swimlines = swimlines_result.scalars().all()

        swimline_data = []
        for sl in swimlines:
            groups_result = await db.execute(
                select(Group).where(Group.swimline_id == sl.system_id).order_by(Group.sprint_index, Group.order_index)
            )
            groups = groups_result.scalars().all()
            swimline_data.append({
                "system_id": sl.system_id,
                "name": sl.name,
                "order_index": sl.order_index,
                "groups": [
                    {
                        "system_id": g.system_id,
                        "name": g.name,
                        "feature_system_id": g.feature_system_id,
                        "sprint_index": g.sprint_index,
                        "order_index": g.order_index,
                    }
                    for g in groups
                ],
            })

        sprints_result = await db.execute(
            select(Sprint).where(Sprint.pi_id == pi.system_id).order_by(Sprint.sprint_index)
        )
        sprints = sprints_result.scalars().all()

        pi_data.append({
            "system_id": pi.system_id,
            "name": pi.name,
            "description": pi.description,
            "state": pi.state,
            "start_date": pi.start_date.isoformat() if pi.start_date else None,
            "end_date": pi.end_date.isoformat() if pi.end_date else None,
            "created_at": pi.created_at.isoformat(),
            "modified_at": pi.modified_at.isoformat(),
            "swimlines": swimline_data,
            "sprints": [
                {
                    "system_id": s.system_id,
                    "sprint_index": s.sprint_index,
                    "capacity": s.capacity,
                    "start_date": s.start_date.isoformat() if s.start_date else None,
                    "end_date": s.end_date.isoformat() if s.end_date else None,
                }
                for s in sprints
            ],
        })

    payload = {
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "project": {
            "system_id": project.system_id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at.isoformat(),
            "modified_at": project.modified_at.isoformat(),
            "features": [
                {
                    "system_id": f.system_id,
                    "id": f.user_id,
                    "title": f.title,
                    "description": f.description,
                    "effort": f.effort,
                    "location": f.location,
                    "pi_id": f.pi_id,
                    "swimlane_id": f.swimlane_id,
                    "created_at": f.created_at.isoformat(),
                    "modified_at": f.modified_at.isoformat(),
                }
                for f in features
            ],
            "pbis": [
                {
                    "system_id": p.system_id,
                    "id": p.user_id,
                    "parent_feature_system_id": p.parent_feature_system_id,
                    "title": p.title,
                    "description": p.description,
                    "effort": p.effort,
                    "location": p.location,
                    "pi_id": p.pi_id,
                    "swimlane_id": p.swimlane_id,
                    "group_id": p.group_id,
                    "created_at": p.created_at.isoformat(),
                    "modified_at": p.modified_at.isoformat(),
                }
                for p in pbis
            ],
            "pis": pi_data,
        },
    }

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    safe_name = project.name.replace(" ", "_").replace("/", "-")
    filename = f"{safe_name}_{date_str}.json"

    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
