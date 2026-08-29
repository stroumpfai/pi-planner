from datetime import datetime, timezone
from typing import NamedTuple
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.pbi import PBI
from app.models.project_state import ProjectState, normalise_state
from app.schemas.csv_import import (
    CsvImportError,
    CsvImportResult,
    CsvRow,
    OrphanLocation,
)
from app.services.continuation import descendant_ids, lineage_members, newest_leaf
from app.services.events import broadcaster
from app.services.feature_delete import delete_features
from app.services.pbi_delete import delete_pbi_and_empty_group, detach_pbi_from_group
from app.services.project_state import get_or_create_state, state_item_type_for_pbi

_VALID_ITEM_TYPES = {"feature", "story", "bug"}
_USER_ID_MIN = 1
_USER_ID_MAX = 999_999


def _validate_rows(rows: list[CsvRow]) -> list[CsvImportError]:
    errors: list[CsvImportError] = []
    seen: set[int] = set()

    for row in rows:
        if not row.title.strip():
            errors.append(CsvImportError(row=row.row_number, message="missing title"))

        if row.item_type not in _VALID_ITEM_TYPES:
            errors.append(CsvImportError(
                row=row.row_number,
                message=f'unknown type "{row.item_type}"',
            ))

        if row.user_id is not None:
            if not (_USER_ID_MIN <= row.user_id <= _USER_ID_MAX):
                errors.append(CsvImportError(
                    row=row.row_number,
                    message=f"ID {row.user_id} is out of range (1–999 999)",
                ))
            elif row.user_id in seen:
                errors.append(CsvImportError(
                    row=row.row_number,
                    message=f"ID {row.user_id} appears more than once in this file",
                ))
            else:
                seen.add(row.user_id)

    return errors


async def _fetch_existing(
    db: AsyncSession, project_id: str
) -> tuple[dict[int, str], dict[int, str]]:
    """Return (feature_uid→system_id, pbi_uid→system_id) for all non-null user_ids in the project."""
    feature_map: dict[int, str] = {
        uid: sid
        for uid, sid in (await db.execute(
            select(Feature.user_id, Feature.system_id).where(
                Feature.project_id == project_id,
                Feature.user_id.is_not(None),
            )
        )).all()
        if uid is not None
    }
    pbi_map: dict[int, str] = {
        uid: sid
        for uid, sid in (await db.execute(
            select(PBI.user_id, PBI.system_id).where(
                PBI.project_id == project_id,
                PBI.user_id.is_not(None),
            )
        )).all()
        if uid is not None
    }
    return feature_map, pbi_map


def _cross_entity_errors(
    rows: list[CsvRow],
    feature_map: dict[int, str],
    pbi_map: dict[int, str],
) -> list[CsvImportError]:
    """Catch IDs that exist in the DB under the wrong entity type."""
    errors: list[CsvImportError] = []
    for row in rows:
        if row.user_id is None:
            continue
        if row.item_type == "feature" and row.user_id in pbi_map:
            errors.append(CsvImportError(
                row=row.row_number,
                message=f"ID {row.user_id} already exists as a story in this project",
            ))
        elif row.item_type in ("story", "bug") and row.user_id in feature_map:
            errors.append(CsvImportError(
                row=row.row_number,
                message=f"ID {row.user_id} already exists as a feature in this project",
            ))
    return errors


async def _resolve_row_state(
    db: AsyncSession,
    project_id: str,
    state_list_type: str,
    row: CsvRow,
    has_state_column: bool,
) -> tuple[bool, str | None]:
    """Work out the State this row assigns.

    Returns (should_change, state_id). A file with no State column changes nothing; a
    blank cell clears the item's State; any other value joins the list if it is new.
    """
    if not has_state_column:
        return False, None
    raw = row.state or ""
    if normalise_state(raw) == "":
        return True, None
    state = await get_or_create_state(db, project_id, state_list_type, raw)
    return True, (state.system_id if state else None)


