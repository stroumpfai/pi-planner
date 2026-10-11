"""meetings can follow the sprint calendar

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-07

Two sprint-relative meeting rules (ADR 0013):

- ``kind = 'sprint'`` with ``sprint_day`` (first | last) and ``sprint_offset``
  (working days in from that edge) — "review and retro, last day of every sprint".
- ``skip_sprint_days`` (none | first | last | both) on weekly and interval
  meetings — "refinement every Thursday, except at the sprint change".

Every existing meeting keeps its schedule: ``skip_sprint_days`` defaults to
'none' and the sprint columns stay null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain ADD COLUMN rather than batch_alter_table: nothing here needs a rebuild.
    op.add_column('meetings', sa.Column('sprint_day', sa.Text(), nullable=True))
    op.add_column('meetings', sa.Column('sprint_offset', sa.Integer(), nullable=True))
    op.add_column(
        'meetings',
        sa.Column('skip_sprint_days', sa.Text(), nullable=False, server_default=sa.text("'none'")),
    )


def downgrade() -> None:
    # A sprint meeting has no weekly shape to fall back to, so it cannot survive
    # losing its columns — dropped rather than left as a kind nothing can read.
    op.execute("DELETE FROM meeting_attendees WHERE meeting_id IN "
               "(SELECT system_id FROM meetings WHERE kind = 'sprint')")
    op.execute("DELETE FROM meetings WHERE kind = 'sprint'")
    with op.batch_alter_table('meetings') as batch:
        batch.drop_column('skip_sprint_days')
        batch.drop_column('sprint_offset')
        batch.drop_column('sprint_day')
