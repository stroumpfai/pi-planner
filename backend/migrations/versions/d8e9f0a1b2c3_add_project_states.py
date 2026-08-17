"""add project_states and state_id on features/pbis

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-08-17

Each project gains three independent State Lists (feature / story / bug), empty for
existing projects. Existing features and PBIs get state_id = NULL — there is nothing
to infer a State from.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_states',
        sa.Column('system_id', sa.Text(), nullable=False),
        sa.Column('project_id', sa.Text(), nullable=False),
        sa.Column('item_type', sa.Text(), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('category', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['project_id'], ['projects.system_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('system_id'),
    )
    op.create_index(
        'idx_project_states_project', 'project_states', ['project_id', 'item_type']
    )
    # Case-insensitive uniqueness within (project, item_type).
    op.create_index(
        'idx_project_states_unique',
        'project_states',
        ['project_id', 'item_type', sa.text('lower(value)')],
        unique=True,
    )

    with op.batch_alter_table('features') as batch_op:
        batch_op.add_column(sa.Column('state_id', sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            'fk_features_state_id', 'project_states', ['state_id'], ['system_id'],
            ondelete='RESTRICT',
        )
        batch_op.create_index('idx_features_state', ['state_id'])

    with op.batch_alter_table('pbis') as batch_op:
        batch_op.add_column(sa.Column('state_id', sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            'fk_pbis_state_id', 'project_states', ['state_id'], ['system_id'],
            ondelete='RESTRICT',
        )
        batch_op.create_index('idx_pbis_state', ['state_id'])


def downgrade() -> None:
    with op.batch_alter_table('pbis') as batch_op:
        batch_op.drop_index('idx_pbis_state')
        batch_op.drop_constraint('fk_pbis_state_id', type_='foreignkey')
        batch_op.drop_column('state_id')

    with op.batch_alter_table('features') as batch_op:
        batch_op.drop_index('idx_features_state')
        batch_op.drop_constraint('fk_features_state_id', type_='foreignkey')
        batch_op.drop_column('state_id')

    op.drop_index('idx_project_states_unique', table_name='project_states')
    op.drop_index('idx_project_states_project', table_name='project_states')
    op.drop_table('project_states')
