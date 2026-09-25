from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import UtcDatetime

StateItemType = Literal["feature", "story", "bug"]
StateCategory = Literal["not_started", "in_progress", "done"]

MAX_STATE_LENGTH = 100


class ProjectStateCreate(BaseModel):
    item_type: StateItemType
    value: str = Field(..., min_length=1, max_length=MAX_STATE_LENGTH)
    # Declared, never inferred from the value's wording (docs/adr/0006).
    category: StateCategory | None = None


class ProjectStateUpdate(BaseModel):
    """Rename an entry, (re)categorise it, or both.

    Items reference States by id, so a rename carries every item with it. For
    ``category`` an explicit null clears it and an absent key leaves it alone — the
    route reads ``model_fields_set`` to tell the two apart.
    """

    value: str | None = Field(None, min_length=1, max_length=MAX_STATE_LENGTH)
    category: StateCategory | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> "ProjectStateUpdate":
        if not self.model_fields_set & {"value", "category"}:
            raise ValueError("Provide value, category, or both")
        if "value" in self.model_fields_set and self.value is None:
            raise ValueError("value cannot be null")
        return self


class ProjectStateReorder(BaseModel):
    """The new order of one list. The three lists are ordered independently."""

    item_type: StateItemType
    order: list[str] = Field(..., description="Ordered list of State system_ids")


class ProjectStateResponse(BaseModel):
    system_id: str
    project_id: str
    item_type: StateItemType
    value: str
    position: int
    # Which States count as done is declared here (team-achievement.md §3.1).
    category: StateCategory | None = None
    created_at: UtcDatetime

    model_config = {"from_attributes": True}


class ProjectStateUsage(BaseModel):
    """Why a State could not be deleted: the items still holding it."""

    features: int
    pbis: int
