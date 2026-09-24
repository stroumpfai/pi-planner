"""add team_members.counts_towards_capacity

Revision ID: b9c0d1e2f3a4
Revises: f7a1c2d3e4b5
Create Date: 2026-09-24

A team documents the absences of people who bring no development capacity — a
PO, an SM, a stakeholder — and until now the only way to keep them out of the
totals was to delete them, losing exactly the absence history the team wanted.

Server default true, so every existing member counts as before and no team's
numbers move on upgrade.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9c0d1e2f3a4'
down_revision: Union[str, Sequence[str], None] = 'f7a1c2d3e4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A plain ADD COLUMN, not batch_alter_table: batch mode rebuilds the table on
    # SQLite, and the rebuild silently drops the expression index that keeps
    # member names unique case-insensitively (uq_team_members_name).
    op.add_column(
        'team_members',
        sa.Column(
            'counts_towards_capacity', sa.Boolean(), nullable=False, server_default=sa.text('1')
        ),
    )


def downgrade() -> None:
    # DROP COLUMN is native from SQLite 3.35, so this too avoids a table rebuild.
    op.drop_column('team_members', 'counts_towards_capacity')