async def _upsert_one_feature(
    db: AsyncSession,
    project_id: str,
    row: CsvRow,
    feature_map: dict[int, str],
    has_state_column: bool,
) -> tuple[str, int, int]:
    """Create or update a single Feature. Returns (system_id, created, updated)."""
    state_changed, state_id = await _resolve_row_state(
        db, project_id, "feature", row, has_state_column
    )

    if row.user_id is not None and row.user_id in feature_map:
        sysid = feature_map[row.user_id]
        feature = await db.get(Feature, sysid)
        if feature is None:
            return sysid, 0, 0
        # A split feature is one work item spread over several PIs, and only its
        # root carries the user_id this row matched. Applying the change to that
        # member alone would leave every later PI showing the title and State the
        # feature had on the day it was split.
        for member in await lineage_members(db, feature):
            member.title = row.title
            if state_changed:
                member.state_id = state_id
        return sysid, 0, 1

    sysid = str(uuid4())
    db.add(Feature(
        system_id=sysid,
        project_id=project_id,
        user_id=row.user_id,
        title=row.title,
        location="backlog",
        state_id=state_id if state_changed else None,
    ))
    return sysid, 1, 0


async def _upsert_features(
    db: AsyncSession,
    project_id: str,
    feature_rows: list[CsvRow],
    feature_map: dict[int, str],
    has_state_column: bool,
) -> tuple[dict[int, str], int, int]:
    csv_feature_sysid: dict[int, str] = {}
    created = 0
    updated = 0
    for row in feature_rows:
        sysid, was_created, was_updated = await _upsert_one_feature(
            db, project_id, row, feature_map, has_state_column
        )
        created += was_created
        updated += was_updated
        if row.user_id is not None:
            csv_feature_sysid[row.user_id] = sysid
    return csv_feature_sysid, created, updated


class _ParentTarget(NamedTuple):
    """Where a CSV Parent points, once continuations are taken into account."""

    leaf: str
    """The member a newly created story joins — the PI the work has reached."""
    members: frozenset[str]
    """Every member of the lineage. A story already under one of these has not
    moved: the split that put it there is a planning decision the CSV cannot see,
    and reading it as a re-parent would undo the split on every refresh."""


async def _parent_targets(
    db: AsyncSession, feature_sysids: list[str]
) -> dict[str, _ParentTarget]:
    """Resolve each matched feature to its lineage.

    Only split features need a walk, so an import of unsplit work costs one extra
    query for the whole file rather than a lineage walk per row.
    """
    targets = {
        sysid: _ParentTarget(leaf=sysid, members=frozenset((sysid,)))
        for sysid in feature_sysids
    }
    if not feature_sysids:
        return targets

    split_roots = {
        sysid
        for sysid in (await db.execute(
            select(Feature.continued_from_feature_id).where(
                Feature.continued_from_feature_id.in_(feature_sysids)
            )
        )).scalars().all()
        if sysid is not None
    }

    for sysid in split_roots:
        feature = await db.get(Feature, sysid)
        if feature is None:
            continue
        members = {sysid, *await descendant_ids(db, [sysid])}
        targets[sysid] = _ParentTarget(
            leaf=(await newest_leaf(db, feature)).system_id,
            members=frozenset(members),
        )
    return targets


class _StoryOutcome(NamedTuple):
    created: int = 0
    updated: int = 0
    reparented: int = 0
    reparent_skipped: int = 0
    freed_group_id: str | None = None


async def _reparent(db: AsyncSession, pbi: PBI, new_parent: Feature) -> str | None:
    """Move ``pbi`` under ``new_parent``, following it onto or off the board.

    Mirrors what ``split_feature`` does when it moves a story between features: the
    story leaves its group and takes the new parent's PI and swimlane, so it never
    ends up grouped under one feature while parented to another.
    """
    freed_group_id = await detach_pbi_from_group(db, pbi)
    pbi.parent_feature_system_id = new_parent.system_id
    pbi.pi_id = new_parent.pi_id
    pbi.swimlane_id = new_parent.swimlane_id
    pbi.modified_at = datetime.now(timezone.utc)
    return freed_group_id


