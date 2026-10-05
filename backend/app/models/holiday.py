"""Shared holiday calendars, and the teams that enable them (spec/public-holidays.md §3).

A calendar belongs to no team and no project: every team that observes the same
holidays enables the same calendar, the way an Outlook user adds a shared one.
An entry is always a dated range — there is no recurrence (§3.2) — and a member
who works a holiday carries a per-day exception (§3.5).
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import Date, ForeignKey, Index, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.team import _utcnow


class HolidayCalendar(Base):
    __tablename__ = "holiday_calendars"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    # Unique case-insensitively (stored trimmed): a team import matches calendars
    # by name (§8.2), so the name is the calendar's identity outside this database.
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    entries: Mapped[list[HolidayEntry]] = relationship(
        "HolidayEntry", back_populates="calendar", cascade="all, delete-orphan",
        order_by="HolidayEntry.start_date",
    )

    __table_args__ = (Index("uq_holiday_calendars_name", text("lower(name)"), unique=True),)


class HolidayEntry(Base):
    """One holiday: a dated range with a starting and an ending half (§3.2)."""

    __tablename__ = "holiday_entries"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    calendar_id: Mapped[str] = mapped_column(
        Text, ForeignKey("holiday_calendars.system_id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_half: Mapped[str] = mapped_column(Text, nullable=False, default="am")
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_half: Mapped[str] = mapped_column(Text, nullable=False, default="pm")
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    calendar: Mapped[HolidayCalendar] = relationship("HolidayCalendar", back_populates="entries")

    __table_args__ = (Index("idx_holiday_entries_calendar_dates", "calendar_id", "start_date"),)


class TeamHolidayCalendar(Base):
    """The team's switch: a row exists exactly while the calendar is enabled (§3.3)."""

    __tablename__ = "team_holiday_calendars"

    team_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teams.system_id", ondelete="CASCADE"), primary_key=True
    )
    calendar_id: Mapped[str] = mapped_column(
        Text, ForeignKey("holiday_calendars.system_id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)

    __table_args__ = (Index("idx_team_holiday_calendars_calendar", "calendar_id"),)


class HolidayException(Base):
    """A member works this day of this holiday (§3.5).

    A whole day, because the gesture is a click on the member's cell. Exceptions
    belong to the member, not to the switch: disabling the calendar leaves them
    stored and inactive, so re-enabling it brings the on-call record back.
    """

    __tablename__ = "holiday_exceptions"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    member_id: Mapped[str] = mapped_column(
        Text, ForeignKey("team_members.system_id", ondelete="CASCADE"), nullable=False
    )
    entry_id: Mapped[str] = mapped_column(
        Text, ForeignKey("holiday_entries.system_id", ondelete="CASCADE"), nullable=False
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)

    __table_args__ = (
        UniqueConstraint("member_id", "entry_id", "day", name="uq_holiday_exceptions_member_entry_day"),
        Index("idx_holiday_exceptions_entry", "entry_id"),
    )
