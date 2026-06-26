import json

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite+aiosqlite:///~/.pi-planning/db.sqlite"
    secret_key: str = "change-me"
    debug: bool = False
    session_timeout_minutes: int = 60
    edit_lock_timeout_minutes: int = 30
    # Accepts comma-separated ("http://a,https://b") or JSON array ('["http://a"]')
    allowed_origins: str = "http://localhost:5173"
    users_file: str = "/config/users.json"
    allow_test_reset: bool = False
    mcp_signing_secret: str = ""

    def get_allowed_origins(self) -> list[str]:
        v = self.allowed_origins.strip()
        if v.startswith("["):
            result: list[str] = json.loads(v)
            return result
        return [o.strip() for o in v.split(",") if o.strip()]


settings = Settings()
