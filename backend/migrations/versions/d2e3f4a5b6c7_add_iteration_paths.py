"""add pis.iteration_path and sprints.iteration_path

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-29

The Azure DevOps iteration a PI or sprint corresponds to, set by hand, so a CSV
import can place items from their Iteration Path cell by exact match instead of
guessing from names (docs/adr/0007).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('pis', sa.Column('iteration_path', sa.Text(), nullable=True))
    op.add_column('sprints', sa.Column('iteration_path', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('sprints', 'iteration_path')
    op.drop_column('pis', 'iteration_path')
