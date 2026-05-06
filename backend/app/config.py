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

    def get_allowed_origins(self) -> list[str]:
        v = self.allowed_origins.strip()
        if v.startswith("["):
            return json.loads(v)
        return [o.strip() for o in v.split(",") if o.strip()]


settings = Settings()
