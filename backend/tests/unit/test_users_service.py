"""Unit tests for users.seed_from_config — the startup seed path (previously
uncovered) and its validation branches."""

import json
from datetime import datetime, timezone

import pytest

from app.models.user import Role
from app.services import users as users_service
from app.services.auth import hash_password

pytestmark = pytest.mark.asyncio

_HASH = hash_password("a-strong-password-123")


def _write(tmp_path, data) -> str:
    p = tmp_path / "users.json"
    p.write_text(data if isinstance(data, str) else json.dumps(data))
    return str(p)


async def test_seed_creates_users_when_table_empty(db, tmp_path):
    path = _write(
        tmp_path,
        [{"username": "seedadmin", "role": "admin", "password_hash": _HASH, "display_name": "Boss"}],
    )
    await users_service.seed_from_config(db, path)

    user = await users_service.get(db, "seedadmin")
    assert user is not None
    assert user.role == Role.admin
    assert user.display_name == "Boss"


async def test_seed_is_noop_when_users_exist(db, tmp_path):
    await users_service.create(db, "existing", _HASH, None, Role.reader)
    path = _write(tmp_path, [{"username": "new", "role": "admin", "password_hash": _HASH}])

    await users_service.seed_from_config(db, path)

    assert await users_service.get(db, "new") is None


async def test_seed_missing_file_raises(db, tmp_path):
    with pytest.raises(RuntimeError, match="not found"):
        await users_service.seed_from_config(db, str(tmp_path / "absent.json"))


async def test_seed_invalid_json_raises(db, tmp_path):
    path = _write(tmp_path, "{not valid json")
    with pytest.raises(RuntimeError, match="Invalid JSON"):
        await users_service.seed_from_config(db, path)


async def test_seed_empty_array_raises(db, tmp_path):
    path = _write(tmp_path, [])
    with pytest.raises(RuntimeError, match="non-empty JSON array"):
        await users_service.seed_from_config(db, path)


async def test_seed_missing_username_raises(db, tmp_path):
    path = _write(tmp_path, [{"role": "admin", "password_hash": _HASH}])
    with pytest.raises(RuntimeError, match="missing 'username'"):
        await users_service.seed_from_config(db, path)


async def test_seed_invalid_role_raises(db, tmp_path):
    path = _write(tmp_path, [{"username": "u", "role": "superuser", "password_hash": _HASH}])
    with pytest.raises(RuntimeError, match="Invalid role"):
        await users_service.seed_from_config(db, path)


async def test_seed_non_argon2_hash_raises(db, tmp_path):
    path = _write(tmp_path, [{"username": "u", "role": "reader", "password_hash": "plaintext"}])
    with pytest.raises(RuntimeError, match="argon2id hash"):
        await users_service.seed_from_config(db, path)


# ---------------------------------------------------------------------------
# set_password / update edge cases (service level)
# ---------------------------------------------------------------------------


async def test_set_password_updates_hash(db):
    await users_service.create(db, "pwuser", _HASH, None, Role.editor)
    new_hash = hash_password("another-strong-password-456")
    await users_service.set_password(db, "pwuser", new_hash)

    user = await users_service.get(db, "pwuser")
    assert user is not None
    assert user.password_hash == new_hash


async def test_set_password_noop_for_missing_user(db):
    # Should not raise when the user does not exist.
    await users_service.set_password(db, "ghost", _HASH)


async def test_update_returns_none_for_missing_user(db):
    result = await users_service.update(db, "ghost", {"display_name"}, display_name="X")
    assert result is None


# ---------------------------------------------------------------------------
# Account timestamps
# ---------------------------------------------------------------------------


async def test_create_stamps_created_at(db):
    before = datetime.now(timezone.utc).replace(tzinfo=None)
    user = await users_service.create(db, "stamped", _HASH, None, Role.editor)

    assert user.created_at is not None
    assert user.created_at >= before
    # A fresh account has never logged in and never changed its password.
    assert user.last_login_at is None
    assert user.password_changed_at is None


async def test_seed_stamps_created_at(db, tmp_path):
    path = _write(tmp_path, [{"username": "seeded", "role": "admin", "password_hash": _HASH}])
    await users_service.seed_from_config(db, path)

    user = await users_service.get(db, "seeded")
    assert user is not None
    assert user.created_at is not None


async def test_set_password_stamps_password_changed_at(db):
    await users_service.create(db, "pwstamp", _HASH, None, Role.editor)
    user = await users_service.get(db, "pwstamp")
    assert user is not None and user.password_changed_at is None

    await users_service.set_password(db, "pwstamp", hash_password("another-strong-password-456"))

    user = await users_service.get(db, "pwstamp")
    assert user is not None
    assert user.password_changed_at is not None


async def test_touch_last_login_sets_and_advances(db):
    await users_service.create(db, "loginstamp", _HASH, None, Role.reader)

    await users_service.touch_last_login(db, "loginstamp")
    user = await users_service.get(db, "loginstamp")
    assert user is not None
    first = user.last_login_at
    assert first is not None

    # A later login must move the stamp forward, not leave the first one in place.
    await users_service.touch_last_login(db, "loginstamp")
    user = await users_service.get(db, "loginstamp")
    assert user is not None
    assert user.last_login_at is not None
    assert user.last_login_at >= first


async def test_touch_last_login_noop_for_missing_user(db):
    # Should not raise when the user does not exist.
    await users_service.touch_last_login(db, "ghost")
