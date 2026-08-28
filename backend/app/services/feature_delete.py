"""Deleting a Feature, including everything the deletion takes with it.

Two things make this more than ``db.delete(feature)``.

**The reference cycle.** ``PBI.group_id`` points at ``groups`` and
``Group.story_system_id`` points back at ``pbis``. A Feature cascades to both
collections in one flush, so the unit-of-work cannot order the two DELETE sets
and raises ``CircularDependencyError`` — a 500 for any feature holding a story
that has been placed in a sprint, which is every feature planned onto a board.
Clearing both links first splits the cycle into two independent sets.
``clear_all_features`` solves the same problem for a whole project in raw SQL;
this is the same fix for one lineage.

**The continuation lineage.** A continuation is the same feature carried into a
later PI, so deleting the feature deletes those too. Leaving them is not an
option: SQLite runs here without ``PRAGMA foreign_keys``, so the ON DELETE SET
NULL on ``continued_from_feature_id`` never fires and the survivor keeps a
pointer to a deleted row. That feature is then unreachable —
``cancel-continuation`` answers 404 for a missing origin, and CSV import cannot
match it because it carries no ``user_id``.
"""

from collections.abc import Sequence
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.services.continuation import descendant_ids


class FeatureDeletion(NamedTuple):
    """What a deletion removed, for the caller to broadcast and report."""

    feature_ids: list[str]
    """Deleted features, the requested ones first, then their continuations."""
    pbis: list[tuple[str, str]]
    """(pbi_system_id, parent_feature_system_id) — the parent is needed by SSE."""
    group_ids: list[str]


async def plan_feature_deletion(
    db: AsyncSession, feature_ids: Sequence[str]
) -> FeatureDeletion:
    """Work out everything deleting ``feature_ids`` would remove, without removing it.

    Split out so callers can tell a user what they are about to lose — the count
    is not obvious when a feature has continuations in later PIs.
    """
    ordered = list(dict.fromkeys(feature_ids))
    ordered += await descendant_ids(db, ordered)
    if not ordered:
        return FeatureDeletion([], [], [])

    pbis = (await db.execute(
        select(PBI.system_id, PBI.parent_feature_system_id).where(
            PBI.parent_feature_system_id.in_(ordered)
        )
    )).all()
    group_ids = list((await db.execute(
        select(Group.system_id).where(Group.feature_system_id.in_(ordered))
    )).scalars().all())

    return FeatureDeletion(
        feature_ids=ordered,
        pbis=[(sid, parent) for sid, parent in pbis],
        group_ids=group_ids,
    )


async def delete_features(
    db: AsyncSession, feature_ids: Sequence[str]
) -> FeatureDeletion:
    """Delete these features, their continuations, and their stories and groups.

    Does not commit — the caller owns the transaction, so an import that fails
    later removes nothing.
    """
    planned = await plan_feature_deletion(db, feature_ids)
    if not planned.feature_ids:
        return planned

    # Break the cycle in both directions before anything is deleted. Groups only
    # ever hold stories of their own feature (``create_group`` validates it, and
    # ``place_story_in_sprint`` builds the group from the story's parent), so
    # clearing these two columns cannot strand a story of a surviving feature.
    groups = (await db.execute(
        select(Group).where(Group.feature_system_id.in_(planned.feature_ids))
    )).scalars().all()
    for group in groups:
        group.story_system_id = None

    stories = (await db.execute(
        select(PBI).where(PBI.parent_feature_system_id.in_(planned.feature_ids))
    )).scalars().all()
    for story in stories:
        story.group_id = None

    await db.flush()

    for feature_id in planned.feature_ids:
        feature = await db.get(Feature, feature_id)
        if feature is not None:
            await db.delete(feature)
    await db.flush()

    return planned
