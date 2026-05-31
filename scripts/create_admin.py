#!/usr/bin/env python3
"""
Bootstrap the PI Planning application by creating the initial users.json with
an admin account (or appending a user to an existing file).

Usage:
    python scripts/create_admin.py [--output /path/to/users.json]

The script will prompt for credentials interactively.  Run it once before
starting the container for the first time, or to add further users.

The generated file is consumed by the backend on first startup when the
database is empty (USERS_FILE env var, default /config/users.json).
"""
import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# argon2-cffi is installed in the backend venv, not in the system Python.
# If it is missing, find the project venv and re-execute with it.
# ---------------------------------------------------------------------------
try:
    from argon2 import PasswordHasher  # noqa: E402
except ModuleNotFoundError:
    _root = Path(__file__).resolve().parent.parent
    _candidates = [
        _root / "backend" / "venv"  / "bin" / "python3",
        _root / "backend" / ".venv" / "bin" / "python3",
        _root / "venv"              / "bin" / "python3",
        _root / ".venv"             / "bin" / "python3",
    ]
    _venv_py = next((p for p in _candidates if p.exists()), None)
    if _venv_py:
        raise SystemExit(subprocess.call([str(_venv_py), __file__] + sys.argv[1:]))
    sys.exit(
        "Error: argon2-cffi is not available in this Python.\n"
        "Install the backend dependencies first, then retry:\n\n"
        "  cd backend\n"
        "  python -m venv venv\n"
        "  venv/bin/pip install -e '.[dev]'\n"
        "  cd ..\n"
        "  venv/bin/python scripts/create_admin.py\n"
    )


# Match the parameters used by the application (app/services/auth.py)
_ph = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, hash_len=32, salt_len=16)

_APP_TERMS = {"piplanner", "pi-planner", "pi_planner", "piplan"}

DEFAULT_OUTPUT = os.getenv("USERS_FILE", str(Path(__file__).resolve().parent.parent / "config" / "users.json"))
VALID_ROLES = ("admin", "editor", "reader")


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def validate_password(password: str, username: str) -> str | None:
    """Return an error message, or None if the password is acceptable."""
    if len(password) < 12:
        return "Password must be at least 12 characters."
    if username.lower() in password.lower():
        return "Password must not contain the username."
    if any(term in password.lower() for term in _APP_TERMS):
        return "Password must not relate to the application name (piplanner, piplan, …)."
    return None


def prompt_password(username: str) -> str:
    while True:
        pw1 = getpass.getpass("Password (min 12 chars): ")
        error = validate_password(pw1, username)
        if error:
            print(f"  ✗ {error}")
            continue
        pw2 = getpass.getpass("Confirm password: ")
        if pw1 != pw2:
            print("  ✗ Passwords do not match.")
            continue
        return pw1


def prompt_role() -> str:
    while True:
        role = input("Role [admin/editor/reader] (default: admin): ").strip().lower() or "admin"
        if role in VALID_ROLES:
            return role
        print(f"  ✗ Invalid role. Choose from: {', '.join(VALID_ROLES)}")


def prompt_username(existing_usernames: set, output_path: "Path") -> str:
    while True:
        username = input("Username: ").strip()
        if not username:
            print("  ✗ Username cannot be empty.")
        elif len(username) > 64:
            print("  ✗ Username must be 64 characters or fewer.")
        elif username in existing_usernames:
            print(f"  ✗ Username '{username}' already exists in {output_path}.")
        else:
            return username


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or append a user in users.json for PI Planning")
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Path to users.json (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    output_path = Path(args.output)

    # Load existing file, or start with an empty list
    existing: list[dict] = []
    if output_path.exists():
        try:
            existing = json.loads(output_path.read_text(encoding="utf-8"))
            if not isinstance(existing, list):
                sys.exit(f"Error: {output_path} does not contain a JSON array.")
        except json.JSONDecodeError as exc:
            sys.exit(f"Error: {output_path} is not valid JSON: {exc}")
        print(f"Found existing {output_path} with {len(existing)} user(s).")
        existing_usernames = {u.get("username") for u in existing}
    else:
        existing_usernames = set()
        print("Creating new users.json for PI Planning.")

    print()

    # Username
    username = prompt_username(existing_usernames, output_path)

    # Display name (optional)
    display_name_raw = input("Display name (optional, press Enter to skip): ").strip()
    display_name = display_name_raw or None

    # Role
    role = prompt_role()

    # Password
    print()
    password = prompt_password(username)

    # Build the entry
    entry = {
        "username": username,
        "display_name": display_name,
        "password_hash": hash_password(password),
        "role": role,
    }

    existing.append(entry)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"\n✓ User '{username}' ({role}) written to {output_path}")
    if role == "admin":
        print("  Start the application — the database will be seeded from this file on first run.")
    else:
        print("  Note: the database is only seeded from this file when it is empty.")
        print("  To add users to a running instance, use the admin UI instead.")


if __name__ == "__main__":
    main()
