from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import PICreate, PIUpdate, PIResponse

router = APIRouter(tags=["pis"])


@router.get("/api/v1/projects/{project_id}/pis", response_model=list[PIResponse])
async def list_pis(project_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/api/v1/projects/{project_id}/pis", response_model=PIResponse, status_code=status.HTTP_201_CREATED)
async def create_pi(project_id: str, body: PICreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/api/v1/pis/{pi_id}", response_model=PIResponse)
async def get_pi(pi_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/api/v1/pis/{pi_id}", response_model=PIResponse)
async def update_pi(pi_id: str, body: PIUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.delete("/api/v1/pis/{pi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pi(pi_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
