from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import UtcDatetime

StateItemType = Literal["feature", "story", "bug"]
StateCategory = Literal["not_started", "in_progress", "done"]

MAX_STATE_LENGTH = 100


class ProjectStateCreate(BaseModel):
    item_type: StateItemType
    value: str = Field(..., min_length=1, max_length=MAX_STATE_LENGTH)


class ProjectStateResponse(BaseModel):
    system_id: str
    project_id: str
    item_type: StateItemType
    value: str
    position: int
    # Reserved for the future progress/filtering feature; nothing writes it yet.
    category: StateCategory | None = None
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class ProjectStateUsage(BaseModel):
    """Why a State could not be deleted: the items still holding it."""

    features: int
    pbis: int
