from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite+aiosqlite:///~/.pi-planning/db.sqlite"
    secret_key: str = "change-me"
    debug: bool = False
    session_timeout_minutes: int = 60
    edit_lock_timeout_minutes: int = 30
    allowed_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