async def _upsert_one_story(
    db: AsyncSession,
    project_id: str,
    row: CsvRow,
    target: _ParentTarget | None,
    unassigned_sysid: str | None,
    pbi_map: dict[int, str],
    has_state_column: bool,
    apply_reparenting: bool,
) -> _StoryOutcome:
    """Create or update a single Story/Bug."""
    # Stories and Bugs draw from separate State Lists.
    state_changed, state_id = await _resolve_row_state(
        db, project_id, state_item_type_for_pbi(row.item_type), row, has_state_column
    )

    if row.user_id is not None and row.user_id in pbi_map:
        pbi = await db.get(PBI, pbi_map[row.user_id])
        if pbi is None:
            return _StoryOutcome()
        previous_item_type = pbi.item_type
        pbi.title = row.title
        pbi.effort = row.effort
        pbi.item_type = row.item_type
        if state_changed:
            pbi.state_id = state_id
        elif row.item_type != previous_item_type:
            # A file with no State column says nothing about State, but switching a
            # Story to a Bug still strands the old State in the other list — clear it,
            # exactly as PATCH /pbis/{id} does.
            pbi.state_id = None

        # The file names a different feature than the one holding this story. A
        # member of the same lineage does not count: that is a split someone made
        # on the board, and the CSV has no way to express it.
        moved = (
            target is not None
            and pbi.parent_feature_system_id not in target.members
        )
        if not moved:
            return _StoryOutcome(updated=1)
        if not apply_reparenting:
            return _StoryOutcome(updated=1, reparent_skipped=1)

        new_parent = await db.get(Feature, target.leaf) if target else None
        if new_parent is None:
            return _StoryOutcome(updated=1, reparent_skipped=1)
        freed = await _reparent(db, pbi, new_parent)
        return _StoryOutcome(updated=1, reparented=1, freed_group_id=freed)

    parent_sysid = target.leaf if target is not None else unassigned_sysid
    db.add(PBI(
        project_id=project_id,
        parent_feature_system_id=parent_sysid,
        user_id=row.user_id,
        title=row.title,
        effort=row.effort,
        item_type=row.item_type,
        location="backlog",
        state_id=state_id if state_changed else None,
    ))
    return _StoryOutcome(created=1)


async def _upsert_stories(
    db: AsyncSession,
    project_id: str,
    story_rows: list[CsvRow],
    parent_lookup: dict[int, str],
    pbi_map: dict[int, str],
    unassigned_sysid: str | None,
    has_state_column: bool,
    apply_reparenting: bool,
) -> tuple[_StoryOutcome, list[str]]:
    """Create or update every story row. Returns the totals and any freed groups."""
    # A story new to a split feature belongs where the work has got to, not where
    # it started: filing it against the root would put newly discovered work in
    # the PI the feature has already carried over out of.
    #
    # Only the parents these rows actually name are worth resolving — parent_lookup
    # spans every feature in the project once a Parent can resolve against it.
    referenced = {
        parent_lookup[r.parent_id]
        for r in story_rows
        if r.parent_id is not None and r.parent_id in parent_lookup
    }
    targets = await _parent_targets(db, list(referenced))

    totals = _StoryOutcome()
    freed_group_ids: list[str] = []
    for row in story_rows:
        matched_sysid = (
            parent_lookup[row.parent_id]
            if row.parent_id is not None and row.parent_id in parent_lookup
            else None
        )
        outcome = await _upsert_one_story(
            db, project_id, row,
            targets.get(matched_sysid) if matched_sysid is not None else None,
            unassigned_sysid, pbi_map, has_state_column, apply_reparenting,
        )
        totals = _StoryOutcome(
            created=totals.created + outcome.created,
            updated=totals.updated + outcome.updated,
            reparented=totals.reparented + outcome.reparented,
            reparent_skipped=totals.reparent_skipped + outcome.reparent_skipped,
        )
        if outcome.freed_group_id:
            freed_group_ids.append(outcome.freed_group_id)
    return totals, freed_group_ids


