"""add continued_from_feature_id to features

Revision ID: a4b5c6d7e8f9
Revises: c050568e65da
Create Date: 2026-07-06 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, Sequence[str], None] = 'c050568e65da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('features', schema=None) as batch_op:
        batch_op.add_column(sa.Column('continued_from_feature_id', sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            'fk_features_continued_from_feature_id', 'features', ['continued_from_feature_id'], ['system_id'],
            ondelete='SET NULL'
        )
        batch_op.create_index('idx_features_continued_from', ['continued_from_feature_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('features', schema=None) as batch_op:
        batch_op.drop_index('idx_features_continued_from')
        batch_op.drop_constraint('fk_features_continued_from_feature_id', type_='foreignkey')
        batch_op.drop_column('continued_from_feature_id')
