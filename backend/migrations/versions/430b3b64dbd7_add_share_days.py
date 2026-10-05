"""shares in days a week, and a share per member

Revision ID: 430b3b64dbd7
Revises: b6c7d8e9f0a1
Create Date: 2026-10-05

``team_projects.share_days`` lets an assignment's share be entered as days a
week, and ``team_project_members.share_pct`` / ``share_days`` give one member a
share of their own (spec/teams.md §6.3.2, ADR 0010). All nullable, so every
existing assignment keeps its percentage and nothing is back-filled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '430b3b64dbd7'
down_revision: Union[str, Sequence[str], None] = 'b6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain ADD COLUMN rather than batch_alter_table: batch mode rebuilds the table
    # on SQLite, and nothing here needs a rebuild.
    op.add_column('team_projects', sa.Column('share_days', sa.Float(), nullable=True))
    op.add_column('team_project_members', sa.Column('share_pct', sa.Integer(), nullable=True))
    op.add_column('team_project_members', sa.Column('share_days', sa.Float(), nullable=True))


def downgrade() -> None:
    # DROP COLUMN is native from SQLite 3.35, so this too avoids a table rebuild.
    op.drop_column('team_project_members', 'share_days')
    op.drop_column('team_project_members', 'share_pct')
    op.drop_column('team_projects', 'share_days')
