from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_edit_lock
from app.models.project import Project
from app.models.project_state import ProjectState
from app.models.user import User
from app.schemas.project_state import (
    ProjectStateCreate,
    ProjectStateReorder,
    ProjectStateResponse,
    ProjectStateUpdate,
)
from app.services.events import broadcaster
from app.services.project_state import find_state, get_or_create_state, list_states, state_usage

router = APIRouter(prefix="/api/v1/projects/{project_id}/states", tags=["states"])


async def _require_project(db: AsyncSession, project_id: str) -> Project:
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _require_state(db: AsyncSession, project_id: str, state_id: str) -> ProjectState:
    state = await db.get(ProjectState, state_id)
    if state is None or state.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="State not found")
    return state


def _value_taken(value: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "STATE_VALUE_TAKEN",
            "message": f"This list already contains '{value}'",
        },
    )


@router.get("/")
async def list_project_states(
    project_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[ProjectStateResponse]:
    """All three State Lists for the project, ordered by item type then position."""
    await _require_project(db, project_id)
    return [ProjectStateResponse.model_validate(s) for s in await list_states(db, project_id)]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_project_state(
    project_id: str,
    body: ProjectStateCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> ProjectStateResponse:
    """Add a State to a list. Refused when the list already holds this value."""
    await _require_project(db, project_id)
    clash = await find_state(db, project_id, body.item_type, body.value)
    if clash is not None:
        raise _value_taken(clash.value)

    state = await get_or_create_state(db, project_id, body.item_type, body.value)
    if state is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "EMPTY_STATE", "message": "A State cannot be blank"},
        )
    await db.commit()
    await db.refresh(state)
    await broadcaster.broadcast(project_id, "state:created", {"system_id": state.system_id})
    return ProjectStateResponse.model_validate(state)


@router.delete("/{state_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_state(
    project_id: str,
    state_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> None:
    """Remove a State from its list. Refused while any item still holds it."""
    await _require_project(db, project_id)
    state = await _require_state(db, project_id, state_id)

    features, pbis = await state_usage(db, state_id)
    if features or pbis:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "STATE_IN_USE",
                "message": (
                    f"'{state.value}' is still used by {features + pbis} "
                    f"item{'s' if features + pbis != 1 else ''}"
                ),
                "details": {"features": features, "pbis": pbis},
            },
        )

    await db.delete(state)
    await db.commit()
    await broadcaster.broadcast(project_id, "state:deleted", {"system_id": state_id})


@router.patch("/{state_id}")
async def rename_project_state(
    project_id: str,
    state_id: str,
    body: ProjectStateUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> ProjectStateResponse:
    """Rename a State. Items reference it by id, so every one of them follows."""
    await _require_project(db, project_id)
    state = await _require_state(db, project_id, state_id)

    clash = await find_state(db, project_id, state.item_type, body.value)
    if clash is not None and clash.system_id != state_id:
        raise _value_taken(clash.value)

    state.value = body.value.strip()
    await db.commit()
    await db.refresh(state)
    await broadcaster.broadcast(project_id, "state:updated", {"system_id": state.system_id})
    return ProjectStateResponse.model_validate(state)


@router.post("/reorder")
async def reorder_project_states(
    project_id: str,
    body: ProjectStateReorder,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_edit_lock)],
) -> list[ProjectStateResponse]:
    """Set the display order of one list. The other two lists are untouched."""
    await _require_project(db, project_id)
    states = await list_states(db, project_id, body.item_type)
    by_id = {s.system_id: s for s in states}

    for state_id in body.order:
        if state_id not in by_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": "UNKNOWN_STATE",
                    "message": f"No such State for {body.item_type} items in this project",
                },
            )

    for index, state_id in enumerate(body.order):
        by_id[state_id].position = index

    await db.commit()
    await broadcaster.broadcast(
        project_id, "state:reordered", {"item_type": body.item_type}
    )
    return [
        ProjectStateResponse.model_validate(s)
        for s in await list_states(db, project_id, body.item_type)
    ]
