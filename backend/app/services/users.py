import json
import logging
from pathlib import Path

from app.models.user import User

logger = logging.getLogger(__name__)

_store: dict[str, User] = {}

_VALID_ROLES = {"admin", "reader"}


def load(path: str) -> None:
    """Load users from the JSON config file into memory. Call once at startup."""
    p = Path(path)
    if not p.exists():
        raise RuntimeError(
            f"Users file not found: {path}. "
            "Create it from config/users.json.example and restart."
        )

    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in users file {path}: {exc}") from exc

    if not isinstance(data, list) or not data:
        raise RuntimeError(f"Users file {path} must contain a non-empty JSON array.")

    loaded: dict[str, User] = {}
    for entry in data:
        username = entry.get("username", "").strip()
        if not username:
            raise RuntimeError(f"User entry missing 'username' in {path}: {entry}")
        if username in loaded:
            raise RuntimeError(f"Duplicate username '{username}' in {path}")
        role = entry.get("role", "")
        if role not in _VALID_ROLES:
            raise RuntimeError(f"Invalid role '{role}' for user '{username}' in {path}. Use 'admin' or 'reader'.")
        password_hash = entry.get("password_hash", "")
        if not password_hash.startswith(("$2a$", "$2b$", "$2y$")):
            raise RuntimeError(
                f"password_hash for '{username}' does not look like a bcrypt hash. "
                "Generate one with: python3 -c \"import bcrypt, getpass; "
                "print(bcrypt.hashpw(getpass.getpass().encode(), bcrypt.gensalt(12)).decode())\""
            )
        loaded[username] = User(
            username=username,
            password_hash=password_hash,
            display_name=entry.get("display_name") or None,
            is_admin=(role == "admin"),
        )

    _store.clear()
    _store.update(loaded)
    logger.info("Loaded %d user(s) from %s", len(_store), path)


def get(username: str) -> User | None:
    return _store.get(username)
