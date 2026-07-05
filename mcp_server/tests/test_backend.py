import httpx
import jwt
import pytest

from mcp_server.backend import MCPBackendError, call_backend
from mcp_server.config import settings


async def test_200_returns_parsed_json(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get("/api/v1/projects/").mock(
        return_value=httpx.Response(200, json={"data": []})
    )
    result = await call_backend("GET", "/api/v1/projects/")
    assert result == {"data": []}


async def test_200_empty_body_returns_empty_dict(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/p1/edit-lock/release").mock(
        return_value=httpx.Response(200, content=b"")
    )
    result = await call_backend("POST", "/api/v1/projects/p1/edit-lock/release")
    assert result == {}


async def test_409_with_locked_by_and_expires_at(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/p1/edit-lock/acquire").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {"locked_by": "alice", "expires_at": "2026-06-01T12:00:00Z"}},
        )
    )
    with pytest.raises(MCPBackendError) as exc_info:
        await call_backend("POST", "/api/v1/projects/p1/edit-lock/acquire")
    err = exc_info.value
    assert err.status == 409
    assert err.code == "LOCKED"
    assert "alice" in err.message
    assert "2026-06-01" in err.message


async def test_409_without_detail_uses_fallback(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/p1/edit-lock/acquire").mock(
        return_value=httpx.Response(409, json={})
    )
    with pytest.raises(MCPBackendError) as exc_info:
        await call_backend("POST", "/api/v1/projects/p1/edit-lock/acquire")
    assert "another user" in exc_info.value.message
    assert "Try again" in exc_info.value.message


async def test_403_raises_forbidden(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/").mock(
        return_value=httpx.Response(403, json={"detail": "Forbidden"})
    )
    with pytest.raises(MCPBackendError) as exc_info:
        await call_backend("POST", "/api/v1/projects/")
    err = exc_info.value
    assert err.status == 403
    assert err.code == "FORBIDDEN"


async def test_422_raises_validation_error(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.post("/api/v1/projects/").mock(
        return_value=httpx.Response(422, json={"detail": [{"msg": "field required"}]})
    )
    with pytest.raises(MCPBackendError) as exc_info:
        await call_backend("POST", "/api/v1/projects/")
    err = exc_info.value
    assert err.status == 422
    assert err.code == "VALIDATION_ERROR"
    assert "field required" in err.message


async def test_500_raises_backend_error(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get("/api/v1/projects/").mock(
        return_value=httpx.Response(500, text="Internal Server Error")
    )
    with pytest.raises(MCPBackendError) as exc_info:
        await call_backend("GET", "/api/v1/projects/")
    err = exc_info.value
    assert err.status == 500
    assert err.code == "BACKEND_ERROR"


async def test_connection_error_raises_backend_unreachable(
    mock_backend, mock_ctx, patch_get_http_request
):
    mock_backend.get("/api/v1/projects/").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    with pytest.raises(MCPBackendError) as exc_info:
        await call_backend("GET", "/api/v1/projects/")
    err = exc_info.value
    assert err.status == 503
    assert err.code == "BACKEND_UNREACHABLE"


def test_minted_jwt_has_correct_claims(mock_settings):
    from mcp_server.jwt_utils import mint_service_jwt

    token = mint_service_jwt()
    claims = jwt.decode(token, settings.mcp_signing_secret, algorithms=["HS256"])
    assert claims["iss"] == "mcp-server"
    assert claims["sub"] == "service"
    assert claims["exp"] - claims["iat"] == 300
    assert "actor" not in claims


def test_minted_jwt_binds_actor(mock_settings):
    from mcp_server.jwt_utils import mint_service_jwt

    token = mint_service_jwt("alice")
    claims = jwt.decode(token, settings.mcp_signing_secret, algorithms=["HS256"])
    assert claims["actor"] == "alice"


async def test_list_response_wrapped_in_items(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get("/api/v1/projects/").mock(
        return_value=httpx.Response(200, json=[{"system_id": "p1"}])
    )
    result = await call_backend("GET", "/api/v1/projects/")
    assert result == {"items": [{"system_id": "p1"}]}


async def test_actor_headers_sent_to_backend(mock_backend, mock_ctx, patch_get_http_request):
    mock_backend.get("/api/v1/projects/").mock(
        return_value=httpx.Response(200, json={})
    )
    await call_backend("GET", "/api/v1/projects/")
    req = mock_backend.calls.last.request
    assert req.headers["X-MCP-Actor"] == "testuser"
    assert req.headers["X-MCP-Key-Id"] == "kid_testkey"
    # The service JWT must be bound to the same actor as the header.
    token = req.headers["Authorization"].removeprefix("Bearer ")
    claims = jwt.decode(token, settings.mcp_signing_secret, algorithms=["HS256"])
    assert claims["actor"] == "testuser"
