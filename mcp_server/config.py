from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mcp_signing_secret: str = "change-me"
    backend_url: str = "http://localhost:8000"
    port: int = 8080

    # OAuth 2.1 — leave empty to run with direct API-key Bearer auth only
    oauth_base_url: str = ""
    oauth_token_storage: str = str(Path.home() / ".pi-planning" / "oauth_tokens.json")
    oauth_token_ttl: int = 3600  # access token lifetime in seconds


settings = Settings()
