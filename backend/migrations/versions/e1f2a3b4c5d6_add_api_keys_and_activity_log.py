"""add api_keys and activity_log tables

Revision ID: e1f2a3b4c5d6
Revises: 40d18cf77eec
Create Date: 2026-05-26 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = '40d18cf77eec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add api_keys and activity_logs tables."""
    op.create_table(
        'api_keys',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('key_hash', sa.Text(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('purpose', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['username'], ['users.username']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.create_index('idx_api_keys_username', ['username'], unique=False)
        batch_op.create_index('idx_api_keys_active', ['is_active'], unique=False)

    op.create_table(
        'activity_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            'actor_type',
            sa.Enum('human', 'mcp_bot', name='actor_type'),
            nullable=False,
        ),
        sa.Column('actor_username', sa.String(), nullable=False),
        sa.Column('api_key_id', sa.String(), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('resource_type', sa.String(), nullable=True),
        sa.Column('resource_id', sa.String(), nullable=True),
        sa.Column('project_id', sa.String(), nullable=True),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.ForeignKeyConstraint(['api_key_id'], ['api_keys.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.create_index('idx_activity_logs_actor', ['actor_username'], unique=False)
        batch_op.create_index('idx_activity_logs_timestamp', ['timestamp'], unique=False)
        batch_op.create_index('idx_activity_logs_api_key', ['api_key_id'], unique=False)


def downgrade() -> None:
    """Drop api_keys and activity_logs tables."""
    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.drop_index('idx_activity_logs_api_key')
        batch_op.drop_index('idx_activity_logs_timestamp')
        batch_op.drop_index('idx_activity_logs_actor')

    op.drop_table('activity_logs')

    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.drop_index('idx_api_keys_active')
        batch_op.drop_index('idx_api_keys_username')

    op.drop_table('api_keys')
