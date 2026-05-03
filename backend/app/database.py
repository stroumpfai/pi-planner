from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


def _resolve_db_url(url: str) -> str:
    if url.startswith("sqlite") and "~" in url:
        expanded = url.replace("~", str(Path.home()))
        db_path = Path(expanded.split("///")[-1])
        db_path.parent.mkdir(parents=True, exist_ok=True)
        return expanded
    return url


engine = create_async_engine(
    _resolve_db_url(settings.database_url),
    echo=settings.debug,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
