from datetime import datetime

from pydantic import BaseModel, Field


class SnapshotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class SnapshotResponse(BaseModel):
    system_id: str
    name: str
    created_at: datetime
    created_by: str | None

    model_config = {"from_attributes": True}
