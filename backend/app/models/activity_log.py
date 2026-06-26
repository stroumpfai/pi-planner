from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.database import Base


class ActorType(str, enum.Enum):
    human = "human"
    mcp_bot = "mcp_bot"


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_type: Mapped[ActorType] = mapped_column(
        SAEnum(ActorType, name="actor_type"), nullable=False
    )
    actor_username: Mapped[str] = mapped_column(String, nullable=False)
    api_key_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("api_keys.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String, nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String, nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="success")

    __table_args__ = (
        Index("idx_activity_logs_actor", "actor_username"),
        Index("idx_activity_logs_timestamp", "timestamp"),
        Index("idx_activity_logs_api_key", "api_key_id"),
    )
