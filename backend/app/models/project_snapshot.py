from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from sqlalchemy import JSON, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.project import Project


class ProjectSnapshot(Base):
    __tablename__ = "project_snapshots"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(
        Text, ForeignKey("projects.system_id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # Python-side default at microsecond precision so "the latest snapshot" is
    # deterministic — SQLite's func.now() only has second granularity, which lets
    # two snapshots taken in the same second tie and makes the newest ambiguous.
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    created_by: Mapped[str | None] = mapped_column(Text)
    snapshot_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    project: Mapped[Project] = relationship("Project", back_populates="snapshots")

    __table_args__ = (Index("idx_project_snapshots_project_id", "project_id"),)
