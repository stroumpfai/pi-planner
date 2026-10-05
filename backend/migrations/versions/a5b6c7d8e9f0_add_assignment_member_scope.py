"""scope a team's project assignment to some of its members

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-10-05

``team_projects.all_members`` (default true, so every existing assignment keeps
counting the whole team) and the ``team_project_members`` join read when it is
off (spec/teams.md §6.3, ADR 0009). Nothing existing is altered or back-filled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, Sequence[str], None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A plain ADD COLUMN, not batch_alter_table, as for counts_towards_capacity:
    # batch mode rebuilds the table on SQLite, and nothing here needs a rebuild.
    op.add_column(
        'team_projects',
        sa.Column('all_members', sa.Boolean(), nullable=False, server_default=sa.text('1')),
    )
    op.create_table(
        'team_project_members',
        sa.Column(
            'team_project_id', sa.Text(),
            sa.ForeignKey('team_projects.system_id', ondelete='CASCADE'), primary_key=True,
        ),
        sa.Column(
            'member_id', sa.Text(),
            sa.ForeignKey('team_members.system_id', ondelete='CASCADE'), primary_key=True,
        ),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index(
        'idx_team_project_members_member', 'team_project_members', ['member_id']
    )


def downgrade() -> None:
    op.drop_index('idx_team_project_members_member', table_name='team_project_members')
    op.drop_table('team_project_members')
    # DROP COLUMN is native from SQLite 3.35, so this too avoids a table rebuild.
    op.drop_column('team_projects', 'all_members')
