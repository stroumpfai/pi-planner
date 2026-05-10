"""add implicit group columns

Revision ID: d4e8f2a1b3c9
Revises: c3f9a2e1d847
Create Date: 2026-05-10 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd4e8f2a1b3c9'
down_revision: Union[str, Sequence[str], None] = 'c3f9a2e1d847'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('groups', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_implicit', sa.Boolean(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('story_system_id', sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            'fk_groups_story_system_id', 'pbis', ['story_system_id'], ['system_id'],
            ondelete='CASCADE'
        )
        batch_op.drop_constraint('uq_groups_swimline_name', type_='unique')

    op.execute(
        "CREATE UNIQUE INDEX uq_groups_swimline_name_explicit "
        "ON groups (swimline_id, name) WHERE is_implicit = 0"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_implicit_group_story "
        "ON groups (story_system_id) WHERE is_implicit = 1"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_implicit_group_story")
    op.execute("DROP INDEX IF EXISTS uq_groups_swimline_name_explicit")

    with op.batch_alter_table('groups', schema=None) as batch_op:
        batch_op.drop_constraint('fk_groups_story_system_id', type_='foreignkey')
        batch_op.drop_column('story_system_id')
        batch_op.drop_column('is_implicit')
        batch_op.create_unique_constraint('uq_groups_swimline_name', ['swimline_id', 'name'])
