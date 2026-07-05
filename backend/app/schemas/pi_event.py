from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

PIEventType = Literal["release", "milestone", "deadline", "pilot", "go_no_go", "other"]


class PIEventCreate(BaseModel):
    name: str = Field(..., max_length=100)
    event_date: date
    event_type: PIEventType


class PIEventUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    event_date: date | None = None
    event_type: PIEventType | None = None


class PIEventResponse(BaseModel):
    system_id: str
    pi_id: str
    name: str
    event_date: date
    event_type: PIEventType
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}
