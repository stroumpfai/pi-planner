"""add ondelete SET NULL to pbi group_id FK

Revision ID: b3c4d5e6f7a8
Revises: f2a3b4c5d6e7
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite does not store named FK constraints, so there is nothing to alter at
    # the DDL level.  The ondelete="SET NULL" annotation on PBI.group_id is
    # enforced by the application layer (_apply_move_to_backlog, clear_all_features)
    # and would be picked up automatically by autogenerate for any future migration
    # to a database that enforces FK actions (e.g. PostgreSQL).
    pass


def downgrade() -> None:
    # No DDL to reverse for the same reason as upgrade.
    pass
