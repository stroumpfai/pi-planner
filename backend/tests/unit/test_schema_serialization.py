"""Pins the UTC serialization contract for API datetimes.

Stored datetimes are naive UTC (SQLite strips tzinfo on read regardless of what was
written). Without an explicit offset the browser's `new Date(iso)` would parse them
as local time, skewing every rendered timestamp by the viewer's UTC offset.
"""
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel

from app.schemas.common import UtcDatetime


class _Model(BaseModel):
    at: UtcDatetime
    maybe: UtcDatetime | None = None


def test_naive_datetime_serializes_with_utc_offset():
    dumped = _Model(at=datetime(2026, 8, 17, 16, 5)).model_dump(mode="json")
    assert dumped["at"] == "2026-08-17T16:05:00+00:00"


def test_aware_datetime_is_left_unchanged():
    aware = datetime(2026, 8, 17, 16, 5, tzinfo=timezone(timedelta(hours=2)))
    dumped = _Model(at=aware).model_dump(mode="json")
    assert dumped["at"] == "2026-08-17T16:05:00+02:00"


def test_optional_field_allows_null():
    dumped = _Model(at=datetime(2026, 1, 1), maybe=None).model_dump(mode="json")
    assert dumped["maybe"] is None


def test_json_schema_stays_a_date_time_string():
    props = _Model.model_json_schema()["properties"]
    assert props["at"] == {"title": "At", "type": "string", "format": "date-time"}
