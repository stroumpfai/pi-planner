from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Feature(Base):
    __tablename__ = "features"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(Text, ForeignKey("projects.system_id"), nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    effort: Mapped[int | None] = mapped_column(Integer)
    location: Mapped[str] = mapped_column(Text, nullable=False, default="backlog")
    pi_id: Mapped[str | None] = mapped_column(Text, ForeignKey("pis.system_id"))
    swimlane_id: Mapped[str | None] = mapped_column(Text, ForeignKey("swimlines.system_id"))
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    project: Mapped[Project] = relationship("Project", back_populates="features")
    pi: Mapped[PI | None] = relationship("PI", back_populates="features")
    swimline: Mapped[Swimline | None] = relationship("Swimline", back_populates="features")
    pbis: Mapped[list[PBI]] = relationship("PBI", back_populates="feature", cascade="all, delete-orphan")
    groups: Mapped[list[Group]] = relationship("Group", back_populates="feature", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_features_project", "project_id"),
        Index("idx_features_user_id", "project_id", "user_id"),
        Index("idx_features_pi", "pi_id"),
        Index("idx_features_swimlane", "swimlane_id"),
        UniqueConstraint("project_id", "user_id"),
    )
