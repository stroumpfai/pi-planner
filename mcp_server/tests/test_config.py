"""MCP_SIGNING_SECRET must be strong before the server starts (audit finding #1)."""

import pytest

from mcp_server.config import secret_problem, settings
from mcp_server.server import lifespan, mcp


@pytest.mark.parametrize(
    "value, problem",
    [
        ("", "is not set"),
        ("change-me", "is still the example placeholder"),
        # The value .env.example ships — long enough, but public.
        ("change-me-generate-with-python-secrets", "is still the example placeholder"),
        ("CHANGE-ME-generate-with-python-secrets", "is still the example placeholder"),
        ("a" * 31, "is shorter than 32 characters"),
    ],
)
def test_secret_problem_rejects(value, problem):
    assert secret_problem(value) == problem


def test_secret_problem_accepts_a_real_secret():
    assert secret_problem("0123456789abcdef" * 4) is None


async def test_lifespan_refuses_the_example_secret(monkeypatch):
    monkeypatch.setattr(settings, "mcp_signing_secret", "change-me-generate-with-python-secrets")
    with pytest.raises(RuntimeError, match="MCP_SIGNING_SECRET is still the example placeholder"):
        async with lifespan(mcp):
            pass


async def test_lifespan_starts_with_a_real_secret():
    # conftest sets a 46-character test secret.
    async with lifespan(mcp) as state:
        assert state == {}
