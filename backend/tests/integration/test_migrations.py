"""Exercises the Alembic migration chain against a real file DB.

The rest of the suite builds its schema from `Base.metadata.create_all`, so nothing
else would catch a broken or missing migration — and CLAUDE.md forbids editing a
migration once it is written, which makes catching it before merge the only chance.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
_PREVIOUS_REVISION = "d8e9f0a1b2c3"  # head before user timestamps were added


def _alembic(target: str, db_path: Path) -> None:
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", target],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"alembic upgrade {target} failed:\n{result.stderr}"


def _columns(db_path: Path, table: str) -> dict[str, bool]:
    """Column name → nullable."""
    with sqlite3.connect(db_path) as conn:
        return {row[1]: not row[3] for row in conn.execute(f"PRAGMA table_info({table})")}


def test_upgrade_head_creates_user_timestamp_columns(tmp_path):
    db_path = tmp_path / "migrated.sqlite"
    _alembic("head", db_path)

    columns = _columns(db_path, "users")
    assert columns["created_at"] is False  # NOT NULL
    assert columns["last_login_at"] is True
    assert columns["password_changed_at"] is True


def test_upgrade_backfills_created_at_for_existing_rows(tmp_path):
    db_path = tmp_path / "backfill.sqlite"
    _alembic(_PREVIOUS_REVISION, db_path)

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
            ("legacy", "$argon2id$fake", None, "admin"),
        )

    _alembic("head", db_path)

    with sqlite3.connect(db_path) as conn:
        row = conn.execute(
            "SELECT created_at, last_login_at, password_changed_at FROM users WHERE username = 'legacy'"
        ).fetchone()
    # The real creation time was never recorded; migration time is the only honest value.
    assert row[0] is not None
    assert row[1] is None
    assert row[2] is None
