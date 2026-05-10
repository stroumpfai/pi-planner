from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class GroupCreate(BaseModel):
    name: str = Field(..., max_length=100)
    feature_system_id: str
    pbi_ids: list[str] = Field(default_factory=list)
    sprint_index: int | None = Field(None, ge=0, le=4)
    order_index: int | None = None
    is_implicit: bool = False
    story_system_id: str | None = None


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
    is_implicit: bool
    story_system_id: str | None
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}


class PlaceStoryRequest(BaseModel):
    sprint_index: int = Field(..., ge=0, le=4)


class PlaceStoryResponse(BaseModel):
    story: PBIResponse
    group: GroupResponse


from app.schemas.pbi import PBIResponse  # noqa: E402 — avoid circular import at module level

PlaceStoryResponse.model_rebuild()
