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
    # Relative to the backend process's cwd — "backend/" in local dev (docs/ is its
    # sibling), overridden to an absolute container path in Dockerfile/docker-compose.
    release_notes_file: str = "../docs/RELEASE-NOTES.md"
    allow_test_reset: bool = False
    mcp_signing_secret: str = ""

    def get_allowed_origins(self) -> list[str]:
        v = self.allowed_origins.strip()
        if v.startswith("["):
            result: list[str] = json.loads(v)
            return result
        return [o.strip() for o in v.split(",") if o.strip()]


settings = Settings()


# Every placeholder shipped in an example file contains this marker, so matching
# it catches all of them (and any future one) rather than a hand-kept list.
_PLACEHOLDER_MARKER = "change-me"
MIN_SECRET_LENGTH = 32


def secret_problem(value: str) -> str | None:
    """Why *value* is unfit to sign anything, or None when it is fine.

    Shared by SECRET_KEY and MCP_SIGNING_SECRET. The MCP server applies the same
    rule (mcp_server/config.py) — a signing secret that is anyone's to read lets
    them mint a service JWT for any actor, admin included.
    """
    if not value:
        return "is not set"
    if _PLACEHOLDER_MARKER in value.lower():
        return "is still the example placeholder"
    if len(value) < MIN_SECRET_LENGTH:
        return f"is shorter than {MIN_SECRET_LENGTH} characters"
    return None
