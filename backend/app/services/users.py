import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Role, User

logger = logging.getLogger(__name__)

_VALID_ROLES = {"admin", "editor", "reader"}


def _utcnow() -> datetime:
    """Naive UTC, matching how every other datetime in the app is stored."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def get(db: AsyncSession, username: str) -> User | None:
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def list_all(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.username))
    return list(result.scalars().all())


async def create(
    db: AsyncSession,
    username: str,
    password_hash: str,
    display_name: str | None,
    role: Role,
) -> User:
    user = User(
        username=username,
        password_hash=password_hash,
        display_name=display_name,
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update(
    db: AsyncSession,
    username: str,
    updated_fields: set[str],
    display_name: str | None = None,
    role: Role | None = None,
) -> User | None:
    user = await get(db, username)
    if not user:
        return None
    if "display_name" in updated_fields:
        user.display_name = display_name
    if role is not None:
        user.role = role
    await db.commit()
    await db.refresh(user)
    return user


async def set_password(db: AsyncSession, username: str, new_hash: str) -> None:
    """The single funnel for both admin reset-password and self-service change-password."""
    user = await get(db, username)
    if user:
        user.password_hash = new_hash
        user.password_changed_at = _utcnow()
        await db.commit()


async def touch_last_login(db: AsyncSession, username: str) -> None:
    """Stamp an interactive login. Not called from authenticate() — that is reachable
    from non-interactive paths — nor from the MCP service-JWT path."""
    user = await get(db, username)
    if user:
        user.last_login_at = _utcnow()
        await db.commit()


async def delete(db: AsyncSession, username: str) -> None:
    user = await get(db, username)
    if user:
        await db.delete(user)
        await db.commit()


async def count(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(User))
    return result.scalar_one()


async def count_by_role(db: AsyncSession, role: Role) -> int:
    result = await db.execute(
        select(func.count()).select_from(User).where(User.role == role)
    )
    return result.scalar_one()


async def seed_from_config(db: AsyncSession, path: str) -> None:
    """Seed users from config/users.json if the users table is empty."""
    if await count(db) > 0:
        return

    p = Path(path)
    if not p.exists():
        raise RuntimeError(
            f"ERROR: No users in database and {path} not found.\n"
            "Create it from config/users.json.example (contains a default admin account) "
            "and restart the server."
        )

    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in users file {path}: {exc}") from exc

    if not isinstance(data, list) or not data:
        raise RuntimeError(f"Users file {path} must contain a non-empty JSON array.")

    for entry in data:
        username = entry.get("username", "").strip()
        if not username:
            raise RuntimeError(f"User entry missing 'username' in {path}: {entry}")
        role_str = entry.get("role", "")
        if role_str not in _VALID_ROLES:
            raise RuntimeError(
                f"Invalid role '{role_str}' for user '{username}' in {path}. "
                "Use 'admin', 'editor', or 'reader'."
            )
        password_hash = entry.get("password_hash", "")
        if not password_hash.startswith("$argon2"):
            raise RuntimeError(
                f"password_hash for '{username}' does not look like an argon2id hash. "
                "Generate one with: python3 -c \"from app.services.auth import hash_password; "
                "import getpass; print(hash_password(getpass.getpass()))\""
            )
        user = User(
            username=username,
            password_hash=password_hash,
            display_name=entry.get("display_name") or None,
            role=Role(role_str),
        )
        db.add(user)
        logger.info("Seeded user '%s' (role: %s) from %s", username, role_str, path)

    await db.commit()
    logger.info("User seed complete from %s", path)
