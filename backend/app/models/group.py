from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Group(Base):
    __tablename__ = "groups"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    swimline_id: Mapped[str] = mapped_column(Text, ForeignKey("swimlines.system_id"), nullable=False)
    feature_system_id: Mapped[str] = mapped_column(Text, ForeignKey("features.system_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sprint_index: Mapped[int | None] = mapped_column(Integer)
    order_index: Mapped[int | None] = mapped_column(Integer)
    is_implicit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    story_system_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("pbis.system_id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    swimline: Mapped[Swimline] = relationship("Swimline", back_populates="groups")
    feature: Mapped[Feature] = relationship("Feature", back_populates="groups")
    pbis: Mapped[list[PBI]] = relationship(
        "PBI",
        back_populates="group",
        primaryjoin="Group.system_id == PBI.group_id",
        foreign_keys="[PBI.group_id]",
    )
    story: Mapped[PBI | None] = relationship(
        "PBI",
        primaryjoin="Group.story_system_id == PBI.system_id",
        foreign_keys="[Group.story_system_id]",
    )

    __table_args__ = (
        Index("idx_groups_swimline", "swimline_id"),
        Index("idx_groups_feature", "feature_system_id"),
        Index(
            "uq_groups_swimline_name_explicit",
            "swimline_id", "name",
            unique=True,
            sqlite_where=text("is_implicit = 0"),
        ),
        Index(
            "uq_implicit_group_story",
            "story_system_id",
            unique=True,
            sqlite_where=text("is_implicit = 1"),
        ),
    )
