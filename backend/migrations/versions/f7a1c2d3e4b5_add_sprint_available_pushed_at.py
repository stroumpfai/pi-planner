"""add sprints.available_pushed_at

Revision ID: f7a1c2d3e4b5
Revises: e5f6a7b8c9d0
Create Date: 2026-09-06

Available reaches a project through an explicit push (spec/teams.md §6.7), so a
sprint header has to be able to say **when** the number it shows arrived and
whether anything has moved since. The value alone cannot: 14 pts typed by hand
and 14 pts pushed from a team read identically.

Nullable, and null means *never pushed* — which is what every existing row is,
and what an unassigned or `manual` project stays. It is deliberately not
back-filled with the migration's own timestamp: that would claim a push that
never happened, and the home page would report every project in sync with a team
it has never heard of.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7a1c2d3e4b5'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sprints', schema=None) as batch_op:
        batch_op.add_column(sa.Column('available_pushed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('sprints', schema=None) as batch_op:
        batch_op.drop_column('available_pushed_at')
