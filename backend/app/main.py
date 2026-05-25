import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import AsyncSessionLocal
from app.routes import (
    auth,
    csv_import,
    edit_lock,
    events,
    features,
    groups,
    pbis,
    pis,
    projects,
    sprints,
    swimlines,
    test_utils,
    users,
)
from app.services import users as users_service

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.secret_key == "change-me":
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


for _router in [
    auth.router,
    users.router,
    projects.router,
    features.router,
    pbis.router,
    pis.router,
    swimlines.router,
    groups.router,
    sprints.router,
    edit_lock.router,
    events.router,
    csv_import.router,
]:
    app.include_router(_router)

if settings.allow_test_reset:
    app.include_router(test_utils.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# Serve React SPA in production (when the frontend build exists)
_static = Path(__file__).parent.parent / "static"
if _static.exists():
    app.mount("/assets", StaticFiles(directory=str(_static / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str) -> FileResponse:  # noqa: ARG001
        return FileResponse(str(_static / "index.html"))
