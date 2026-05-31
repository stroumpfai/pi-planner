import httpx
import pytest

from mcp_server.backend import MCPBackendError
from mcp_server.lock import edit_lock


async def test_acquires_and_releases_on_success(mock_backend, mock_ctx, patch_get_http_request):
    pid = "proj-1"
    acquire = mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    release = mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )

    executed = []
    async with edit_lock(pid):
        executed.append("write_op")

    assert executed == ["write_op"]
    assert acquire.called
    assert release.called


async def test_release_called_even_on_write_error(mock_backend, mock_ctx, patch_get_http_request):
    pid = "proj-2"
    mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    release = mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/release").mock(
        return_value=httpx.Response(200, json={})
    )

    with pytest.raises(RuntimeError, match="write failed"):
        async with edit_lock(pid):
            raise RuntimeError("write failed")

    assert release.called


async def test_409_on_acquire_propagates_before_yield(
    mock_backend, mock_ctx, patch_get_http_request
):
    pid = "proj-3"
    mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/acquire").mock(
        return_value=httpx.Response(
            409,
            json={"detail": {"locked_by": "bob", "expires_at": "2026-06-01T12:00:00Z"}},
        )
    )

    executed = []
    with pytest.raises(MCPBackendError) as exc_info:
        async with edit_lock(pid):
            executed.append("should_not_run")

    assert executed == []
    assert exc_info.value.code == "LOCKED"
    assert "bob" in exc_info.value.message


async def test_release_failure_is_swallowed(mock_backend, mock_ctx, patch_get_http_request):
    """Release failure must not propagate — lock expires naturally after 30 min."""
    pid = "proj-4"
    mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/release").mock(
        return_value=httpx.Response(500, text="Server Error")
    )

    async with edit_lock(pid):
        pass  # should complete without raising


async def test_lock_released_even_when_release_raises_mcp_error(
    mock_backend, mock_ctx, patch_get_http_request
):
    """MCPBackendError from release is caught and swallowed."""
    pid = "proj-5"
    mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/acquire").mock(
        return_value=httpx.Response(200, json={})
    )
    mock_backend.post(f"/api/v1/projects/{pid}/edit-lock/release").mock(
        return_value=httpx.Response(403, json={"detail": "Forbidden"})
    )

    async with edit_lock(pid):
        pass  # should not raise
