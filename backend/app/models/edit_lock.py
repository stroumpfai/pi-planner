from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.project import Project


class EditLock(Base):
    __tablename__ = "edit_lock"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(Text, ForeignKey("projects.system_id"), nullable=False, unique=True)
    locked_by_username: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = mapped_column()
    expires_at: Mapped[datetime | None] = mapped_column()

    project: Mapped[Project] = relationship("Project", back_populates="edit_lock")

    __table_args__ = (Index("idx_edit_lock_project", "project_id"),)
