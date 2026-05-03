from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import AsyncSessionLocal
from app.routes import auth, edit_lock, events, features, groups, pbis, pis, projects, sprints, swimlines
from app.services.auth import ensure_default_admin


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with AsyncSessionLocal() as db:
        await ensure_default_admin(db)
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
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


for _router in [
    auth.router,
    projects.router,
    features.router,
    pbis.router,
    pis.router,
    swimlines.router,
    groups.router,
    sprints.router,
    edit_lock.router,
    events.router,
]:
    app.include_router(_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