async def _apply_removals(
    db: AsyncSession,
    project_id: str,
    system_ids: list[str],
) -> tuple[list[str], list[tuple[str, str]], list[str]]:
    """Delete the given features/PBIs (by system_id) belonging to this project.

    Features are deleted first, through ``delete_features``, which takes their
    continuations and their stories and groups with them. A child PBI whose id
    also appears in the list is therefore already gone and is skipped.

    A story deleted on its own goes through ``delete_pbi_and_empty_group`` so it
    cannot strand the group holding it on the PI board — the same cleanup
    ``DELETE /pbis/{id}`` performs.

    Returns (deleted_feature_ids, deleted_pbis, deleted_group_ids) where
    deleted_pbis is a list of (pbi_system_id, parent_feature_system_id) for SSE
    broadcasting.
    """
    feature_ids: list[str] = []
    remaining: list[str] = []

    for sid in system_ids:
        feature = await db.get(Feature, sid)
        if feature is not None and feature.project_id == project_id:
            feature_ids.append(sid)
        else:
            remaining.append(sid)

    deletion = await delete_features(db, feature_ids)
    deleted_pbis: list[tuple[str, str]] = list(deletion.pbis)
    deleted_group_ids: list[str] = list(deletion.group_ids)
    already_deleted = {pbi_id for pbi_id, _ in deletion.pbis}

    for sid in remaining:
        if sid in already_deleted:
            continue
        pbi = await db.get(PBI, sid)
        if pbi is not None and pbi.project_id == project_id:
            parent_id = pbi.parent_feature_system_id
            group_id = await delete_pbi_and_empty_group(db, pbi)
            deleted_pbis.append((sid, parent_id))
            if group_id:
                deleted_group_ids.append(group_id)

    return deletion.feature_ids, deleted_pbis, deleted_group_ids


_UNASSIGNED_TITLE = "Unassigned"


