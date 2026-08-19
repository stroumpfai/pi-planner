import json
from datetime import date, datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, update as sql_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.pi_event import PIEvent
from app.models.project import Project
from app.models.project_state import ProjectState
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.models.user import User
from app.schemas import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services.events import broadcaster
from app.services.snapshot import serialize_project

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
    _: Annotated[User, Depends(require_editor_or_above)],
) -> ProjectResponse:
    project = Project(
        name=body.name,
        description=body.description,
        azure_devops_url=body.azure_devops_url,
        work_item_path_template=body.work_item_path_template,
    )
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
    _: Annotated[User, Depends(require_editor_or_above)],
) -> ProjectResponse:
    project = await _get_or_404(db, project_id)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if "azure_devops_url" in body.model_fields_set:
        # Explicitly provided (incl. null/"" to clear); validator normalized "" -> None.
        project.azure_devops_url = body.azure_devops_url
    if "work_item_path_template" in body.model_fields_set:
        # Explicitly provided (incl. null/"" to clear); validator normalized "" -> None.
        project.work_item_path_template = body.work_item_path_template
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
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    project = await _get_or_404(db, project_id)
    # Group.story_system_id -> PBI and PBI.group_id -> Group form a cycle that SQLAlchemy's
    # unit-of-work cannot topologically sort during the cascade delete (implicit groups point
    # back at their story PBI). Break it by nulling story links first (cf. clear_all_features).
    feature_ids = select(Feature.system_id).where(Feature.project_id == project_id)
    await db.execute(
        sql_update(Group).where(Group.feature_system_id.in_(feature_ids)).values(story_system_id=None)
    )
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


def _validate_import_payload(payload: object) -> dict[str, Any]:
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


def _build_id_map(proj_data: dict[str, Any], new_project_id: str) -> dict[str, str]:
    id_map: dict[str, str] = {proj_data["system_id"]: new_project_id}
    for st in proj_data.get("states", []):
        id_map[st["system_id"]] = str(uuid4())
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
        for e in pi.get("events", []):
            id_map[e["system_id"]] = str(uuid4())
    return id_map


def _opt_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _remap(id_map: dict[str, str], old_id: str | None) -> str | None:
    return id_map[old_id] if old_id and old_id in id_map else None


def _add_pi_structures(
    db: AsyncSession, proj_data: dict[str, Any], new_project_id: str, id_map: dict[str, str]
) -> None:
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
        for e in pi.get("events", []):
            db.add(PIEvent(
                system_id=id_map[e["system_id"]],
                pi_id=new_pi_id,
                name=e["name"],
                event_date=_opt_date(e.get("event_date")),
                event_type=e.get("event_type", "other"),
            ))


def _add_states(db: AsyncSession, proj_data: dict[str, Any], new_project_id: str, id_map: dict[str, str]) -> None:
    """Rebuild the three State Lists. Must run before features/PBIs, which FK to them.

    Exports predating States have no "states" key; those import with empty lists, and
    ``_remap`` then leaves every item stateless.
    """
    for st in proj_data.get("states", []):
        db.add(ProjectState(
            system_id=id_map[st["system_id"]],
            project_id=new_project_id,
            item_type=st["item_type"],
            value=st["value"],
            position=st.get("position", 0),
            category=st.get("category"),
        ))


def _add_features(db: AsyncSession, proj_data: dict[str, Any], new_project_id: str, id_map: dict[str, str]) -> None:
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
            state_id=_remap(id_map, f.get("state_id")),
        ))


def _add_groups(db: AsyncSession, proj_data: dict[str, Any], id_map: dict[str, str]) -> None:
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
                    is_implicit=g.get("is_implicit", False),
                ))


def _add_pbis(db: AsyncSession, proj_data: dict[str, Any], new_project_id: str, id_map: dict[str, str]) -> None:
    for p in proj_data["pbis"]:
        db.add(PBI(
            system_id=id_map[p["system_id"]],
            project_id=new_project_id,
            user_id=p.get("id"),
            parent_feature_system_id=_require_remap(id_map, p.get("parent_feature_system_id"), "feature"),
            title=p["title"],
            description=p.get("description"),
            effort=p.get("effort"),
            item_type=p.get("item_type", "story"),
            location=p.get("location", "backlog"),
            pi_id=_remap(id_map, p.get("pi_id")),
            swimlane_id=_remap(id_map, p.get("swimlane_id")),
            group_id=_remap(id_map, p.get("group_id")),
            state_id=_remap(id_map, p.get("state_id")),
        ))


async def _link_continuations_and_stories(
    db: AsyncSession, proj_data: dict[str, Any], id_map: dict[str, str]
) -> None:
    """Second pass, run after features/groups/PBIs are flushed.

    Sets references that point at rows created in this same import (feature→feature
    continuation, group→story PBI). Best-effort: a continuation whose origin is absent
    from the payload is silently dropped (``_remap`` returns ``None``).
    """
    for f in proj_data["features"]:
        if f.get("continued_from_feature_id"):
            feature = await db.get(Feature, id_map[f["system_id"]])
            if feature is not None:
                feature.continued_from_feature_id = _remap(id_map, f["continued_from_feature_id"])
    for pi in proj_data["pis"]:
        for sl in pi.get("swimlines", []):
            for g in sl.get("groups", []):
                if g.get("story_system_id"):
                    group = await db.get(Group, id_map[g["system_id"]])
                    if group is not None:
                        group.story_system_id = _remap(id_map, g["story_system_id"])
    await db.flush()


@router.post(
    "/import",
    status_code=status.HTTP_201_CREATED,
    responses={422: {"description": "Invalid or malformed import payload"}},
)
async def import_project(
    file: UploadFile,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
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
        azure_devops_url=proj_data.get("azure_devops_url"),
        work_item_path_template=proj_data.get("work_item_path_template"),
        effort_unit=proj_data.get("effort_unit", "pts"),
    )
    db.add(project)
    _add_pi_structures(db, proj_data, new_project_id, id_map)
    await db.flush()

    # States first: features and PBIs FK to them.
    _add_states(db, proj_data, new_project_id, id_map)
    await db.flush()

    _add_features(db, proj_data, new_project_id, id_map)
    await db.flush()

    _add_groups(db, proj_data, id_map)
    await db.flush()

    _add_pbis(db, proj_data, new_project_id, id_map)
    await db.flush()

    await _link_continuations_and_stories(db, proj_data, id_map)
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
    _: Annotated[User, Depends(require_editor_or_above)],
) -> Response:
    project = await _get_or_404(db, project_id)

    payload = await serialize_project(db, project)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    safe_name = project.name.replace(" ", "_").replace("/", "-")
    filename = f"{safe_name}_{date_str}.json"

    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
