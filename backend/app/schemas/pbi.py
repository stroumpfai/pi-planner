from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator
from pydantic.functional_validators import AfterValidator

from app.schemas.common import UtcDatetime

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
    # An entry in the State List matching item_type; absent or null means no State.
    state_id: str | None = None


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
    # An entry in the State List matching the PBI's type. Explicit null clears it.
    state_id: str | None = None


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
    state_id: str | None = None
    state: str | None = None  # the State's value, resolved for display
    project_id: str
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @field_validator("state", mode="before")
    @classmethod
    def unwrap_state_value(cls, v: object) -> str | None:
        """Accept either the ProjectState relationship object or a plain string."""
        if v is None or isinstance(v, str):
            return v
        return str(getattr(v, "value", None) or "") or None
