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
from app.services.events import broadcaster
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
        feature.title = row.title
        if state_changed:
            feature.state_id = state_id
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


async def _upsert_one_story(
    db: AsyncSession,
    project_id: str,
    row: CsvRow,
    parent_sysid: str,
    pbi_map: dict[int, str],
    has_state_column: bool,
) -> tuple[int, int]:
    """Create or update a single Story/Bug. Returns (created, updated)."""
    # Stories and Bugs draw from separate State Lists.
    state_changed, state_id = await _resolve_row_state(
        db, project_id, state_item_type_for_pbi(row.item_type), row, has_state_column
    )

    if row.user_id is not None and row.user_id in pbi_map:
        pbi = await db.get(PBI, pbi_map[row.user_id])
        if pbi is None:
            return 0, 0
        pbi.title = row.title
        pbi.effort = row.effort
        pbi.item_type = row.item_type
        if state_changed:
            pbi.state_id = state_id
        return 0, 1

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
    return 1, 0


async def _upsert_stories(
    db: AsyncSession,
    project_id: str,
    story_rows: list[CsvRow],
    csv_feature_sysid: dict[int, str],
    pbi_map: dict[int, str],
    unassigned_sysid: str | None,
    has_state_column: bool,
) -> tuple[int, int]:
    created = 0
    updated = 0
    for row in story_rows:
        parent_sysid: str = (
            csv_feature_sysid[row.parent_id]
            if row.parent_id is not None and row.parent_id in csv_feature_sysid
            else unassigned_sysid  # type: ignore[assignment]
        )
        was_created, was_updated = await _upsert_one_story(
            db, project_id, row, parent_sysid, pbi_map, has_state_column
        )
        created += was_created
        updated += was_updated
    return created, updated


async def _apply_removals(
    db: AsyncSession,
    project_id: str,
    system_ids: list[str],
) -> tuple[list[str], list[tuple[str, str]]]:
    """Delete the given features/PBIs (by system_id) belonging to this project.

    Features are deleted first — this cascades to their child PBIs and groups
    (see Feature.pbis/groups delete-orphan + PBI FK ON DELETE CASCADE), so a child
    PBI whose id also appears in the list is already gone and is skipped.

    Returns (deleted_feature_ids, deleted_pbis) where deleted_pbis is a list of
    (pbi_system_id, parent_feature_system_id) for SSE broadcasting.
    """
    deleted_feature_ids: list[str] = []
    deleted_pbis: list[tuple[str, str]] = []
    remaining: list[str] = []

    for sid in system_ids:
        feature = await db.get(Feature, sid)
        if feature is not None and feature.project_id == project_id:
            await db.delete(feature)
            deleted_feature_ids.append(sid)
        else:
            remaining.append(sid)

    # Flush so feature cascades run before we probe for surviving PBIs.
    if deleted_feature_ids:
        await db.flush()

    for sid in remaining:
        pbi = await db.get(PBI, sid)
        if pbi is not None and pbi.project_id == project_id:
            parent_id = pbi.parent_feature_system_id
            await db.delete(pbi)
            deleted_pbis.append((sid, parent_id))

    return deleted_feature_ids, deleted_pbis


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
) -> CsvImportResult:
    errors = _validate_rows(rows)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"errors": [e.model_dump() for e in errors]},
        )

    deleted_feature_ids, deleted_pbis = await _apply_removals(
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

    orphan_rows = [
        r for r in story_rows
        if r.parent_id is None or r.parent_id not in csv_feature_sysid
    ]
    orphan_count = len(orphan_rows)

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

    created_stories, updated_stories = await _upsert_stories(
        db, project_id, story_rows, csv_feature_sysid, pbi_map, unassigned_sysid,
        has_state_column,
    )
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

    return CsvImportResult(
        created_features=created_features,
        created_stories=created_stories,
        updated_features=updated_features,
        updated_stories=updated_stories,
        removed_features=len(deleted_feature_ids),
        removed_stories=len(deleted_pbis),
        orphan_stories=orphan_count,
        orphan_stories_placed=len(new_orphan_rows),
        orphan_stories_existing=orphan_locations,
        created_states=created_states,
    )