async def _get_or_create_unassigned(db: AsyncSession, project_id: str) -> str:
    """Return the system_id of the project's backlog "Unassigned" placeholder feature.

    Reused across imports: creating a fresh one every time would leave an empty
    placeholder behind on each re-import, since orphan stories that already exist
    are updated in place and stay under the original.

    Only a placeholder still sitting in the backlog qualifies. Once one has been
    moved onto the PI board it is no longer a landing spot — reusing it would put
    imported stories straight onto the board, and imports go to the backlog only.
    """
    existing = (await db.execute(
        select(Feature.system_id).where(
            Feature.project_id == project_id,
            Feature.user_id.is_(None),
            Feature.title == _UNASSIGNED_TITLE,
            Feature.location == "backlog",
        ).order_by(Feature.created_at).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        return existing

    sysid = str(uuid4())
    db.add(Feature(
        system_id=sysid,
        project_id=project_id,
        user_id=None,
        title=_UNASSIGNED_TITLE,
        location="backlog",
    ))
    return sysid


async def _orphan_locations(
    db: AsyncSession,
    orphan_rows: list[CsvRow],
    pbi_map: dict[int, str],
) -> list[OrphanLocation]:
    """Group the orphan rows that matched an existing story by the feature holding them.

    An orphan row whose ID is already in the project is updated where it sits — the
    import never re-parents it — so the result has to name that feature, and say
    whether it is in the backlog or on the PI board, for the summary to be truthful.
    """
    sysids = [
        pbi_map[r.user_id]
        for r in orphan_rows
        if r.user_id is not None and r.user_id in pbi_map
    ]
    if not sysids:
        return []

    rows = (await db.execute(
        select(Feature.title, Feature.location, func.count())
        .join(PBI, PBI.parent_feature_system_id == Feature.system_id)
        .where(PBI.system_id.in_(sysids))
        .group_by(Feature.system_id)
        .order_by(func.count().desc(), Feature.title)
    )).all()
    return [
        OrphanLocation(feature_title=title, location=location, count=count)
        for title, location, count in rows
    ]


async def _count_states(db: AsyncSession, project_id: str) -> int:
    return int((await db.execute(
        select(func.count()).select_from(ProjectState).where(
            ProjectState.project_id == project_id
        )
    )).scalar_one())


async def execute_import(
    db: AsyncSession,
    project_id: str,
    rows: list[CsvRow],
    removals: list[str] | None = None,
    has_state_column: bool = False,
    apply_reparenting: bool = False,
) -> CsvImportResult:
    errors = _validate_rows(rows)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"errors": [e.model_dump() for e in errors]},
        )

    deleted_feature_ids, deleted_pbis, deleted_group_ids = await _apply_removals(
        db, project_id, removals or []
    )
    if deleted_feature_ids or deleted_pbis:
        await db.flush()

    feature_map, pbi_map = await _fetch_existing(db, project_id)
    cross_errors = _cross_entity_errors(rows, feature_map, pbi_map)
    if cross_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"errors": [e.model_dump() for e in cross_errors]},
        )

    feature_rows = [r for r in rows if r.item_type == "feature"]
    story_rows = [r for r in rows if r.item_type in ("story", "bug")]

    # Counted before any upsert so a failed import registers no vocabulary: everything
    # below runs in one transaction, and the 422 paths above return before it starts.
    states_before = await _count_states(db, project_id)

    csv_feature_sysid, created_features, updated_features = await _upsert_features(
        db, project_id, feature_rows, feature_map, has_state_column
    )
    await db.flush()

    # A Parent naming a feature the project already holds resolves to it, even when
    # that feature is not a row in this file. Without this an incremental export —
    # this sprint's new stories, nothing else — orphans every one of them into
    # "Unassigned", and the whole tree has to be re-sent every time.
    parent_lookup = {**feature_map, **csv_feature_sysid}

    orphan_rows = [
        r for r in story_rows
        if r.parent_id is None or r.parent_id not in parent_lookup
    ]
    orphan_count = len(orphan_rows)

    # Rows the file could not have placed on its own — worth reporting, since the
    # preview counted them against the file alone and the user is owed the reason
    # their orphan count came out lower than the preview promised.
    parented_from_project = sum(
        1 for r in story_rows
        if r.parent_id is not None
        and r.parent_id not in csv_feature_sysid
        and r.parent_id in feature_map
        and (r.user_id is None or r.user_id not in pbi_map)
    )

    # Only rows that will be *created* need the placeholder as their parent; an
    # orphan row matching an existing story is updated in place and keeps its
    # current feature, so a file of pure updates must not conjure one.
    new_orphan_rows = [
        r for r in orphan_rows if r.user_id is None or r.user_id not in pbi_map
    ]
    orphan_locations = await _orphan_locations(db, orphan_rows, pbi_map)

    unassigned_sysid: str | None = None
    if new_orphan_rows:
        unassigned_sysid = await _get_or_create_unassigned(db, project_id)
        await db.flush()

    stories, freed_group_ids = await _upsert_stories(
        db, project_id, story_rows, parent_lookup, pbi_map, unassigned_sysid,
        has_state_column, apply_reparenting,
    )
    deleted_group_ids += freed_group_ids
    created_states = await _count_states(db, project_id) - states_before
    await db.commit()

    if created_states:
        await broadcaster.broadcast(project_id, "state:created", {"count": created_states})
    for feature_id in deleted_feature_ids:
        await broadcaster.broadcast(project_id, "feature:deleted", {"system_id": feature_id})
    for pbi_id, parent_id in deleted_pbis:
        await broadcaster.broadcast(
            project_id, "pbi:deleted",
            {"system_id": pbi_id, "feature_id": parent_id},
        )
    for group_id in deleted_group_ids:
        await broadcaster.broadcast(project_id, "group:deleted", {"system_id": group_id})

    return CsvImportResult(
        created_features=created_features,
        created_stories=stories.created,
        updated_features=updated_features,
        updated_stories=stories.updated,
        removed_features=len(deleted_feature_ids),
        removed_stories=len(deleted_pbis),
        orphan_stories=orphan_count,
        orphan_stories_placed=len(new_orphan_rows),
        orphan_stories_existing=orphan_locations,
        stories_parented_from_project=parented_from_project,
        stories_reparented=stories.reparented,
        stories_reparent_skipped=stories.reparent_skipped,
        created_states=created_states,
    )
