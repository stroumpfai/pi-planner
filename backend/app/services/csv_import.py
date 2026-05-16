from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.pbi import PBI
from app.schemas.csv_import import CsvImportError, CsvImportResult, CsvRow

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
        elif row.item_type in ("pbi", "bug") and row.user_id in feature_map:
            errors.append(CsvImportError(
                row=row.row_number,
                message=f"ID {row.user_id} already exists as a feature in this project",
            ))
    return errors


async def _upsert_features(
    db: AsyncSession,
    project_id: str,
    feature_rows: list[CsvRow],
    feature_map: dict[int, str],
) -> tuple[dict[int, str], int, int]:
    csv_feature_sysid: dict[int, str] = {}
    created = 0
    updated = 0
    for row in feature_rows:
        if row.user_id is not None and row.user_id in feature_map:
            existing_sysid = feature_map[row.user_id]
            feature = await db.get(Feature, existing_sysid)
            if feature:
                feature.title = row.title
                updated += 1
            csv_feature_sysid[row.user_id] = existing_sysid
        else:
            new_sysid = str(uuid4())
            db.add(Feature(
                system_id=new_sysid,
                project_id=project_id,
                user_id=row.user_id,
                title=row.title,
                location="backlog",
            ))
            if row.user_id is not None:
                csv_feature_sysid[row.user_id] = new_sysid
            created += 1
    return csv_feature_sysid, created, updated


async def _upsert_stories(
    db: AsyncSession,
    project_id: str,
    story_rows: list[CsvRow],
    csv_feature_sysid: dict[int, str],
    pbi_map: dict[int, str],
    unassigned_sysid: str | None,
) -> tuple[int, int]:
    created = 0
    updated = 0
    for row in story_rows:
        parent_sysid: str = (
            csv_feature_sysid[row.parent_id]
            if row.parent_id is not None and row.parent_id in csv_feature_sysid
            else unassigned_sysid  # type: ignore[assignment]
        )
        if row.user_id is not None and row.user_id in pbi_map:
            pbi = await db.get(PBI, pbi_map[row.user_id])
            if pbi:
                pbi.title = row.title
                pbi.effort = row.effort
                pbi.item_type = row.item_type
                updated += 1
        else:
            db.add(PBI(
                project_id=project_id,
                parent_feature_system_id=parent_sysid,
                user_id=row.user_id,
                title=row.title,
                effort=row.effort,
                item_type=row.item_type,
                location="backlog",
            ))
            created += 1
    return created, updated


async def execute_import(
    db: AsyncSession,
    project_id: str,
    rows: list[CsvRow],
) -> CsvImportResult:
    errors = _validate_rows(rows)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": [e.model_dump() for e in errors]},
        )

    feature_map, pbi_map = await _fetch_existing(db, project_id)
    cross_errors = _cross_entity_errors(rows, feature_map, pbi_map)
    if cross_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"errors": [e.model_dump() for e in cross_errors]},
        )

    feature_rows = [r for r in rows if r.item_type == "feature"]
    story_rows = [r for r in rows if r.item_type in ("story", "bug")]

    csv_feature_sysid, created_features, updated_features = await _upsert_features(
        db, project_id, feature_rows, feature_map
    )
    await db.flush()

    orphan_count = sum(
        1 for r in story_rows
        if r.parent_id is None or r.parent_id not in csv_feature_sysid
    )

    unassigned_sysid: str | None = None
    if orphan_count > 0:
        unassigned_sysid = str(uuid4())
        db.add(Feature(
            system_id=unassigned_sysid,
            project_id=project_id,
            user_id=None,
            title="Unassigned",
            location="backlog",
        ))
        await db.flush()

    created_stories, updated_stories = await _upsert_stories(
        db, project_id, story_rows, csv_feature_sysid, pbi_map, unassigned_sysid
    )
    await db.commit()

    return CsvImportResult(
        created_features=created_features,
        created_stories=created_stories,
        updated_features=updated_features,
        updated_stories=updated_stories,
        orphan_stories=orphan_count,
    )
