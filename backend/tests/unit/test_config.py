"""Startup refuses weak signing secrets (audit finding #1)."""

import pytest

from app.config import secret_problem, settings
from app.main import assert_secrets_configured

_STRONG = "0123456789abcdef" * 4


@pytest.mark.parametrize(
    "value, problem",
    [
        ("", "is not set"),
        ("change-me", "is still the example placeholder"),
        # The values the root and backend .env.example files ship.
        ("change-me-generate-with-python-secrets", "is still the example placeholder"),
        ("change-me-to-a-random-secret-key", "is still the example placeholder"),
        ("a" * 31, "is shorter than 32 characters"),
    ],
)
def test_secret_problem_rejects(value: str, problem: str) -> None:
    assert secret_problem(value) == problem


def test_secret_problem_accepts_a_real_secret() -> None:
    assert secret_problem(_STRONG) is None


def test_startup_refuses_placeholder_secret_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "secret_key", "change-me-generate-with-python-secrets")
    monkeypatch.setattr(settings, "mcp_signing_secret", "")
    with pytest.raises(RuntimeError, match="SECRET_KEY is still the example placeholder"):
        assert_secrets_configured()


def test_startup_allows_mcp_secret_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Empty only disables the MCP service path; it can't be used to mint a token."""
    monkeypatch.setattr(settings, "secret_key", _STRONG)
    monkeypatch.setattr(settings, "mcp_signing_secret", "")
    assert_secrets_configured()


def test_startup_refuses_placeholder_mcp_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "secret_key", _STRONG)
    monkeypatch.setattr(settings, "mcp_signing_secret", "change-me-generate-with-python-secrets")
    with pytest.raises(RuntimeError, match="MCP_SIGNING_SECRET is still the example placeholder"):
        assert_secrets_configured()


def test_startup_refuses_short_mcp_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "secret_key", _STRONG)
    monkeypatch.setattr(settings, "mcp_signing_secret", "short")
    with pytest.raises(RuntimeError, match="MCP_SIGNING_SECRET is shorter than 32 characters"):
        assert_secrets_configured()
