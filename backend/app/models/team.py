from __future__ import annotations

from datetime import date, datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.project import Project

_CASCADE = "all, delete-orphan"


def _utcnow() -> datetime:
    """Python-side timestamp at microsecond precision.

    Team rows are versioned by ``modified_at``: it is the ETag every team write
    quotes back in ``If-Match`` (teams.md §4.2). SQLite's ``func.now()`` only has
    second granularity, so two writes inside the same second would share a tag and
    the second would silently overwrite the first.
    """
    return datetime.now(timezone.utc)

# Default divisor turning hours into person-days. A PD is a unit of *work*, not of
# presence: a 6 h/day part-timer's full day is 0.75 PD, never 1.0 (teams.md §5.2).
DEFAULT_NORMAL_DAY_HOURS = 8.0

# The three schedule shapes shared by absences and meetings (teams.md §3.4). "interval"
# is its own kind rather than a number on "weekly" so the common case has nothing to
# fill in.
SCHEDULE_KINDS = ("range", "weekly", "interval")

# How a project's Available budget is produced from the team (teams.md §6.4).
# "velocity" is Phase 2 and nothing writes it yet.
AVAILABLE_SOURCES = ("manual", "factor")


class Team(Base):
    """A group of people, modelled independently of any project.

    The same people serve several projects and a team outlives any single PI, so a
    team is not owned by a project — it is assigned to them (``TeamProject``).
    Teams are not planning items: the dual-ID system does not apply, so there is no
    ``user_id`` here (teams.md §3.1).
    """

    __tablename__ = "teams"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    normal_day_hours: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text(str(DEFAULT_NORMAL_DAY_HOURS)),
        default=DEFAULT_NORMAL_DAY_HOURS,
    )
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    members: Mapped[list[TeamMember]] = relationship(
        "TeamMember", back_populates="team", cascade=_CASCADE,
        order_by="TeamMember.order_index",
    )
    absences: Mapped[list[Absence]] = relationship(
        "Absence", back_populates="team", cascade=_CASCADE
    )
    meetings: Mapped[list[Meeting]] = relationship(
        "Meeting", back_populates="team", cascade=_CASCADE,
        order_by="Meeting.order_index",
    )
    projects: Mapped[list[TeamProject]] = relationship(
        "TeamProject", back_populates="team", cascade=_CASCADE,
        order_by="TeamProject.created_at",
    )

    __table_args__ = (
        # Case-insensitive uniqueness: "Platform" and "platform" are one team.
        Index("uq_teams_name", text("lower(name)"), unique=True),
    )


class TeamMember(Base):
    """A person on a team — a manual entry, deliberately not linked to ``users``.

    You plan for people who have no account here: contractors, colleagues from
    another department, someone who starts next month (teams.md §3.2).

    The row holds only what has no date: who they are, and when they joined and
    left. Everything that varies over time — worked half-days, day length, focus —
    lives on the dated ``MemberPatternVersion``.
    """

    __tablename__ = "team_members"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    team_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teams.system_id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # Descriptive free text, never read by the capacity maths. No enum and no
    # vocabulary table: a dropdown would imply a list somebody maintains (§3.2).
    role: Mapped[str | None] = mapped_column(Text)
    organisation: Mapped[str | None] = mapped_column(Text)
    # Membership validity. Half-days outside the window contribute nothing, which is
    # what lets a leaver keep their absence history instead of being deleted.
    active_from: Mapped[date | None] = mapped_column(Date)
    active_to: Mapped[date | None] = mapped_column(Date)
    # False for people whose absences the team documents but who bring no
    # development capacity — a PO, an SM, a stakeholder. Their own capacity is
    # still computed and shown; it just never reaches the team total, the
    # projects' share, or a push. Deliberately undated, unlike every other input
    # to capacity: it says what kind of entry this row is, not how much the
    # person works (docs/adr/0005).
    counts_towards_capacity: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("1"), default=True
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    team: Mapped[Team] = relationship("Team", back_populates="members")
    pattern_versions: Mapped[list[MemberPatternVersion]] = relationship(
        "MemberPatternVersion", back_populates="member", cascade=_CASCADE,
        order_by="MemberPatternVersion.effective_from",
    )
    absences: Mapped[list[Absence]] = relationship(
        "Absence", back_populates="member", cascade=_CASCADE
    )
    meeting_attendances: Mapped[list[MeetingAttendee]] = relationship(
        "MeetingAttendee", back_populates="member", cascade=_CASCADE
    )

    __table_args__ = (
        Index("idx_team_members_team", "team_id"),
        Index("uq_team_members_name", "team_id", text("lower(name)"), unique=True),
    )


class MemberPatternVersion(Base):
    """One dated version of a member's working pattern (their contract).

    Intervals are **half-open and derived**: a version holds from its
    ``effective_from`` until the day before the next one, and the latest holds
    indefinitely. There is deliberately no ``effective_to`` column — storing both
    ends invites gaps and overlaps that then need validating and repairing. With one
    date per version a gap cannot be expressed (teams.md §3.3).

    The **earliest version extends backwards without limit**, so no date is ever
    undefined and no capacity query has to handle a missing pattern.
    """

    __tablename__ = "member_pattern_versions"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    member_id: Mapped[str] = mapped_column(
        Text, ForeignKey("team_members.system_id", ondelete="CASCADE"), nullable=False
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)

    mon_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    mon_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tue_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tue_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    wed_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    wed_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    thu_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    thu_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    fri_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    fri_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sat_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sat_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sun_am: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sun_pm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Hours in one *full* contracted day. Not the PD divisor — that is the team's
    # normal_day_hours, shared by everyone (teams.md §5.2).
    hours_per_day: Mapped[float] = mapped_column(Float, nullable=False, default=8.0)
    # Versioned like everything else that changes on a date: focus moves when someone
    # joins a support rota or picks up a second product (teams.md §3.3).
    focus: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    member: Mapped[TeamMember] = relationship("TeamMember", back_populates="pattern_versions")

    __table_args__ = (
        Index("idx_member_pattern_versions_member", "member_id"),
        # One version per date: adding a version on an existing date edits it.
        Index("uq_member_pattern_versions_date", "member_id", "effective_from", unique=True),
    )


