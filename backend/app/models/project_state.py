from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.project import Project

# The three item types that each carry their own, independent State List.
STATE_ITEM_TYPES = ("feature", "story", "bug")

MAX_STATE_LENGTH = 100


class ProjectState(Base):
    """One entry in a project's State List for a single item type.

    Each project owns three independent lists (feature / story / bug), empty until a
    CSV import discovers values or a user types one. Entries are compared after
    trimming and lower-casing, but stored with the first spelling seen.
    """

    __tablename__ = "project_states"

    system_id: Mapped[str] = mapped_column(Text, primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(
        Text, ForeignKey("projects.system_id", ondelete="CASCADE"), nullable=False
    )
    item_type: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Reserved for the future progress/filtering feature: "not_started" | "in_progress" | "done".
    # Nothing writes this yet.
    category: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    project: Mapped[Project] = relationship("Project", back_populates="states")

    __table_args__ = (
        Index("idx_project_states_project", "project_id", "item_type"),
        # Case-insensitive uniqueness: "Done" and "done" are the same State.
        Index(
            "idx_project_states_unique",
            "project_id",
            "item_type",
            text("lower(value)"),
            unique=True,
        ),
    )


def normalise_state(raw: str) -> str:
    """The comparison key for State equality: trimmed, case-insensitive."""
    return raw.strip().lower()
