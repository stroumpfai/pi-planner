from datetime import datetime, timezone
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, Field, PlainSerializer, WithJsonSchema

T = TypeVar("T")


def _utc_iso(dt: datetime) -> str:
    """Serialize naive datetimes as UTC-aware ISO-8601.

    Every datetime the app stores is UTC, but SQLite hands them back without a
    tzinfo — so without this the browser would parse them as local time.
    """
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


# Keep the OpenAPI type as a plain date-time string so generated clients are unchanged.
UtcDatetime = Annotated[
    datetime,
    PlainSerializer(_utc_iso, return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]


class ApiResponse(BaseModel, Generic[T]):
    data: T
    meta: dict[str, str] = Field(default_factory=lambda: {"timestamp": datetime.now(timezone.utc).isoformat()})


class ApiError(BaseModel):
    error: str
    message: str
    details: dict[str, Any] | None = None
