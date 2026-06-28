from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Date, ForeignKey, Index, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.pi import PI

EVENT_TYPES = frozenset({"release", "milestone", "deadline", "pilot", "go_no_go", "other"})


class PIEvent(Base):
    __tablename__ = "pi_events"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    pi_id: Mapped[str] = mapped_column(Text, ForeignKey("pis.system_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False, default="other")
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    pi: Mapped[PI] = relationship("PI", back_populates="events")

    __table_args__ = (Index("idx_pi_events_pi_id", "pi_id"),)
