from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import require_editor_or_above
from app.models.activity_log import ActorType
from app.models.edit_lock import EditLock
from app.models.feature import Feature
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.project import Project
from app.models.project_snapshot import ProjectSnapshot
from app.models.project_state import ProjectState
from app.models.user import User
from app.schemas import (
    ProjectResponse,
    SnapshotCreate,
    SnapshotDiffResponse,
    SnapshotResponse,
)
from app.services.activity import log_activity
from app.services.events import broadcaster
from app.services.snapshot import (
    restore_continuations_and_stories,
    restore_features,
    restore_groups,
    restore_pbis,
    restore_pi_structures,
    restore_states,
    serialize_project,
)
from app.services.snapshot_diff import diff_project_states
from app.services.snapshot_diff_html import render_diff_html

router = APIRouter(prefix="/api/v1/projects/{project_id}/snapshots", tags=["project-snapshots"])


async def _get_project_or_404(db: AsyncSession, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _get_snapshot_or_404(db: AsyncSession, project_id: str, snapshot_id: str) -> ProjectSnapshot:
    snapshot = await db.get(ProjectSnapshot, snapshot_id)
    if not snapshot or snapshot.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return snapshot


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_snapshot(
    project_id: str,
    body: SnapshotCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_editor_or_above)],
) -> SnapshotResponse:
    project = await _get_project_or_404(db, project_id)
    snapshot_data = await serialize_project(db, project)

    snapshot = ProjectSnapshot(
        project_id=project_id,
        name=body.name,
        created_by=current_user.username,
        snapshot_data=snapshot_data,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)

    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="snapshot.create",
        resource_type="snapshot",
        resource_id=snapshot.system_id,
        project_id=project_id,
        details={"name": snapshot.name},
    )
    await broadcaster.broadcast(
        project_id, "snapshot:created", {"system_id": snapshot.system_id, "name": snapshot.name}
    )
    return SnapshotResponse.model_validate(snapshot)


