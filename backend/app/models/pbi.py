from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PBI(Base):
    __tablename__ = "pbis"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(Text, ForeignKey("projects.system_id"), nullable=False)
    user_id: Mapped[int | None] = mapped_column(Integer)
    parent_feature_system_id: Mapped[str] = mapped_column(Text, ForeignKey("features.system_id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    effort: Mapped[int | None] = mapped_column(Integer)
    item_type: Mapped[str] = mapped_column(Text, nullable=False, default="story")
    location: Mapped[str] = mapped_column(Text, nullable=False, default="backlog")
    pi_id: Mapped[str | None] = mapped_column(Text, ForeignKey("pis.system_id"))
    swimlane_id: Mapped[str | None] = mapped_column(Text, ForeignKey("swimlines.system_id"))
    group_id: Mapped[str | None] = mapped_column(Text, ForeignKey("groups.system_id"))
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    project: Mapped[Project] = relationship("Project", back_populates="pbis")
    feature: Mapped[Feature] = relationship("Feature", back_populates="pbis")
    pi: Mapped[PI | None] = relationship("PI", back_populates="pbis")
    swimline: Mapped[Swimline | None] = relationship("Swimline", back_populates="pbis")
    group: Mapped[Group | None] = relationship("Group", back_populates="pbis")

    __table_args__ = (
        Index("idx_pbis_project", "project_id"),
        Index("idx_pbis_user_id", "project_id", "user_id"),
        Index("idx_pbis_parent", "parent_feature_system_id"),
        Index("idx_pbis_pi", "pi_id"),
        Index("idx_pbis_group", "group_id"),
        UniqueConstraint("project_id", "user_id"),
    )
