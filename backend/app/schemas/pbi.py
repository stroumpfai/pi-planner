from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field
from pydantic.functional_validators import AfterValidator

PBILocation = Literal["backlog", "pi"]
PBIItemType = Literal["story", "bug"]

EFFORT_VALUES: tuple[float, ...] = (0, 0.5, 1, 2, 3, 5, 8, 13, 21)


def _validate_effort(v: float | None) -> float | None:
    if v is not None and v not in EFFORT_VALUES:
        raise ValueError(f'must be one of {list(EFFORT_VALUES)}')
    return v


ValidEffort = Annotated[float | None, AfterValidator(_validate_effort)]


class PBICreate(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    effort: ValidEffort = None
    id: int | None = Field(None, ge=1, le=999999)
    parent_feature_system_id: str
    item_type: PBIItemType = "story"


class PBIUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)
    effort: ValidEffort = None
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
    effort: float | None
    item_type: PBIItemType
    location: str
    pi_id: str | None
    swimlane_id: str | None
    group_id: str | None
    project_id: str
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
