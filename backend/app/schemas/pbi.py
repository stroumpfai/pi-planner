from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PBILocation = Literal["backlog", "pi"]
PBIItemType = Literal["story", "bug"]


class PBICreate(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    effort: int | None = Field(None, gt=0)
    id: int | None = Field(None, ge=1, le=999999)
    parent_feature_system_id: str
    item_type: PBIItemType = "story"


class PBIUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)
    effort: int | None = Field(None, gt=0)
    id: int | None = Field(None, ge=1, le=999999)
    item_type: PBIItemType | None = None
    location: PBILocation | None = None
    pi_id: str | None = None
    swimlane_id: str | None = None
    group_id: str | None = None


class PBIResponse(BaseModel):
    system_id: str
    id: int | None = Field(None, validation_alias="user_id")
    parent_feature_system_id: str
    title: str
    description: str | None
    effort: int | None
    item_type: str
    location: str
    pi_id: str | None
    swimlane_id: str | None
    group_id: str | None
    project_id: str
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
