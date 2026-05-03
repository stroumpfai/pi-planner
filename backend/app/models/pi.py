from __future__ import annotations

from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import Date, ForeignKey, Index, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PI(Base):
    __tablename__ = "pis"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(Text, ForeignKey("projects.system_id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text, nullable=False, default="draft")
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    project: Mapped[Project] = relationship("Project", back_populates="pis")
    swimlines: Mapped[list[Swimline]] = relationship("Swimline", back_populates="pi", cascade="all, delete-orphan")
    sprints: Mapped[list[Sprint]] = relationship("Sprint", back_populates="pi", cascade="all, delete-orphan")
    features: Mapped[list[Feature]] = relationship("Feature", back_populates="pi")
    pbis: Mapped[list[PBI]] = relationship("PBI", back_populates="pi")

    __table_args__ = (
        Index("idx_pis_project", "project_id"),
        UniqueConstraint("project_id", "name"),
    )
