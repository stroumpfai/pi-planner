"""add meeting order index

Revision ID: e5f6a7b8c9d0
Revises: dc004d4ede05
Create Date: 2026-09-04

The Meetings view is an attendance matrix, and a meeting is a **column** in it
(spec/teams.md §7.5). Column order is therefore the team's own — stand-up first,
the quarterly workshop last — and deliberately not chronological: a matrix has no
time axis to sort along, and creation order is an accident of when somebody typed
a row in.

Existing rows all take 0 and keep their relative order behind the tiebreaker
(`order_index`, then `created_at`), so nothing moves under anyone.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'dc004d4ede05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('order_index', sa.Integer(), nullable=False, server_default='0')
        )


def downgrade() -> None:
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.drop_column('order_index')
