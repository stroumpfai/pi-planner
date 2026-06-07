"""add project_snapshots table

Revision ID: a7c8d9e0f1b2
Revises: b3c4d5e6f7a8
Create Date: 2026-06-07 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7c8d9e0f1b2'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add project_snapshots table."""
    op.create_table(
        'project_snapshots',
        sa.Column('system_id', sa.Text(), nullable=False),
        sa.Column('project_id', sa.Text(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.Text(), nullable=True),
        sa.Column('snapshot_data', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.system_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('system_id'),
    )
    with op.batch_alter_table('project_snapshots', schema=None) as batch_op:
        batch_op.create_index('idx_project_snapshots_project_id', ['project_id'], unique=False)


def downgrade() -> None:
    """Drop project_snapshots table."""
    with op.batch_alter_table('project_snapshots', schema=None) as batch_op:
        batch_op.drop_index('idx_project_snapshots_project_id')

    op.drop_table('project_snapshots')
