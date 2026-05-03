from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)


class ProjectResponse(BaseModel):
    system_id: str
    name: str
    description: str | None
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}
