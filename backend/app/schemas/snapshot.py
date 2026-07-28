from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SnapshotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class SnapshotResponse(BaseModel):
    system_id: str
    name: str
    created_at: datetime
    created_by: str | None

    model_config = {"from_attributes": True}


class SnapshotDiffResponse(BaseModel):
    """Structured diff of the live project against a baseline snapshot.

    ``changes`` holds per-entity-type ``{added, removed, changed}`` lists;
    ``summary`` holds the matching counts plus a ``total_effort`` delta;
    ``labels`` maps id references (pi/swimline) to names for rendering; and
    ``narrative`` is a compact human/LLM-readable summary. See
    ``app.services.snapshot_diff`` for the exact shapes.
    """

    baseline_snapshot: dict[str, Any]
    compared_at: str
    scope: dict[str, Any]
    summary: dict[str, Any]
    changes: dict[str, Any]
    labels: dict[str, Any]
    narrative: str
