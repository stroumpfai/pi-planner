from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import FeatureCreate, FeatureUpdate, FeatureResponse

router = APIRouter(tags=["features"])


@router.get("/api/v1/projects/{project_id}/features", response_model=list[FeatureResponse])
async def list_features(project_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/api/v1/projects/{project_id}/features", response_model=FeatureResponse, status_code=status.HTTP_201_CREATED)
async def create_feature(project_id: str, body: FeatureCreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/api/v1/features/{feature_id}", response_model=FeatureResponse)
async def get_feature(feature_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/api/v1/features/{feature_id}", response_model=FeatureResponse)
async def update_feature(feature_id: str, body: FeatureUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.delete("/api/v1/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature(feature_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
