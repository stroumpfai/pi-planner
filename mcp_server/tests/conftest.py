import pytest
import respx
import httpx
from unittest.mock import MagicMock, patch

from fastmcp.server.dependencies import AccessToken

from mcp_server.config import settings
from mcp_server.backend import set_http_client

_TEST_BACKEND_URL = "http://test-backend"


@pytest.fixture(autouse=True)
def mock_settings(monkeypatch):
    """Override settings for all tests to use predictable values."""
    monkeypatch.setattr(settings, "mcp_signing_secret", "test-secret-32chars-xxxxxxxxxxx")
    monkeypatch.setattr(settings, "backend_url", _TEST_BACKEND_URL)


@pytest.fixture
def mock_backend():
    """
    respx mock router for all HTTP calls to the test backend.

    Usage:
        mock_backend.get("/api/v1/projects/").mock(
            return_value=httpx.Response(200, json=[])
        )
    """
    with respx.mock(base_url=_TEST_BACKEND_URL) as mock:
        yield mock


@pytest.fixture
def mock_http_client(mock_backend):
    """A real httpx.AsyncClient that respx will intercept.
    Also registers it as the module-level client used by call_backend."""
    client = httpx.AsyncClient(base_url=_TEST_BACKEND_URL)
    set_http_client(client)
    yield client


@pytest.fixture
def mock_access_token():
    """Fake FastMCP AccessToken for call_backend actor headers."""
    fake_api_key = "kid_testkey.testsecret"  # synthetic test fixture, not a real secret
    return AccessToken(
        token=fake_api_key,
        client_id="testuser",
        scopes=["admin"],
        claims={"key_id": "kid_testkey", "role": "admin"},
    )


@pytest.fixture
def mock_ctx(mock_http_client, mock_access_token):
    """
    Minimal FastMCP Context mock. Kept for tool tests that pass ctx=mock_ctx.
    """
    ctx = MagicMock()
    ctx.lifespan_context = {"http_client": mock_http_client}
    return ctx


@pytest.fixture
def patch_get_access_token(mock_access_token):
    """Patch get_access_token() so call_backend picks up actor info in tests."""
    with patch("mcp_server.backend.get_access_token", return_value=mock_access_token):
        yield mock_access_token


# Keep for backward compatibility in any test that still uses it
@pytest.fixture
def mock_request():
    """Fake Starlette request with mcp_username and mcp_key_id set in state."""
    req = MagicMock()
    req.state.mcp_username = "testuser"
    req.state.mcp_key_id = "kid_testkey"
    return req


@pytest.fixture
def patch_get_http_request(mock_request, patch_get_access_token):
    """Activate both get_http_request and get_access_token patches for tests
    that use the old fixture name."""
    with patch("mcp_server.backend.get_access_token", return_value=patch_get_access_token):
        yield mock_request
