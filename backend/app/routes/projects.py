import json
from datetime import date, datetime, timezone
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
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
from app.services.effort import feature_efforts
from app.services.events import broadcaster

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

_IMPORT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


async def _get_or_404(db: AsyncSession, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("/")
async def list_projects(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[ProjectResponse]:
    result = await db.execute(select(Project).order_by(Project.modified_at.desc()))
    return [ProjectResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
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


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    return ProjectResponse.model_validate(await _get_or_404(db, project_id))


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    project = await _get_or_404(db, project_id)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.effort_unit is not None:
        project.effort_unit = body.effort_unit
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
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> None:
    project = await _get_or_404(db, project_id)
    await db.delete(project)
    await db.commit()
    await broadcaster.broadcast(project_id, "project:deleted", {"system_id": project_id})


async def _unique_project_name(db: AsyncSession, base_name: str) -> str:
    name = base_name
    suffix = 1
    while True:
        result = await db.execute(select(Project).where(Project.name == name))
        if not result.scalar_one_or_none():
            return name
        name = f"{base_name} (imported)" if suffix == 1 else f"{base_name} (imported {suffix})"
        suffix += 1


def _validate_import_payload(payload: object) -> dict:
    if not isinstance(payload, dict) or "version" not in payload or "project" not in payload:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_FORMAT", "message": "Missing required top-level fields: version, project"},
        )
    if payload["version"] != "1.0":
        raise HTTPException(
            status_code=422,
            detail={"error": "UNSUPPORTED_VERSION", "message": f"Unsupported export version: {payload['version']}"},
        )
    proj_data = payload["project"]
    if not isinstance(proj_data, dict):
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_FORMAT", "message": "Field 'project' must be an object"},
        )
    for key in ("system_id", "name", "features", "pbis", "pis"):
        if key not in proj_data:
            raise HTTPException(
                status_code=422,
                detail={"error": "INVALID_FORMAT", "message": f"Missing required project field: {key}"},
            )
    return proj_data


def _require_remap(id_map: dict[str, str], old_id: str | None, context: str) -> str:
    if not old_id or old_id not in id_map:
        raise HTTPException(
            status_code=422,
            detail={"error": "DANGLING_REFERENCE", "message": f"Unknown {context} reference: {old_id!r}"},
        )
    return id_map[old_id]


def _build_id_map(proj_data: dict, new_project_id: str) -> dict[str, str]:
    id_map: dict[str, str] = {proj_data["system_id"]: new_project_id}
    for f in proj_data["features"]:
        id_map[f["system_id"]] = str(uuid4())
    for p in proj_data["pbis"]:
        id_map[p["system_id"]] = str(uuid4())
    for pi in proj_data["pis"]:
        id_map[pi["system_id"]] = str(uuid4())
        for sl in pi.get("swimlines", []):
            id_map[sl["system_id"]] = str(uuid4())
            for g in sl.get("groups", []):
                id_map[g["system_id"]] = str(uuid4())
        for s in pi.get("sprints", []):
            id_map[s["system_id"]] = str(uuid4())
    return id_map


def _opt_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _remap(id_map: dict[str, str], old_id: str | None) -> str | None:
    return id_map[old_id] if old_id and old_id in id_map else None


def _add_pi_structures(db: AsyncSession, proj_data: dict, new_project_id: str, id_map: dict[str, str]) -> None:
    for pi in proj_data["pis"]:
        new_pi_id = id_map[pi["system_id"]]
        db.add(PI(
            system_id=new_pi_id,
            project_id=new_project_id,
            name=pi["name"],
            description=pi.get("description"),
            state=pi.get("state", "draft"),
            start_date=_opt_date(pi.get("start_date")),
            end_date=_opt_date(pi.get("end_date")),
        ))
        for sl in pi.get("swimlines", []):
            db.add(Swimline(
                system_id=id_map[sl["system_id"]],
                pi_id=new_pi_id,
                name=sl["name"],
                order_index=sl.get("order_index"),
            ))
        for s in pi.get("sprints", []):
            db.add(Sprint(
                system_id=id_map[s["system_id"]],
                pi_id=new_pi_id,
                sprint_index=s.get("sprint_index"),
                capacity=s.get("capacity") or 0,
                start_date=_opt_date(s.get("start_date")),
                end_date=_opt_date(s.get("end_date")),
            ))


def _add_features(db: AsyncSession, proj_data: dict, new_project_id: str, id_map: dict[str, str]) -> None:
    for f in proj_data["features"]:
        db.add(Feature(
            system_id=id_map[f["system_id"]],
            project_id=new_project_id,
            user_id=f.get("id"),
            title=f["title"],
            description=f.get("description"),
            location=f.get("location", "backlog"),
            pi_id=_remap(id_map, f.get("pi_id")),
            swimlane_id=_remap(id_map, f.get("swimlane_id")),
        ))


def _add_groups(db: AsyncSession, proj_data: dict, id_map: dict[str, str]) -> None:
    for pi in proj_data["pis"]:
        for sl in pi.get("swimlines", []):
            new_sl_id = id_map[sl["system_id"]]
            for g in sl.get("groups", []):
                db.add(Group(
                    system_id=id_map[g["system_id"]],
                    swimline_id=new_sl_id,
                    feature_system_id=_require_remap(id_map, g.get("feature_system_id"), "feature"),
                    name=g["name"],
                    sprint_index=g.get("sprint_index"),
                    order_index=g.get("order_index"),
                    is_implicit=False,
                ))


def _add_pbis(db: AsyncSession, proj_data: dict, new_project_id: str, id_map: dict[str, str]) -> None:
    for p in proj_data["pbis"]:
        db.add(PBI(
            system_id=id_map[p["system_id"]],
            project_id=new_project_id,
            user_id=p.get("id"),
            parent_feature_system_id=_require_remap(id_map, p.get("parent_feature_system_id"), "feature"),
            title=p["title"],
            description=p.get("description"),
            effort=p.get("effort"),
            location=p.get("location", "backlog"),
            pi_id=_remap(id_map, p.get("pi_id")),
            swimlane_id=_remap(id_map, p.get("swimlane_id")),
            group_id=_remap(id_map, p.get("group_id")),
        ))


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_project(
    file: UploadFile,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    raw = await file.read(_IMPORT_MAX_BYTES + 1)
    if len(raw) > _IMPORT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail={"error": "FILE_TOO_LARGE", "message": "Import file must be ≤ 10 MB"},
        )
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON", "message": str(exc)})

    proj_data = _validate_import_payload(payload)
    resolved_name = await _unique_project_name(db, proj_data["name"])

    new_project_id = str(uuid4())
    id_map = _build_id_map(proj_data, new_project_id)

    project = Project(
        system_id=new_project_id,
        name=resolved_name,
        description=proj_data.get("description"),
        effort_unit=proj_data.get("effort_unit", "pts"),
    )
    db.add(project)
    _add_pi_structures(db, proj_data, new_project_id, id_map)
    await db.flush()

    _add_features(db, proj_data, new_project_id, id_map)
    await db.flush()

    _add_groups(db, proj_data, id_map)
    await db.flush()

    _add_pbis(db, proj_data, new_project_id, id_map)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "NAME_TAKEN", "message": f"A project named '{resolved_name}' already exists"},
        )
    # No SSE broadcast: brand-new project has no subscribers yet.
    await db.refresh(project)
    return ProjectResponse.model_validate(project)


@router.get("/{project_id}/export")
async def export_project(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> Response:
    project = await _get_or_404(db, project_id)

    features_result = await db.execute(
        select(Feature).where(Feature.project_id == project_id).order_by(Feature.created_at)
    )
    features = features_result.scalars().all()
    feat_efforts = await feature_efforts(db, [f.system_id for f in features])

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
            "effort_unit": project.effort_unit,
            "created_at": project.created_at.isoformat(),
            "modified_at": project.modified_at.isoformat(),
            "features": [
                {
                    "system_id": f.system_id,
                    "id": f.user_id,
                    "title": f.title,
                    "description": f.description,
                    "effort": feat_efforts.get(f.system_id, 0),
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
