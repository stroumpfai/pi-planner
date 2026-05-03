from datetime import datetime

from pydantic import BaseModel, Field


class GroupCreate(BaseModel):
    name: str = Field(..., max_length=100)
    feature_system_id: str
    sprint_index: int | None = Field(None, ge=0, le=4)
    order_index: int | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    sprint_index: int | None = Field(None, ge=0, le=4)
    order_index: int | None = None


class GroupResponse(BaseModel):
    system_id: str
    swimline_id: str
    feature_system_id: str
    name: str
    sprint_index: int | None
    order_index: int | None
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}
