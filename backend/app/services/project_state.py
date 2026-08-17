"""State List operations.

A project owns three independent State Lists, keyed by item type (feature / story / bug).
Entries are compared after trimming and lower-casing; the first spelling seen is stored.
This module is the only place that creates State entries, so the dedupe rule applies
identically to CSV import and to values typed in the item modals.
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
) -> tuple[ProjectState | None, bool]:
    """Return (state, was_created) for this value, adding it to the list if new.

    The state is None for a blank value — blank is the absence of a State, never an
    entry. `was_created` lets callers broadcast `state:created` after they commit, so
    other sessions refresh their dropdowns.

    Does not commit; the caller owns the transaction so that a failed import registers
    no vocabulary.
    """
    if normalise_state(value) == "":
        return None, False

    existing = await find_state(db, project_id, item_type, value)
    if existing is not None:
        return existing, False

    state = ProjectState(
        project_id=project_id,
        item_type=item_type,
        value=value.strip(),  # first spelling seen wins
        position=await _next_position(db, project_id, item_type),
    )
    db.add(state)
    await db.flush()
    return state, True


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
    """What an update body says about an item's State.

    `created` is true when resolving the value added a new entry to the list, so the
    caller can broadcast `state:created` after committing.
    """

    changed: bool
    state_id: str | None
    created: bool = False


async def resolve_state_assignment(
    db: AsyncSession,
    project_id: str,
    item_type: str,
    fields: set[str],
    state_id: str | None,
    state_value: str | None,
) -> StateAssignment:
    """Interpret the state_id / state_value pair on an update body.

    `state_value` wins when both are sent: it is the field the modal uses when a user
    types a State that may not exist yet.
    """
    if "state_value" in fields:
        if state_value is None or normalise_state(state_value) == "":
            return StateAssignment(changed=True, state_id=None)
        state, created = await get_or_create_state(db, project_id, item_type, state_value)
        return StateAssignment(
            changed=True,
            state_id=state.system_id if state else None,
            created=created,
        )

    if "state_id" in fields:
        if state_id is None:
            return StateAssignment(changed=True, state_id=None)
        state = await db.get(ProjectState, state_id)
        if state is None or state.project_id != project_id or state.item_type != item_type:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "error": "UNKNOWN_STATE",
                    "message": f"No such State for {item_type} items in this project",
                },
            )
        return StateAssignment(changed=True, state_id=state.system_id)

    return StateAssignment(changed=False, state_id=None)