class Absence(Base):
    """When a member is not there for half-days they would otherwise owe.

    There is no absence category — an absence is an absence, and ``label`` is text
    for the human reading the row (teams.md §3.4). The schedule rule below is
    identical to a meeting's; the two differ only in what an occurrence costs.
    """

    __tablename__ = "absences"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    team_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teams.system_id", ondelete="CASCADE"), nullable=False
    )
    member_id: Mapped[str] = mapped_column(
        Text, ForeignKey("team_members.system_id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str | None] = mapped_column(Text)

    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # For every kind this is the anchor, not just a boundary: occurrences of a
    # recurring rule fall every interval_weeks from the first match on or after it.
    # ISO week parity would break at the year boundary (teams.md §3.4).
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    # range only — which half the block opens and closes on.
    start_half: Mapped[str | None] = mapped_column(Text)
    end_half: Mapped[str | None] = mapped_column(Text)
    # weekly / interval only.
    weekday: Mapped[int | None] = mapped_column(Integer)
    halves: Mapped[str | None] = mapped_column(Text)
    interval_weeks: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    team: Mapped[Team] = relationship("Team", back_populates="absences")
    member: Mapped[TeamMember] = relationship("TeamMember", back_populates="absences")

    __table_args__ = (
        Index("idx_absences_team", "team_id"),
        Index("idx_absences_member", "member_id"),
        Index("idx_absences_member_dates", "member_id", "start_date"),
    )


class Meeting(Base):
    """Booked time a member does not have, deducted before focus.

    A recurring meeting is **one row, not one row per occurrence**: a daily stand-up
    over a year is one weekly rule per weekday, not 250 records (teams.md §3.5).

    ``half`` says where an occurrence *starts*. A meeting longer than that half
    spills into the rest of the same day, and the day's total is clamped to the
    hours that survived absences — so a meeting on an absent morning costs nothing.
    """

    __tablename__ = "meetings"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    team_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teams.system_id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)

    kind: Mapped[str] = mapped_column(Text, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    weekday: Mapped[int | None] = mapped_column(Integer)
    interval_weeks: Mapped[int | None] = mapped_column(Integer)

    half: Mapped[str] = mapped_column(Text, nullable=False)
    # Minutes, not hours: a five-minute stand-up is 5, and no float count of hours
    # reads well at 0.0833 (teams.md §3.5). 5–480, in steps of 5.
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Column order in the attendance matrix, set by the team. Not chronological:
    # a matrix has no time axis, and the order people want is the one they read
    # their week in — stand-up first, the quarterly workshop last (§7.5).
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)

    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    team: Mapped[Team] = relationship("Team", back_populates="meetings")
    attendees: Mapped[list[MeetingAttendee]] = relationship(
        "MeetingAttendee", back_populates="meeting", cascade=_CASCADE
    )

    __table_args__ = (
        Index("idx_meetings_team", "team_id"),
    )


class MeetingAttendee(Base):
    """One member's attendance at one meeting.

    A pure join: attendance is edited through the meeting, which carries the
    concurrency token for both (teams.md §4.2 lists the rows holding ``modified_at``
    and this is not one of them).
    """

    __tablename__ = "meeting_attendees"

    meeting_id: Mapped[str] = mapped_column(
        Text, ForeignKey("meetings.system_id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[str] = mapped_column(
        Text, ForeignKey("team_members.system_id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)

    meeting: Mapped[Meeting] = relationship("Meeting", back_populates="attendees")
    member: Mapped[TeamMember] = relationship("TeamMember", back_populates="meeting_attendances")

    __table_args__ = (
        Index("idx_meeting_attendees_meeting", "meeting_id"),
        Index("idx_meeting_attendees_member", "member_id"),
    )


class TeamProject(Base):
    """A team's assignment to one project, and how its PD reaches that project.

    A team serves many projects; a project is served by **at most one** team, which
    is what the unique index on ``project_id`` enforces (teams.md §6.1). The
    earliest assignment is the team's **anchor**: its sprint calendar is the one the
    team's own views count in (§6.8).
    """

    __tablename__ = "team_projects"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    team_id: Mapped[str] = mapped_column(
        Text, ForeignKey("teams.system_id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(
        Text, ForeignKey("projects.system_id", ondelete="CASCADE"), nullable=False
    )
    # 1–100. Shares summing over 100% warn but never block: teams really are
    # overcommitted, and refusing to represent that hides what the tool exists to
    # reveal (teams.md §6.3).
    share_pct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("100"), default=100)
    available_source: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="manual", default="manual"
    )
    # Always the user's, validated for nothing beyond > 0. effort_unit is free text,
    # so the app cannot tell points from hours and does not try (teams.md §6.4).
    units_per_pd: Mapped[float] = mapped_column(
        Float, nullable=False, server_default=text("1.0"), default=1.0
    )
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    modified_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    team: Mapped[Team] = relationship("Team", back_populates="projects")
    project: Mapped[Project] = relationship("Project")

    __table_args__ = (
        Index("idx_team_projects_team", "team_id"),
        Index("uq_team_projects_project", "project_id", unique=True),
    )
