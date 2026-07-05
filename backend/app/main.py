import logging
import os

# Must run before any other imports so that FastAPI / uvicorn cannot pre-empt it.
# force=True removes any handlers that may already exist (e.g. from a pytest run)
# so the level always takes effect.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "WARNING").upper(), force=True)

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_session
from app.middleware.mcp_activity import MCPActivityMiddleware
from app.routes import (
    api_keys,
    auth,
    csv_import,
    edit_lock,
    events,
    features,
    groups,
    pbis,
    pi_events,
    pis,
    project_snapshots,
    projects,
    sprints,
    swimlines,
    test_utils,
    users,
)
from app.services import users as users_service

logger = logging.getLogger(__name__)


# Known placeholder values that must never be used as a real signing key.
_INSECURE_SECRET_KEYS = frozenset({"", "change-me", "change-me-in-production", "change-me-to-a-random-secret-key"})


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.secret_key in _INSECURE_SECRET_KEYS:
        raise RuntimeError("SECRET_KEY is not configured. Set a strong random value in .env")
    async with AsyncSessionLocal() as db:
        await users_service.seed_from_config(db, settings.users_file)
    yield


app = FastAPI(
    title="PI Planning API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(MCPActivityMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-MCP-Actor", "X-MCP-Key-Id"],
)


for _router in [
    auth.router,
    users.router,
    projects.router,
    features.router,
    pbis.router,
    pi_events.router,
    pis.router,
    swimlines.router,
    groups.router,
    sprints.router,
    edit_lock.router,
    project_snapshots.router,
    events.router,
    csv_import.router,
    api_keys.router,
]:
    app.include_router(_router)

if settings.allow_test_reset:
    app.include_router(test_utils.router)


@app.get("/health")
async def health(db: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any]:
    components: dict[str, Any] = {}
    overall = "healthy"

    # Database check
    try:
        start = time.monotonic()
        await db.execute(text("SELECT 1"))
        ms = int((time.monotonic() - start) * 1000)
        components["database"] = {"status": "healthy", "response_ms": ms}
    except Exception as exc:
        components["database"] = {"status": "unhealthy", "error": str(exc)}
        overall = "unhealthy"

    # Disk check
    try:
        import shutil
        usage = shutil.disk_usage("/")
        free_gb = round(usage.free / 1e9, 1)
        disk_status = "healthy" if free_gb > 1.0 else "degraded"
        components["disk"] = {"status": disk_status, "free_gb": free_gb}
        if disk_status == "degraded" and overall == "healthy":
            overall = "degraded"
    except Exception as exc:
        components["disk"] = {"status": "unknown", "error": str(exc)}

    return {"status": overall, "components": components}


# Serve React SPA in production (when the frontend build exists)
_static = Path(__file__).parent.parent / "static"
if _static.exists():
    app.mount("/assets", StaticFiles(directory=str(_static / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str) -> FileResponse:  # noqa: ARG001
        return FileResponse(str(_static / "index.html"))
