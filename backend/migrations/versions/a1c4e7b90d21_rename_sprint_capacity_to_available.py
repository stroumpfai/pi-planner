"""rename sprints.capacity to sprints.available

Revision ID: a1c4e7b90d21
Revises: e2f3a4b5c6d7
Create Date: 2026-08-30

A pure column rename — same type, same values, no conversion. "Available" is the
sprint's budget in the project's own effort unit; "capacity" now means what a team
can supply (spec/teams.md §6.2), and the two needed different words.

Snapshot and export payloads are JSON and are never rewritten, so every one taken
before this migration keeps a ``capacity`` key. The restore path reads ``available``
and falls back to ``capacity`` permanently — that fallback is not a transition.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a1c4e7b90d21'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sprints', schema=None) as batch_op:
        batch_op.alter_column(
            'capacity',
            new_column_name='available',
            existing_type=sa.Integer(),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('sprints', schema=None) as batch_op:
        batch_op.alter_column(
            'available',
            new_column_name='capacity',
            existing_type=sa.Integer(),
            existing_nullable=False,
        )
