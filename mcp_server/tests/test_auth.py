import httpx
import pytest

from mcp_server.auth import verify_api_key


async def test_valid_token_returns_key_id_username_role(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_abc", "username": "alice", "role": "admin"}
        )
    )
    result = await verify_api_key("kid_abc.secretpart")
    assert result == ("kid_abc", "alice", "admin")


async def test_401_from_backend_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    result = await verify_api_key("kid_bad.badsecret")
    assert result is None


async def test_expired_key_401_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, json={"detail": "API key expired"})
    )
    result = await verify_api_key("kid_old.oldsecret")
    assert result is None


async def test_revoked_key_401_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, json={"detail": "API key revoked"})
    )
    result = await verify_api_key("kid_rev.secret")
    assert result is None


async def test_backend_unreachable_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    result = await verify_api_key("kid_abc.secret")
    assert result is None


async def test_backend_500_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(500, text="Server Error")
    )
    result = await verify_api_key("kid_abc.secret")
    assert result is None


async def test_empty_token_returns_none(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(401, text="Unauthorized")
    )
    result = await verify_api_key("")
    assert result is None


async def test_editor_role_returned_correctly(mock_backend):
    mock_backend.post("/api/v1/api-keys/admin/verify").mock(
        return_value=httpx.Response(
            200, json={"key_id": "kid_xyz", "username": "bob", "role": "editor"}
        )
    )
    result = await verify_api_key("kid_xyz.secret")
    assert result == ("kid_xyz", "bob", "editor")
