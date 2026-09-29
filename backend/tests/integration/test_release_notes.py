"""GET /api/v1/release-notes: read-only, every role, no project scoping."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app

_URL = "/api/v1/release-notes"

_FIXTURE = """## Unreleased

- Teams can now be exported to and imported from JSON
"""


@pytest.mark.asyncio
async def test_reader_can_read(reader_client: AsyncClient, tmp_path, monkeypatch):
    file = tmp_path / "RELEASE-NOTES.md"
    file.write_text(_FIXTURE)
    monkeypatch.setattr(settings, "release_notes_file", str(file))

    resp = await reader_client.get(_URL)

    assert resp.status_code == 200, resp.text
    entries = resp.json()["entries"]
    assert entries == [
        {
            "version": "Unreleased",
            "date": None,
            "notes": ["Teams can now be exported to and imported from JSON"],
        }
    ]


@pytest.mark.asyncio
async def test_editor_and_admin_can_read(client: AsyncClient, editor_client: AsyncClient, tmp_path, monkeypatch):
    file = tmp_path / "RELEASE-NOTES.md"
    file.write_text(_FIXTURE)
    monkeypatch.setattr(settings, "release_notes_file", str(file))

    for c in (client, editor_client):
        resp = await c.get(_URL)
        assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_missing_file_returns_empty(client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "release_notes_file", str(tmp_path / "nonexistent.md"))

    resp = await client.get(_URL)

    assert resp.status_code == 200, resp.text
    assert resp.json()["entries"] == []


@pytest.mark.asyncio
async def test_requires_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as unauth:
        resp = await unauth.get(_URL)
    assert resp.status_code == 401
