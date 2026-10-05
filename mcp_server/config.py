from pathlib import Path
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mcp_signing_secret: str = "change-me"
    backend_url: str = "http://localhost:8000"
    port: int = 8080

    # Set True only when the MCP server runs behind a trusted reverse proxy that
    # sets X-Forwarded-For. When True, the rate limiter keys on the leftmost
    # forwarded IP instead of the (proxy) socket peer — otherwise every client
    # shares the proxy's IP and one bad actor can rate-limit everyone. Leave
    # False when directly exposed, since X-Forwarded-For is then client-spoofable.
    trust_proxy_headers: bool = False

    # OAuth 2.1 — leave empty to run with direct API-key Bearer auth only
    oauth_base_url: str = ""
    oauth_token_storage: str = str(Path.home() / ".pi-planning" / "oauth_tokens.json")
    oauth_token_ttl: int = 3600          # access token lifetime in seconds
    oauth_refresh_token_ttl: int = 2592000  # refresh token lifetime in seconds (30 days)
    # Absolute ceiling on one consent: refresh rotation can't stretch a grant past
    # this, after which the user must paste an API key again (90 days).
    oauth_grant_max_age: int = 7776000
    # Where an authorization code may be sent. A client registering with any other
    # https host is refused: anyone can register, so this is what stops a client
    # named "Claude" from collecting codes on an attacker's server. Each entry
    # also matches its subdomains; loopback http and app-specific schemes
    # (cursor://, vscode://) are always allowed. "*" turns the check off.
    oauth_allowed_redirect_hosts: str = "claude.ai,claude.com,chatgpt.com,openai.com"
    # Registration is open to anyone, so the store needs a ceiling. At the cap,
    # registrations that never got a token are dropped to make room.
    oauth_max_clients: int = 500

    def allowed_redirect_hosts(self) -> list[str] | None:
        """The allowlist, lower-cased; None when the check is off."""
        hosts = [h.strip().lower() for h in self.oauth_allowed_redirect_hosts.split(",") if h.strip()]
        return None if "*" in hosts else hosts

    @field_validator("oauth_base_url")
    @classmethod
    def validate_oauth_base_url(cls, v: str) -> str:
        if not v:
            return v
        parsed = urlparse(v)
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError(
                f"oauth_base_url must use HTTPS (or localhost for development), got: {v!r}"
            )
        return v


settings = Settings()


# Mirrors backend/app/config.py:secret_problem — keep the two in sync. Every
# placeholder in an example file contains the marker, so matching it catches all.
_PLACEHOLDER_MARKER = "change-me"
MIN_SECRET_LENGTH = 32


def secret_problem(value: str) -> str | None:
    """Why *value* is unfit to sign service JWTs, or None when it is fine."""
    if not value:
        return "is not set"
    if _PLACEHOLDER_MARKER in value.lower():
        return "is still the example placeholder"
    if len(value) < MIN_SECRET_LENGTH:
        return f"is shorter than {MIN_SECRET_LENGTH} characters"
    return None
