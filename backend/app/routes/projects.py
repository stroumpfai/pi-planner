from fastapi import APIRouter, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.database import get_session
from app.schemas import ProjectCreate, ProjectUpdate, ProjectResponse

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, body: ProjectUpdate, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, session: AsyncSession = Depends(get_session)):
    raise HTTPException(status_code=501, detail="Not implemented")
