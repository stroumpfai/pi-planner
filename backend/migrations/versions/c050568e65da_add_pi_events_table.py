"""add_pi_events_table

Revision ID: c050568e65da
Revises: a7c8d9e0f1b2
Create Date: 2026-06-28 09:21:11.681806

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c050568e65da'
down_revision: Union[str, Sequence[str], None] = 'a7c8d9e0f1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('pi_events',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('pi_id', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('event_date', sa.Date(), nullable=False),
    sa.Column('event_type', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['pi_id'], ['pis.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('system_id')
    )
    with op.batch_alter_table('pi_events', schema=None) as batch_op:
        batch_op.create_index('idx_pi_events_pi_id', ['pi_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('pi_events', schema=None) as batch_op:
        batch_op.drop_index('idx_pi_events_pi_id')

    op.drop_table('pi_events')
