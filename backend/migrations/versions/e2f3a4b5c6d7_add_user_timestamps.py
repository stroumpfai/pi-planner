"""add created_at / last_login_at / password_changed_at to users

Revision ID: e2f3a4b5c6d7
Revises: d8e9f0a1b2c3
Create Date: 2026-08-18

Existing accounts back-fill created_at with the migration time — the real value was
never recorded. The two nullable columns stay NULL until the next login / password
change, and render as "Never" in the UI.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now())
        )
        batch_op.add_column(sa.Column('last_login_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('password_changed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('password_changed_at')
        batch_op.drop_column('last_login_at')
        batch_op.drop_column('created_at')
