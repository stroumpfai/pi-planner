import logging
import os

# Must run before any other imports so that FastAPI / uvicorn cannot pre-empt it.
# force=True removes any handlers that may already exist (e.g. from a pytest run)
# so the level always takes effect.
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "WARNING").upper(), force=True)

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import secret_problem, settings
from app.database import AsyncSessionLocal, get_session
from app.middleware.mcp_activity import MCPActivityMiddleware
from app.routes import (
    absences,
    api_keys,
    auth,
    csv_import,
    edit_lock,
    events,
    features,
    groups,
    holiday_calendars,
    meetings,
    pbis,
    pi_events,
    pis,
    project_snapshots,
    project_states,
    projects,
    release_notes,
    sprints,
    swimlines,
    team_achievement,
    team_holidays,
    team_members,
    team_projects,
    team_push,
    teams,
    test_utils,
    users,
)
from app.services import users as users_service

logger = logging.getLogger(__name__)


def assert_secrets_configured() -> None:
    """Refuse to start with a missing, placeholder or short signing secret.

    MCP_SIGNING_SECRET may be empty — that just disables the MCP service path
    (deps answers 503) — but once set it must be as strong as SECRET_KEY.
    """
    problems = []
    if problem := secret_problem(settings.secret_key):
        problems.append(f"SECRET_KEY {problem}")
    if settings.mcp_signing_secret and (problem := secret_problem(settings.mcp_signing_secret)):
        problems.append(f"MCP_SIGNING_SECRET {problem}")
    if problems:
        raise RuntimeError(
            "; ".join(problems)
            + ". Set a strong random value in .env (e.g. `openssl rand -hex 32`)."
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    assert_secrets_configured()
    async with AsyncSessionLocal() as db:
        await users_service.seed_from_config(db, settings.users_file)
    yield


app = FastAPI(
    title="PI Planning API",
    version="0.1.0",
    # The interactive docs list every route to anyone, so they are a debug aid only.
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
    lifespan=lifespan,
)

_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


@app.middleware("http")
async def security_headers(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    # Swagger/ReDoc (DEBUG only) load scripts from a CDN, so they get no CSP.
    if not request.url.path.startswith(_DOCS_PATHS):
        # 'unsafe-inline' styles: Tailwind/dnd-kit set style attributes at runtime.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return response


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
    project_states.router,
    events.router,
    csv_import.router,
    api_keys.router,
    teams.router,
    team_members.router,
    absences.router,
    meetings.router,
    team_projects.router,
    team_achievement.router,
    team_push.router,
    holiday_calendars.router,
    team_holidays.router,
    release_notes.router,
]:
    app.include_router(_router)

if settings.allow_test_reset:
    app.include_router(test_utils.router)


@app.get("/health")
async def health(db: Annotated[AsyncSession, Depends(get_session)]) -> dict[str, Any]:
    overall = "healthy"

    # Database check. The endpoint is unauthenticated, so log exception details
    # server-side only — never echo them to the caller.
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health check: database unavailable")
        overall = "unhealthy"

    return {"status": overall}


# Serve React SPA in production (when the frontend build exists)
_static = Path(__file__).parent.parent / "static"
if _static.exists():
    app.mount("/assets", StaticFiles(directory=str(_static / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str) -> FileResponse:  # noqa: ARG001
        return FileResponse(str(_static / "index.html"))
