from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import PBICreate, PBIUpdate, PBIResponse

router = APIRouter(tags=["pbis"])


@router.get("/api/v1/projects/{project_id}/pbis", response_model=list[PBIResponse])
async def list_pbis(project_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/api/v1/projects/{project_id}/pbis", response_model=PBIResponse, status_code=status.HTTP_201_CREATED)
async def create_pbi(project_id: str, body: PBICreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/api/v1/pbis/{pbi_id}", response_model=PBIResponse)
async def get_pbi(pbi_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/api/v1/pbis/{pbi_id}", response_model=PBIResponse)
async def update_pbi(pbi_id: str, body: PBIUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.delete("/api/v1/pbis/{pbi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pbi(pbi_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
