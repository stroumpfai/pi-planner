from contextlib import asynccontextmanager

from mcp_server.backend import call_backend, MCPBackendError


@asynccontextmanager
async def edit_lock(project_id: str):
    """
    Acquire the project edit lock before a write operation, then release it in a
    finally block so the lock is always freed — even if the write raises an error.

    Raises MCPBackendError(409, "LOCKED", ...) if another user holds the lock.
    A release failure is swallowed; the lock will expire naturally after 30 minutes.
    """
    await call_backend("POST", f"/api/v1/projects/{project_id}/edit-lock/acquire")
    try:
        yield
    finally:
        try:
            await call_backend(
                "POST", f"/api/v1/projects/{project_id}/edit-lock/release"
            )
        except MCPBackendError:
            pass  # lock will expire naturally after 30 min timeout
