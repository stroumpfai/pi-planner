"""add ondelete SET NULL to pbi group_id FK

Revision ID: a1b2c3d4e5f6
Revises: f2a3b4c5d6e7
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('pbis', schema=None) as batch_op:
        batch_op.drop_constraint('fk_pbis_group_id', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_pbis_group_id', 'groups', ['group_id'], ['system_id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    with op.batch_alter_table('pbis', schema=None) as batch_op:
        batch_op.drop_constraint('fk_pbis_group_id', type_='foreignkey')
        batch_op.create_foreign_key(
            'fk_pbis_group_id', 'groups', ['group_id'], ['system_id']
        )
