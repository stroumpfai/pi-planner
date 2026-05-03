from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import GroupCreate, GroupUpdate, GroupResponse

router = APIRouter(tags=["groups"])


@router.get("/api/v1/swimlines/{swimline_id}/groups", response_model=list[GroupResponse])
async def list_groups(swimline_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/api/v1/swimlines/{swimline_id}/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(swimline_id: str, body: GroupCreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/api/v1/groups/{group_id}", response_model=GroupResponse)
async def get_group(group_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/api/v1/groups/{group_id}", response_model=GroupResponse)
async def update_group(group_id: str, body: GroupUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.delete("/api/v1/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(group_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
