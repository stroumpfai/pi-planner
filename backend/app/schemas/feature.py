from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

FeatureLocation = Literal["backlog", "pi"]


class FeatureCreate(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    id: int | None = Field(None, ge=1, le=999999, alias="id")
    # Blank or absent means no State; a value not in the list joins it.
    state_value: str | None = Field(None, max_length=100)


class FeatureUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)
    id: int | None = Field(None, ge=1, le=999999)
    location: FeatureLocation | None = None
    pi_id: str | None = None
    swimlane_id: str | None = None
    # Send state_id to select an existing State, or state_value to select-or-create one
    # (the modal lets users type a new State). Explicit null clears the State.
    state_id: str | None = None
    state_value: str | None = Field(None, max_length=100)


class FeatureSplitRequest(BaseModel):
    target_pi_id: str
    target_swimline_id: str
    pbi_ids: list[str] = Field(..., min_length=1)


class FeatureResponse(BaseModel):
    system_id: str
    id: int | None = Field(None, validation_alias="user_id")
    title: str
    description: str | None
    effort: float = 0  # computed: sum of child PBI efforts
    location: str
    pi_id: str | None
    swimlane_id: str | None
    continued_from_feature_id: str | None
    state_id: str | None = None
    state: str | None = None  # the State's value, resolved for display
    project_id: str
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @field_validator("effort", mode="before")
    @classmethod
    def coerce_none_to_zero(cls, v: Any) -> float:
        return float(v) if v is not None else 0.0

    @field_validator("state", mode="before")
    @classmethod
    def unwrap_state_value(cls, v: Any) -> str | None:
        """Accept either the ProjectState relationship object or a plain string."""
        if v is None or isinstance(v, str):
            return v
        return str(getattr(v, "value", None) or "") or None


class BulkDeleteResponse(BaseModel):
    deleted_features: int
