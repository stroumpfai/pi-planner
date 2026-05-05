from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Integer, Text, UniqueConstraint, func
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
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    swimline: Mapped[Swimline] = relationship("Swimline", back_populates="groups")
    feature: Mapped[Feature] = relationship("Feature", back_populates="groups")
    pbis: Mapped[list[PBI]] = relationship("PBI", back_populates="group")

    __table_args__ = (
        Index("idx_groups_swimline", "swimline_id"),
        Index("idx_groups_feature", "feature_system_id"),
        UniqueConstraint("swimline_id", "name"),
    )
