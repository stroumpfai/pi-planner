"""Maintain ``pbis.completed_on`` across State changes (team-achievement.md §4.1, §4.2).

This is the only module that writes ``completed_on``. Every write of ``PBI.state_id`` —
the REST create and update, and both CSV import paths — must go through
``apply_completion``; a site that skips it silently stops stamping, and an import is the
main way items become done.

Stamping fires on the *edge* into a done-category State, never on the level: an item
already done that stays done keeps its date, and recategorising a State touches no item.
"""

from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pbi import PBI
from app.models.project_state import ProjectState

DONE_CATEGORY = "done"


def is_done(state: ProjectState | None) -> bool:
    """Whether a State counts as finished. Declared by its category, never its wording."""
    return state is not None and state.category == DONE_CATEGORY


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _same_state(a: ProjectState | None, b: ProjectState | None) -> bool:
    if a is None or b is None:
        return a is b
    return a.system_id == b.system_id


def apply_completion(
    pbi: PBI,
    old_state: ProjectState | None,
    new_state: ProjectState | None,
    *,
    explicit_date: date | None = None,
    today: date | None = None,
) -> None:
    """Update ``pbi.completed_on`` for a write that moved it from ``old_state`` to ``new_state``.

    ``old_state`` is the State the item held *before* this write (None for a create or a
    stateless item). Rules:

    - Moving to a non-done State — uncategorised or no State included — clears the date.
    - Entering a done State from a non-done one stamps ``today`` while the date is null.
    - Done and staying done (same State, or another done State) keeps the date as it is,
      including no date at all ("done but undated", §9.2).
    - ``explicit_date`` wins over the stamp and over a kept date, but only for an item
      that ends up done; callers refuse or report it otherwise.
    - No State change at all changes nothing else, so a State recategorised after the
      fact never rewrites the items holding it.
    """
    if not is_done(new_state):
        if not _same_state(old_state, new_state):
            pbi.completed_on = None
        return
    if explicit_date is not None:
        pbi.completed_on = explicit_date
        return
    if not is_done(old_state) and pbi.completed_on is None:
        pbi.completed_on = today if today is not None else utc_today()


def clear_completion(pbi: PBI) -> bool:
    """Remove ``pbi.completed_on`` whatever its State. Returns whether a date was removed.

    For a source that says the item has no completion date — a CSV row whose date
    columns are present but blank (§4.3) — rather than for a State change.
    """
    if pbi.completed_on is None:
        return False
    pbi.completed_on = None
    return True


async def load_state(db: AsyncSession, state_id: str | None) -> ProjectState | None:
    """Fetch a State by id, bypassing ``PBI.state``, which is stale once ``state_id`` moves."""
    if state_id is None:
        return None
    return await db.get(ProjectState, state_id)
