"""add pbis.completed_on

Revision ID: c1d2e3f4a5b6
Revises: b9c0d1e2f3a4
Create Date: 2026-09-25

The date a story or bug was completed — the one fact velocity needs that the
planner did not record (team-achievement.md §3.2). Nullable, and deliberately
not backfilled: items already in a done State get no date on upgrade, because
stamping today into all of them would collapse a project's history into one
sprint (§9.2).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'b9c0d1e2f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain ADD COLUMN rather than batch_alter_table, which would rebuild the
    # table on SQLite for no benefit.
    op.add_column('pbis', sa.Column('completed_on', sa.Date(), nullable=True))
    op.create_index('idx_pbis_completed_on', 'pbis', ['project_id', 'completed_on'])


def downgrade() -> None:
    op.drop_index('idx_pbis_completed_on', table_name='pbis')
    op.drop_column('pbis', 'completed_on')
