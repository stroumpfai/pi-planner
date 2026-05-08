"""add item_type to pbis

Revision ID: c3f9a2e1d847
Revises: b8146781c586
Create Date: 2026-05-08 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3f9a2e1d847'
down_revision: Union[str, Sequence[str], None] = 'b8146781c586'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('pbis', schema=None) as batch_op:
        batch_op.add_column(sa.Column('item_type', sa.Text(), nullable=False, server_default='story'))


def downgrade() -> None:
    with op.batch_alter_table('pbis', schema=None) as batch_op:
        batch_op.drop_column('item_type')
