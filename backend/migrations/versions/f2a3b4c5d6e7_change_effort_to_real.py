"""change pbi effort column from INTEGER to REAL

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('pbis', schema=None) as batch_op:
        batch_op.alter_column(
            'effort',
            existing_type=sa.Integer(),
            type_=sa.Float(),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table('pbis', schema=None) as batch_op:
        batch_op.alter_column(
            'effort',
            existing_type=sa.Float(),
            type_=sa.Integer(),
            existing_nullable=True,
        )
