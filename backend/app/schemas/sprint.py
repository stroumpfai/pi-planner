from datetime import date, datetime

from pydantic import BaseModel, Field


class SprintCreate(BaseModel):
    sprint_index: int = Field(..., ge=0, le=4)
    capacity: int = Field(..., gt=0)
    start_date: date | None = None
    end_date: date | None = None


class SprintUpdate(BaseModel):
    capacity: int | None = Field(None, gt=0)
    start_date: date | None = None
    end_date: date | None = None


class SprintResponse(BaseModel):
    system_id: str
    pi_id: str
    sprint_index: int | None
    capacity: int
    effort: int = 0
    start_date: date | None
    end_date: date | None
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}
