from dataclasses import dataclass


@dataclass
class User:
    username: str
    password_hash: str
    display_name: str | None
    is_admin: bool
