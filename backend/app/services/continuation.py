"""Walking a Feature's continuation lineage.

A continuation is the same feature carried into a later PI, produced by
``POST /features/{id}/split``. The link is ``Feature.continued_from_feature_id``,
pointing back at the member the work came from, so a lineage is a tree rooted at
the feature that was planned first.

Only the root carries a ``user_id`` — ``split_feature`` does not copy it, and the
``UniqueConstraint(project_id, user_id)`` would reject it if it tried. That makes
these walks the only way to reach the rest of a lineage from a business ID, which
is what CSV import has to do to keep every member of a split feature in step with
the source system.

Every walk here guards against cycles. Nothing should be able to create one, but a
lineage is a self-referential table and an unguarded walk would hang the request.
"""

from collections.abc import Collection, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature


async def descendant_ids(db: AsyncSession, feature_ids: Collection[str]) -> list[str]:
    """Every feature continuing one of ``feature_ids``, transitively.

    The inputs themselves are not included. Returned breadth-first, so a caller
    deleting the result sees nearer continuations before further ones.
    """
    seen = set(feature_ids)
    found: list[str] = []
    frontier = list(feature_ids)

    while frontier:
        rows = (await db.execute(
            select(Feature.system_id).where(
                Feature.continued_from_feature_id.in_(frontier)
            )
        )).scalars().all()
        frontier = [sid for sid in rows if sid not in seen]
        seen.update(frontier)
        found.extend(frontier)

    return found


async def lineage_members(db: AsyncSession, feature: Feature) -> list[Feature]:
    """Every feature sharing ``feature``'s lineage, including itself.

    Walks up to the root first, so a CSV row matching any member reaches all of
    them — today only the root can be matched by ``user_id``, but a caller should
    not have to know that.
    """
    root = feature
    seen_up = {root.system_id}
    while root.continued_from_feature_id is not None:
        parent = await db.get(Feature, root.continued_from_feature_id)
        if parent is None or parent.system_id in seen_up:
            break
        seen_up.add(parent.system_id)
        root = parent

    members = [root]
    for sid in await descendant_ids(db, [root.system_id]):
        member = await db.get(Feature, sid)
        if member is not None:
            members.append(member)
    return members


async def newest_leaf(db: AsyncSession, feature: Feature) -> Feature:
    """The member of ``feature``'s lineage that carries the work furthest forward.

    A leaf is a member nothing continues from — the PI the feature has reached. A
    lineage is a tree rather than a list, because one feature can be split into
    more than one later PI, so the most recently created leaf wins. With no split
    at all this is ``feature`` itself.
    """
    descendants = await descendant_ids(db, [feature.system_id])
    if not descendants:
        return feature

    candidates: list[Feature] = [feature]
    for sid in descendants:
        member = await db.get(Feature, sid)
        if member is not None:
            candidates.append(member)

    continued: set[str] = {
        member.continued_from_feature_id
        for member in candidates
        if member.continued_from_feature_id is not None
    }
    leaves: Sequence[Feature] = [c for c in candidates if c.system_id not in continued]
    if not leaves:
        return feature
    return max(leaves, key=lambda f: (f.created_at, f.system_id))
