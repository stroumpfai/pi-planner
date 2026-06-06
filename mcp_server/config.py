from pathlib import Path
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mcp_signing_secret: str = "change-me"
    backend_url: str = "http://localhost:8000"
    port: int = 8080

    # OAuth 2.1 — leave empty to run with direct API-key Bearer auth only
    oauth_base_url: str = ""
    oauth_token_storage: str = str(Path.home() / ".pi-planning" / "oauth_tokens.json")
    oauth_token_ttl: int = 3600          # access token lifetime in seconds
    oauth_refresh_token_ttl: int = 2592000  # refresh token lifetime in seconds (30 days)

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
