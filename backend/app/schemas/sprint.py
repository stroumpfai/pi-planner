from datetime import date

from pydantic import BaseModel, Field

from app.schemas.common import UtcDatetime


class SprintCreate(BaseModel):
    sprint_index: int = Field(..., ge=0, le=4)
    # ge=0, not gt=0: a sprint spanning a shutdown genuinely has no budget, and the
    # snapshot restore path could already write a 0 the API refused to set.
    available: int = Field(..., ge=0)
    start_date: date | None = None
    end_date: date | None = None


class SprintUpdate(BaseModel):
    available: int | None = Field(None, ge=0)
    start_date: date | None = None
    end_date: date | None = None


class SprintResponse(BaseModel):
    system_id: str
    pi_id: str
    sprint_index: int | None
    available: int
    effort: float = 0
    start_date: date | None
    end_date: date | None
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True}
