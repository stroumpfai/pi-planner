"""a project can take the team's remaining capacity

Revision ID: c3d4e5f6a7b8
Revises: 6f20013e7f2d
Create Date: 2026-10-07

``team_projects.share_remaining`` marks the one project of a team that takes
whatever each member's other assignments leave (spec/teams.md §6.3.4, ADR 0012).
A partial unique index keeps it to one per team. Defaults to off, so every
existing assignment keeps its share and nothing is back-filled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = '6f20013e7f2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain ADD COLUMN rather than batch_alter_table: batch mode rebuilds the table
    # on SQLite, and nothing here needs a rebuild.
    op.add_column(
        'team_projects',
        sa.Column('share_remaining', sa.Boolean(), nullable=False, server_default=sa.text('0')),
    )
    op.create_index(
        'uq_team_projects_one_remaining', 'team_projects', ['team_id'],
        unique=True, sqlite_where=sa.text('share_remaining = 1'),
    )


def downgrade() -> None:
    op.drop_index('uq_team_projects_one_remaining', table_name='team_projects')
    op.drop_column('team_projects', 'share_remaining')
