from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Index, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Session(Base):
    __tablename__ = "sessions"

    session_id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column()
    remember_me: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("idx_sessions_username", "username"),
        Index("idx_sessions_expires", "expires_at"),
        UniqueConstraint("username", "session_id"),
    )
