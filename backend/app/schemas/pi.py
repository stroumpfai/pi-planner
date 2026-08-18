from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import UtcDatetime

PIState = Literal["draft", "in_progress", "closed"]


class PICreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str | None = Field(None, max_length=500)
    state: PIState = "draft"
    start_date: date | None = None
    end_date: date | None = None


class PIUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=500)
    state: PIState | None = None
    start_date: date | None = None
    end_date: date | None = None


class PIResponse(BaseModel):
    system_id: str
    project_id: str
    name: str
    description: str | None
    state: str
    start_date: date | None
    end_date: date | None
    total_effort: float = 0
    total_capacity: int = 0
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True}
