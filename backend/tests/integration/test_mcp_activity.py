"""Integration tests for MCPActivityMiddleware — the audit trail of what MCP
agents changed, and its guard against forged entries.

The middleware opens its own session from ``AsyncSessionLocal`` (bound at
import), so each test points that at the test database.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import settings
from app.database import get_session
from app.main import app
from app.middleware import mcp_activity
from app.models.activity_log import ActivityLog, ActorType
from app.models.user import Role
from app.services import activity as activity_service
from app.services import users as users_module
from app.services.auth import hash_password

pytestmark = pytest.mark.asyncio

_TEST_SECRET = "test-mcp-signing-secret-at-least-32-bytes-long"
_ACTOR = "mcpuser"
_KEY_ID = "key-123"
_PROJECTS_URL = "/api/v1/projects/"


def _service_jwt(
    secret: str = _TEST_SECRET,
    *,
    iss: str = "mcp-server",
    sub: str = "service",
    expires_in: timedelta = timedelta(minutes=5),
) -> str:
    claims = {"iss": iss, "sub": sub, "actor": _ACTOR, "exp": datetime.now(timezone.utc) + expires_in}
    return pyjwt.encode(claims, secret, algorithm="HS256")


def _headers(token: str | None = None, *, key_id: str | None = _KEY_ID) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token or _service_jwt()}", "X-MCP-Actor": _ACTOR}
    if key_id is not None:
        headers["X-MCP-Key-Id"] = key_id
    return headers


@pytest_asyncio.fixture
async def mcp_client(db, monkeypatch):
    monkeypatch.setattr(settings, "mcp_signing_secret", _TEST_SECRET)

    @asynccontextmanager
    async def session_factory():
        yield db

    monkeypatch.setattr(mcp_activity, "AsyncSessionLocal", session_factory)

    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session
    await users_module.create(
        db,
        username=_ACTOR,
        password_hash=hash_password("password"),
        display_name="MCP User",
        role=Role.editor,
    )
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def _entries(db) -> list[ActivityLog]:
    result = await db.execute(select(ActivityLog).where(ActivityLog.actor_type == ActorType.mcp_bot))
    return list(result.scalars().all())


async def test_successful_write_is_logged(mcp_client, db):
    resp = await mcp_client.post(_PROJECTS_URL, json={"name": "From MCP"}, headers=_headers())
    assert resp.status_code == 201

    [entry] = await _entries(db)
    assert entry.actor_username == _ACTOR
    assert entry.api_key_id == _KEY_ID
    assert entry.action == "post:/api/v1/projects/"
    assert entry.status == "success"


async def test_failed_write_is_logged_as_error(mcp_client, db):
    resp = await mcp_client.post(_PROJECTS_URL, json={}, headers=_headers())
    assert resp.status_code == 422

    [entry] = await _entries(db)
    assert entry.status == "error"


async def test_read_is_not_logged(mcp_client, db):
    resp = await mcp_client.get(_PROJECTS_URL, headers=_headers())
    assert resp.status_code == 200
    assert await _entries(db) == []


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(_service_jwt("some-other-secret-that-is-also-32-bytes-long"), id="wrong-secret"),
        pytest.param(_service_jwt(iss="someone-else"), id="wrong-issuer"),
        pytest.param(_service_jwt(sub="user"), id="wrong-subject"),
        pytest.param(_service_jwt(expires_in=timedelta(minutes=-1)), id="expired"),
        pytest.param("not-a-jwt", id="garbage"),
    ],
)
async def test_forged_token_writes_no_entry(mcp_client, db, token):
    await mcp_client.post(_PROJECTS_URL, json={"name": "Forged"}, headers=_headers(token))
    assert await _entries(db) == []


async def test_token_without_exp_writes_no_entry(mcp_client, db):
    token = pyjwt.encode({"iss": "mcp-server", "sub": "service", "actor": _ACTOR}, _TEST_SECRET, algorithm="HS256")
    await mcp_client.post(_PROJECTS_URL, json={"name": "No exp"}, headers=_headers(token))
    assert await _entries(db) == []


async def test_non_bearer_authorization_writes_no_entry(mcp_client, db):
    headers = {**_headers(), "Authorization": f"Basic {_service_jwt()}"}
    await mcp_client.post(_PROJECTS_URL, json={"name": "Basic"}, headers=headers)
    assert await _entries(db) == []


async def test_missing_key_id_writes_no_entry(mcp_client, db):
    resp = await mcp_client.post(_PROJECTS_URL, json={"name": "No key id"}, headers=_headers(key_id=None))
    assert resp.status_code == 201
    assert await _entries(db) == []


async def test_unset_signing_secret_writes_no_entry(mcp_client, db, monkeypatch):
    token = _service_jwt()
    monkeypatch.setattr(settings, "mcp_signing_secret", "")
    await mcp_client.post(_PROJECTS_URL, json={"name": "No secret"}, headers=_headers(token))
    assert await _entries(db) == []


async def test_entry_survives_a_key_that_cannot_be_referenced(mcp_client, db, monkeypatch):
    """If writing with the key id fails (the key vanished mid-request), the
    entry is still written, without the key."""
    real_log_activity = activity_service.log_activity

    async def log_activity(session, **kwargs):
        if kwargs["api_key_id"] is not None:
            raise RuntimeError("FOREIGN KEY constraint failed")
        await real_log_activity(session, **kwargs)

    monkeypatch.setattr(activity_service, "log_activity", log_activity)

    resp = await mcp_client.post(_PROJECTS_URL, json={"name": "Revoked"}, headers=_headers())
    assert resp.status_code == 201

    [entry] = await _entries(db)
    assert entry.api_key_id is None
    assert entry.status == "success"
