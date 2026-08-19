"""State List operations.

A project owns three independent State Lists, keyed by item type (feature / story / bug).
Entries are compared after trimming and lower-casing; the first spelling seen is stored.
This module is the only place that creates State entries, so the dedupe rule applies
identically to CSV import and to the States editor.
"""

from typing import NamedTuple

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.pbi import PBI
from app.models.project_state import ProjectState, normalise_state


async def list_states(
    db: AsyncSession, project_id: str, item_type: str | None = None
) -> list[ProjectState]:
    stmt = select(ProjectState).where(ProjectState.project_id == project_id)
    if item_type is not None:
        stmt = stmt.where(ProjectState.item_type == item_type)
    stmt = stmt.order_by(
        ProjectState.item_type.asc(),
        ProjectState.position.asc(),
        ProjectState.created_at.asc(),
    )
    return list((await db.execute(stmt)).scalars().all())


async def find_state(
    db: AsyncSession, project_id: str, item_type: str, value: str
) -> ProjectState | None:
    """Look a State up by value, ignoring case and surrounding whitespace."""
    key = normalise_state(value)
    if key == "":
        return None
    result = await db.execute(
        select(ProjectState).where(
            ProjectState.project_id == project_id,
            ProjectState.item_type == item_type,
            func.lower(ProjectState.value) == key,
        )
    )
    return result.scalar_one_or_none()


async def _next_position(db: AsyncSession, project_id: str, item_type: str) -> int:
    result = await db.execute(
        select(func.max(ProjectState.position)).where(
            ProjectState.project_id == project_id,
            ProjectState.item_type == item_type,
        )
    )
    current_max = result.scalar_one_or_none()
    return 0 if current_max is None else current_max + 1


async def get_or_create_state(
    db: AsyncSession, project_id: str, item_type: str, value: str
) -> ProjectState | None:
    """Return the State for this value, adding it to the list if new.

    The state is None for a blank value — blank is the absence of a State, never an
    entry.

    Does not commit; the caller owns the transaction so that a failed import registers
    no vocabulary.
    """
    if normalise_state(value) == "":
        return None

    existing = await find_state(db, project_id, item_type, value)
    if existing is not None:
        return existing

    state = ProjectState(
        project_id=project_id,
        item_type=item_type,
        value=value.strip(),  # first spelling seen wins
        position=await _next_position(db, project_id, item_type),
    )
    db.add(state)
    await db.flush()
    return state


async def state_usage(db: AsyncSession, state_id: str) -> tuple[int, int]:
    """Return (feature_count, pbi_count) of items currently holding this State."""
    features = (await db.execute(
        select(func.count()).select_from(Feature).where(Feature.state_id == state_id)
    )).scalar_one()
    pbis = (await db.execute(
        select(func.count()).select_from(PBI).where(PBI.state_id == state_id)
    )).scalar_one()
    return int(features), int(pbis)


def state_item_type_for_pbi(item_type: str) -> str:
    """Stories and Bugs draw from separate State Lists."""
    return "bug" if item_type == "bug" else "story"


class StateAssignment(NamedTuple):
    """What an update body says about an item's State."""

    changed: bool
    state_id: str | None


async def validate_state_id(
    db: AsyncSession, project_id: str, item_type: str, state_id: str | None
) -> str | None:
    """Check that a state_id names an entry in this project's list for `item_type`.

    Returns the id back (None stays None) so callers can assign the result directly.
    """
    if state_id is None:
        return None
    state = await db.get(ProjectState, state_id)
    if state is None or state.project_id != project_id or state.item_type != item_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "UNKNOWN_STATE",
                "message": f"No such State for {item_type} items in this project",
            },
        )
    return state.system_id


async def resolve_state_assignment(
    db: AsyncSession,
    project_id: str,
    item_type: str,
    fields: set[str],
    state_id: str | None,
) -> StateAssignment:
    """Interpret the state_id on an update body.

    States are never created here: an item write can only point at an entry the States
    editor or a CSV import already put in the list. Explicit null clears the State.
    """
    if "state_id" in fields:
        return StateAssignment(
            changed=True,
            state_id=await validate_state_id(db, project_id, item_type, state_id),
        )

    return StateAssignment(changed=False, state_id=None)
