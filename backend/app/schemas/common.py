from datetime import datetime, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    data: T
    meta: dict[str, str] = Field(default_factory=lambda: {"timestamp": datetime.now(timezone.utc).isoformat()})


class ApiError(BaseModel):
    error: str
    message: str
    details: dict[str, Any] | None = None
