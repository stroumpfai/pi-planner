from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import UtcDatetime

FeatureLocation = Literal["backlog", "pi"]


class FeatureCreate(BaseModel):
    title: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=2000)
    id: int | None = Field(None, ge=1, le=999999, alias="id")
    # An entry in the project's feature State List; absent or null means no State.
    state_id: str | None = None


class FeatureUpdate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=2000)
    id: int | None = Field(None, ge=1, le=999999)
    location: FeatureLocation | None = None
    pi_id: str | None = None
    swimlane_id: str | None = None
    # An entry in the project's feature State List. Explicit null clears the State.
    state_id: str | None = None


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
    created_at: UtcDatetime
    modified_at: UtcDatetime

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
