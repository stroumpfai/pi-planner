from datetime import datetime

from pydantic import BaseModel, Field


class SwimlineCreate(BaseModel):
    name: str = Field(..., max_length=100)
    order_index: int | None = None


class SwimlineUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    order_index: int | None = None


class SwimlineReorder(BaseModel):
    order: list[str] = Field(..., description="Ordered list of swimline system_ids")


class SwimlineResponse(BaseModel):
    system_id: str
    pi_id: str
    name: str
    order_index: int | None
    effort: float = 0
    capacity: int = 0
    created_at: datetime
    modified_at: datetime

    model_config = {"from_attributes": True}
