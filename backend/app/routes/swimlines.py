from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import SwimlineCreate, SwimlineUpdate, SwimlineResponse

router = APIRouter(tags=["swimlines"])


@router.get("/api/v1/pis/{pi_id}/swimlines", response_model=list[SwimlineResponse])
async def list_swimlines(pi_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/api/v1/pis/{pi_id}/swimlines", response_model=SwimlineResponse, status_code=status.HTTP_201_CREATED)
async def create_swimline(pi_id: str, body: SwimlineCreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/api/v1/swimlines/{swimline_id}", response_model=SwimlineResponse)
async def get_swimline(swimline_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/api/v1/swimlines/{swimline_id}", response_model=SwimlineResponse)
async def update_swimline(swimline_id: str, body: SwimlineUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.delete("/api/v1/swimlines/{swimline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_swimline(swimline_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
