from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user
from app.models.project import Project
from app.models.user import User
from app.schemas.csv_import import CsvImportRequest, CsvImportResult
from app.services.csv_import import execute_import

router = APIRouter(tags=["import"])


@router.post("/api/v1/projects/{project_id}/import/csv")
async def import_csv(
    project_id: str,
    body: CsvImportRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> CsvImportResult:
    if not await db.get(Project, project_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return await execute_import(db, project_id, body.rows)