@router.get("/")
async def list_snapshots(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> list[SnapshotResponse]:
    await _get_project_or_404(db, project_id)
    result = await db.execute(
        select(ProjectSnapshot)
        .where(ProjectSnapshot.project_id == project_id)
        .order_by(ProjectSnapshot.created_at.desc())
    )
    return [SnapshotResponse.model_validate(s) for s in result.scalars().all()]


async def _resolve_baseline(
    db: AsyncSession, project_id: str, snapshot_id: str | None
) -> ProjectSnapshot:
    """The named snapshot, or the newest one when ``snapshot_id`` is omitted."""
    if snapshot_id:
        return await _get_snapshot_or_404(db, project_id, snapshot_id)
    result = await db.execute(
        select(ProjectSnapshot)
        .where(ProjectSnapshot.project_id == project_id)
        .order_by(ProjectSnapshot.created_at.desc())
        .limit(1)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No snapshot to diff against",
        )
    return snapshot


async def _build_diff(
    db: AsyncSession, project_id: str, snapshot_id: str | None, pi_id: str | None
) -> dict[str, Any]:
    project = await _get_project_or_404(db, project_id)
    if pi_id is not None:
        pi = await db.get(PI, pi_id)
        if not pi or pi.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")
    snapshot = await _resolve_baseline(db, project_id, snapshot_id)

    baseline_project = snapshot.snapshot_data["project"]
    current_project = (await serialize_project(db, project))["project"]
    meta = {
        "system_id": snapshot.system_id,
        "name": snapshot.name,
        "created_at": snapshot.created_at.isoformat(),
        "created_by": snapshot.created_by,
    }
    return diff_project_states(
        baseline_project, current_project, snapshot_meta=meta, pi_id=pi_id
    )


@router.get("/diff")
async def diff_snapshot(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    snapshot_id: Annotated[str | None, Query()] = None,
    pi_id: Annotated[str | None, Query()] = None,
) -> SnapshotDiffResponse:
    """Diff the live project against a snapshot (latest when snapshot_id omitted).

    Pass ``pi_id`` to scope the diff to a single PI (including items moved into or
    out of it). Returns per-entity added/removed/changed lists, a summary with an
    effort delta, and a natural-language narrative.
    """
    diff = await _build_diff(db, project_id, snapshot_id, pi_id)
    return SnapshotDiffResponse(**diff)


@router.get("/diff/html", response_class=HTMLResponse)
async def diff_snapshot_html(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    snapshot_id: Annotated[str | None, Query()] = None,
    pi_id: Annotated[str | None, Query()] = None,
    refresh_seconds: Annotated[int, Query(ge=0, le=3600)] = 0,
) -> HTMLResponse:
    """Self-contained HTML rendering of the snapshot diff (twin of /diff)."""
    diff = await _build_diff(db, project_id, snapshot_id, pi_id)
    return HTMLResponse(render_diff_html(diff, refresh_seconds))


@router.delete("/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_snapshot(
    project_id: str,
    snapshot_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    snapshot = await _get_snapshot_or_404(db, project_id, snapshot_id)
    await db.delete(snapshot)
    await db.commit()

    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="snapshot.delete",
        resource_type="snapshot",
        resource_id=snapshot_id,
        project_id=project_id,
        details={"name": snapshot.name},
    )
    await broadcaster.broadcast(project_id, "snapshot:deleted", {"system_id": snapshot_id})


@router.post("/{snapshot_id}/restore")
async def restore_snapshot(
    project_id: str,
    snapshot_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    current_user: Annotated[User, Depends(require_editor_or_above)],
) -> ProjectResponse:
    project = await _get_project_or_404(db, project_id)
    snapshot = await _get_snapshot_or_404(db, project_id, snapshot_id)

    # 1. Auto safety-snapshot of the current state before we wipe anything.
    safety_data = await serialize_project(db, project)
    safety_name = (
        f'Before restoring "{snapshot.name}" — '
        f'{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")}'
    )
    safety_snapshot = ProjectSnapshot(
        project_id=project_id,
        name=safety_name,
        created_by=current_user.username,
        snapshot_data=safety_data,
    )
    db.add(safety_snapshot)
    await db.flush()

    # 2. Wipe current PBIs, Features, then PIs (cascades remove Swimlines/Sprints/Groups).
    await db.execute(delete(PBI).where(PBI.project_id == project_id))
    await db.execute(delete(Feature).where(Feature.project_id == project_id))
    await db.flush()
    # States only after the items that reference them — the FK is RESTRICT.
    await db.execute(delete(ProjectState).where(ProjectState.project_id == project_id))
    await db.flush()
    pi_result = await db.execute(select(PI).where(PI.project_id == project_id))
    for pi in pi_result.scalars().all():
        await db.delete(pi)
    await db.flush()

    # 3. Rebuild in place from the snapshot payload, preserving original system_ids.
    proj_data = snapshot.snapshot_data["project"]

    restore_pi_structures(db, proj_data, project_id)
    await db.flush()

    # States first: features and PBIs FK to them.
    restore_states(db, proj_data, project_id)
    await db.flush()

    restore_features(db, proj_data, project_id)
    await db.flush()

    restore_groups(db, proj_data)
    await db.flush()

    restore_pbis(db, proj_data, project_id)
    await db.flush()

    # Second pass: link references that point at rows created in this same rebuild
    # (feature→feature continuation, group→story PBI), which cannot be set at insert time.
    await restore_continuations_and_stories(db, proj_data)

    # 4. Restore project-level fields (keep current name to avoid unique-constraint issues).
    project.description = proj_data.get("description")
    project.effort_unit = proj_data.get("effort_unit", "pts")
    project.azure_devops_url = proj_data.get("azure_devops_url")
    project.work_item_path_template = proj_data.get("work_item_path_template")
    project.modified_at = datetime.now(timezone.utc)

    # 5. Release the edit lock if one is held.
    lock_result = await db.execute(select(EditLock).where(EditLock.project_id == project_id))
    lock = lock_result.scalar_one_or_none()
    if lock:
        lock.expires_at = datetime.now(timezone.utc)

    await db.commit()

    await log_activity(
        db,
        actor_type=ActorType.human,
        actor_username=current_user.username,
        action="snapshot.restore",
        resource_type="snapshot",
        resource_id=snapshot.system_id,
        project_id=project_id,
        details={
            "snapshot_id": snapshot.system_id,
            "snapshot_name": snapshot.name,
            "safety_snapshot_id": safety_snapshot.system_id,
        },
    )

    if lock:
        await broadcaster.broadcast(project_id, "edit-lock:released", {"released_by": current_user.username})

    await broadcaster.broadcast(project_id, "project:restored", {
        "system_id": project_id,
        "snapshot_id": snapshot.system_id,
        "snapshot_name": snapshot.name,
        "safety_snapshot_id": safety_snapshot.system_id,
    })

    await db.refresh(project)
    return ProjectResponse.model_validate(project)
