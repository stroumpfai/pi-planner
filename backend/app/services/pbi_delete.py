"""Moving or deleting a PBI without leaving its group behind.

A group that has just lost its last story is dead weight on the PI board — and an
implicit group is worse than that: it exists only to carry one directly-placed
story, so once the story is gone it renders as a card whose "Unplace" button points
at nothing. SQLite runs without ``PRAGMA foreign_keys``, so the ``ON DELETE CASCADE``
declared on ``Group.story_system_id`` never fires; the cleanup has to be explicit.

Every path that deletes a single PBI (the DELETE route, CSV-import removals) or
takes one out of its group (split, cancel-continuation, a CSV-import re-parent) goes
through here so they cannot drift apart again.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.models.pbi import PBI


async def delete_pbi_and_empty_group(db: AsyncSession, pbi: PBI) -> str | None:
    """Delete ``pbi``, dropping its group too when that empties it.

    Returns the deleted group's ``system_id``, or ``None`` when no group was
    removed, so the caller can broadcast ``group:deleted``. The caller commits.
    """
    group_id = pbi.group_id
    await db.delete(pbi)
    await db.flush()

    if not group_id:
        return None

    remaining = (await db.execute(
        select(func.count()).where(PBI.group_id == group_id)
    )).scalar_one()
    if remaining:
        return None

    group = await db.get(Group, group_id)
    if group is None:
        return None
    await db.delete(group)
    return group_id


async def detach_pbi_from_group(db: AsyncSession, pbi: PBI) -> str | None:
    """Take ``pbi`` out of its group, dropping the group if that empties it.

    Only an *implicit* group is dropped. An explicit one was named by a human
    during planning, so an empty one is a container they can still drop stories
    back into — losing it because an import moved the last story out would destroy
    a planning decision the CSV knows nothing about.

    Returns the deleted group's ``system_id`` for ``group:deleted``, else None.
    """
    old_group_id = pbi.group_id
    if not old_group_id:
        return None

    pbi.group_id = None
    await db.flush()

    remaining = (await db.execute(
        select(func.count()).where(PBI.group_id == old_group_id)
    )).scalar_one()
    if remaining:
        return None

    group = await db.get(Group, old_group_id)
    if group is None or not group.is_implicit:
        return None
    await db.delete(group)
    return old_group_id
