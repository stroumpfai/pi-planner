from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.pi import PI


class Sprint(Base):
    __tablename__ = "sprints"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    pi_id: Mapped[str] = mapped_column(Text, ForeignKey("pis.system_id"), nullable=False)
    sprint_index: Mapped[int | None] = mapped_column(Integer)
    available: Mapped[int] = mapped_column(Integer, nullable=False)
    # When a team push last wrote ``available``. Null means never pushed — which
    # is every hand-typed sprint, and every sprint of a `manual` project. The
    # sprint header needs it because the number alone cannot say where it came
    # from: 14 pts typed and 14 pts derived read identically (teams.md §6.6).
    available_pushed_at: Mapped[datetime | None] = mapped_column(DateTime)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    modified_at: Mapped[datetime] = mapped_column(default=func.now(), onupdate=func.now())

    pi: Mapped[PI] = relationship("PI", back_populates="sprints")

    __table_args__ = (
        Index("idx_sprints_pi", "pi_id"),
        UniqueConstraint("pi_id", "sprint_index"),
    )
