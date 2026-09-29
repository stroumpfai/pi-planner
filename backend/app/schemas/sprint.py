from datetime import date

from pydantic import BaseModel, Field

from app.schemas.common import IterationPath, UtcDatetime


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
    iteration_path: IterationPath = None


class SprintResponse(BaseModel):
    system_id: str
    pi_id: str
    sprint_index: int | None
    available: int
    # When a team push last wrote ``available``; null means never pushed. The
    # sprint header needs it because the number alone cannot say where it came
    # from — 14 pts typed and 14 pts derived read identically (teams.md §6.6).
    available_pushed_at: UtcDatetime | None = None
    effort: float = 0
    start_date: date | None
    end_date: date | None
    iteration_path: str | None = None
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True}
