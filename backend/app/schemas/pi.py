from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import IterationPath, UtcDatetime

PIState = Literal["draft", "in_progress", "closed"]


class PICreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: str | None = Field(None, max_length=500)
    state: PIState = "draft"
    start_date: date | None = None
    end_date: date | None = None
    iteration_path: IterationPath = None


class PIUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=500)
    state: PIState | None = None
    start_date: date | None = None
    end_date: date | None = None
    iteration_path: IterationPath = None


class SprintIterationPath(BaseModel):
    system_id: str
    iteration_path: IterationPath = None


class PIIterationPaths(BaseModel):
    """A PI's path and its sprints' paths, written together.

    Sprints left out of ``sprints`` keep the path they have. Uniqueness is checked
    over the result as a whole, so a path can move between the PI and its sprints,
    or two sprints can swap, in one save.
    """

    iteration_path: IterationPath = None
    sprints: list[SprintIterationPath] = Field(default_factory=list)


class PIIterationPathsResponse(BaseModel):
    iteration_path: str | None
    sprints: list[SprintIterationPath]


class PIResponse(BaseModel):
    system_id: str
    project_id: str
    name: str
    description: str | None
    state: str
    start_date: date | None
    end_date: date | None
    iteration_path: str | None = None
    total_effort: float = 0
    total_available: int = 0
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True}
