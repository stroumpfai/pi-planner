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

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
_PREVIOUS_REVISION = "d8e9f0a1b2c3"  # head before user timestamps were added

# created_at / modified_at are SQLAlchemy-side defaults, so raw SQL has to supply them.
_NOW = "2026-08-30 12:00:00"


def _insert_team(system_id: str, name: str) -> str:
    return (
        "INSERT INTO teams (system_id, name, normal_day_hours, created_at, modified_at)"
        f" VALUES ('{system_id}', '{name}', 8.0, '{_NOW}', '{_NOW}')"
    )


def _insert_member(system_id: str, team_id: str, name: str, order_index: int) -> str:
    return (
        "INSERT INTO team_members (system_id, team_id, name, order_index, created_at, modified_at)"
        f" VALUES ('{system_id}', '{team_id}', '{name}', {order_index}, '{_NOW}', '{_NOW}')"
    )


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


def test_rename_preserves_sprint_budget_values(tmp_path):
    """capacity -> available is a rename: the numbers already in the column survive."""
    db_path = tmp_path / "rename.sqlite"
    _alembic("e2f3a4b5c6d7", db_path)  # head before the rename

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "INSERT INTO projects (system_id, name, effort_unit, created_at, modified_at)"
            f" VALUES ('p1', 'P', 'pts', '{_NOW}', '{_NOW}')"
        )
        conn.execute(
            "INSERT INTO pis (system_id, project_id, name, state, created_at, modified_at)"
            f" VALUES ('pi1', 'p1', 'Q1', 'draft', '{_NOW}', '{_NOW}')"
        )
        conn.execute(
            "INSERT INTO sprints (system_id, pi_id, sprint_index, capacity, created_at, modified_at)"
            f" VALUES ('s1', 'pi1', 0, 34, '{_NOW}', '{_NOW}')"
        )

    _alembic("head", db_path)

    columns = _columns(db_path, "sprints")
    assert "available" in columns
    assert "capacity" not in columns
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT available FROM sprints WHERE system_id = 's1'").fetchone()[0] == 34


def test_upgrade_head_creates_team_tables(tmp_path):
    db_path = tmp_path / "teams.sqlite"
    _alembic("head", db_path)

    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {
        "teams", "team_members", "member_pattern_versions",
        "absences", "meetings", "meeting_attendees", "team_projects",
    } <= tables

    versions = _columns(db_path, "member_pattern_versions")
    for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
        assert f"{day}_am" in versions and f"{day}_pm" in versions
    # Half-open intervals are derived from effective_from alone — there is no end.
    assert "effective_to" not in versions


def test_team_and_member_names_are_case_insensitively_unique(tmp_path):
    """SQLite cannot reflect expression indexes, so these two are hand-written."""
    db_path = tmp_path / "unique.sqlite"
    _alembic("head", db_path)

    with sqlite3.connect(db_path) as conn:
        conn.execute(_insert_team("t1", "Platform"))
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(_insert_team("t2", "platform"))

        conn.execute(_insert_member("m1", "t1", "Alice", 0))
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(_insert_member("m2", "t1", "alice", 1))
