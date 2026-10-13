import pytest
from httpx import AsyncClient

from app.config import settings
from app.main import app


@pytest.mark.asyncio
async def test_security_headers_present(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


@pytest.mark.asyncio
async def test_hsts_only_over_https(client: AsyncClient) -> None:
    r = await client.get("http://test/health")
    assert "strict-transport-security" not in r.headers
    r = await client.get("/health", headers={"x-forwarded-proto": "https"})
    assert "strict-transport-security" in r.headers


def test_api_docs_only_in_debug() -> None:
    enabled = settings.debug
    assert (app.docs_url is not None) == enabled
    assert (app.redoc_url is not None) == enabled
    assert (app.openapi_url is not None) == enabled


@pytest.mark.asyncio
async def test_health_reports_only_status(client: AsyncClient) -> None:
    assert (await client.get("/health")).json() == {"status": "healthy"}
