import enum
from datetime import datetime, timezone

from sqlalchemy import Enum as SAEnum
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Role(str, enum.Enum):
    admin = "admin"
    editor = "editor"
    reader = "reader"


class User(Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String, primary_key=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[Role] = mapped_column(SAEnum(Role, name="role"), nullable=False)
    # Python-side default: every creation path constructs User(...) directly, and the
    # test suite builds its schema from metadata.create_all rather than Alembic.
    created_at: Mapped[datetime] = mapped_column(
        nullable=False, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(nullable=True)
