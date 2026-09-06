"""Optimistic concurrency for team rows (spec/teams.md §4.2)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException, Response
from httpx import ASGITransport, AsyncClient

from app.services.concurrency import (
    IfMatch,
    check_if_match,
    etag_for,
    require_if_match,
    set_etag,
)

_AT = datetime(2026, 8, 30, 12, 0, 0, 123456, tzinfo=timezone.utc)


def test_etag_is_strong_and_quoted():
    tag = etag_for(_AT)
    assert tag.startswith('"') and tag.endswith('"')
    assert not tag.startswith("W/")


def test_etag_distinguishes_writes_inside_one_second():
    """The whole point of microsecond timestamps: a second's granularity loses updates."""
    assert etag_for(_AT) != etag_for(_AT + timedelta(microseconds=1))


def test_etag_treats_a_naive_timestamp_as_utc():
    assert etag_for(_AT.replace(tzinfo=None)) == etag_for(_AT)


def test_check_if_match_passes_on_the_current_tag():
    check_if_match(etag_for(_AT), _AT, {"system_id": "t1"})


def test_check_if_match_accepts_a_list_of_tags():
    header = f'"stale", {etag_for(_AT)}'
    check_if_match(header, _AT, {"system_id": "t1"})


def test_check_if_match_412s_with_the_current_row():
    with pytest.raises(HTTPException) as exc:
        check_if_match('"2026-01-01T00:00:00+00:00"', _AT, {"system_id": "t1", "name": "Theirs"})
    assert exc.value.status_code == 412
    assert exc.value.detail["error"] == "STALE"
    # The body carries the row so the UI can offer keep-theirs / reapply-mine.
    assert exc.value.detail["current"]["name"] == "Theirs"


@pytest.mark.parametrize("header", [None, "", "*"])
def test_missing_or_wildcard_if_match_is_428(header):
    """'*' means "any representation" — exactly the last-write-wins this prevents."""
    with pytest.raises(HTTPException) as exc:
        require_if_match(header)
    assert exc.value.status_code == 428
    assert exc.value.detail["error"] == "IF_MATCH_REQUIRED"


# ── the dependency, end to end ────────────────────────────────────────────────

def _app() -> FastAPI:
    app = FastAPI()
    row = {"system_id": "t1", "name": "Platform", "modified_at": _AT}

    @app.get("/row")
    async def read(response: Response) -> dict:
        set_etag(response, row["modified_at"])
        return {"name": row["name"]}

    @app.patch("/row")
    async def write(if_match: IfMatch, name: str) -> dict:
        check_if_match(if_match, row["modified_at"], {"name": row["name"]})
        return {"name": name}

    return app


@pytest.fixture
async def etag_client():
    async with AsyncClient(
        transport=ASGITransport(app=_app()), base_url="http://test"
    ) as client:
        yield client


@pytest.mark.asyncio
async def test_read_returns_an_etag_the_write_accepts(etag_client):
    read = await etag_client.get("/row")
    tag = read.headers["ETag"]
    assert tag == etag_for(_AT)

    resp = await etag_client.patch("/row", params={"name": "Renamed"}, headers={"If-Match": tag})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_write_without_if_match_is_rejected(etag_client):
    resp = await etag_client.patch("/row", params={"name": "Renamed"})
    assert resp.status_code == 428


@pytest.mark.asyncio
async def test_stale_if_match_is_412_not_409(etag_client):
    """409 means 'someone holds the project lock, wait'; 412 means 'this row moved'."""
    resp = await etag_client.patch(
        "/row", params={"name": "Renamed"}, headers={"If-Match": '"2020-01-01T00:00:00+00:00"'}
    )
    assert resp.status_code == 412
    assert resp.json()["detail"]["error"] == "STALE"
