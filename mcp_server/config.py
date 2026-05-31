from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mcp_signing_secret: str = "change-me"
    backend_url: str = "http://localhost:8000"
    port: int = 8080


settings = Settings()
