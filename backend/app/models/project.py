from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

_CASCADE = "all, delete-orphan"


class Project(Base):
    __tablename__ = "projects"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    effort_unit: Mapped[str] = mapped_column(Text, nullable=False, server_default="pts", default="pts")
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    pis: Mapped[list[PI]] = relationship("PI", back_populates="project", cascade=_CASCADE)
    features: Mapped[list[Feature]] = relationship("Feature", back_populates="project", cascade=_CASCADE)
    pbis: Mapped[list[PBI]] = relationship("PBI", back_populates="project", cascade=_CASCADE)
    edit_lock: Mapped[EditLock | None] = relationship("EditLock", back_populates="project", uselist=False, cascade=_CASCADE)
    snapshots: Mapped[list[ProjectSnapshot]] = relationship("ProjectSnapshot", back_populates="project", cascade=_CASCADE)

    __table_args__ = (Index("idx_projects_name", "name"),)
