import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_session
from app.main import app
from app.models.user import User
from app.services import users as users_module
from app.services.auth import hash_password

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        # Import all models so Base.metadata knows about them
        import app.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(db_engine):
    factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db):
    async def override_get_session():
        yield db

    app.dependency_overrides[get_session] = override_get_session

    # Seed a test admin user into the in-memory user store
    users_module._store["testuser"] = User(
        username="testuser",
        password_hash=hash_password("password"),
        display_name="Test User",
        is_admin=True,
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/auth/login", json={"username": "testuser", "password": "password"})
        assert resp.status_code == 200
        yield ac

    app.dependency_overrides.clear()
    users_module._store.pop("testuser", None)
