"""Test-only reset endpoint — only mounted when ALLOW_TEST_RESET=true."""
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, HTTPException

from app.database import get_session
from app.models import EditLock, Group, PBI, Feature, Sprint, Swimline, PI, Project, Session

router = APIRouter(prefix="/api/v1/test", tags=["test"])


@router.post("/reset")
async def reset_database(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    """Delete all rows from every table in dependency order. Test use only."""
    for model in (PBI, Group, Feature, EditLock, Session, Sprint, Swimline, PI, Project):
        await session.execute(delete(model))
    await session.commit()
    return {"status": "ok"}
