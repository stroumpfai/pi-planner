from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import SprintCreate, SprintUpdate, SprintResponse

router = APIRouter(tags=["sprints"])


@router.get("/api/v1/pis/{pi_id}/sprints", response_model=list[SprintResponse])
async def list_sprints(pi_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/api/v1/pis/{pi_id}/sprints", response_model=SprintResponse, status_code=status.HTTP_201_CREATED)
async def create_sprint(pi_id: str, body: SprintCreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/api/v1/sprints/{sprint_id}", response_model=SprintResponse)
async def update_sprint(sprint_id: str, body: SprintUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
