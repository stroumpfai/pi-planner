from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.feature import Feature
    from app.models.group import Group
    from app.models.pbi import PBI
    from app.models.pi import PI


class Swimline(Base):
    __tablename__ = "swimlines"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    pi_id: Mapped[str] = mapped_column(Text, ForeignKey("pis.system_id"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    order_index: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    pi: Mapped[PI] = relationship("PI", back_populates="swimlines")
    groups: Mapped[list[Group]] = relationship("Group", back_populates="swimline", cascade="all, delete-orphan")
    features: Mapped[list[Feature]] = relationship("Feature", back_populates="swimline")
    pbis: Mapped[list[PBI]] = relationship("PBI", back_populates="swimline")

    __table_args__ = (
        Index("idx_swimlines_pi", "pi_id"),
        UniqueConstraint("pi_id", "name"),
    )
