"""imported absences remember the calendar event they came from

Revision ID: 6f20013e7f2d
Revises: 430b3b64dbd7
Create Date: 2026-10-06

``absences.source_uid`` is the ``UID`` of the ``.ics`` event an absence was
imported from, so re-importing an updated file updates the row instead of
adding a second one (spec/teams.md §7.4.1, ADR 0011). Nullable and not
back-filled: every existing absence was entered by hand, and stays that way.

The unique index is partial. Hand-entered rows all carry NULL and must not
collide; imported ones are unique per member, which is the import's upsert key.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6f20013e7f2d'
down_revision: Union[str, Sequence[str], None] = '430b3b64dbd7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain ADD COLUMN, as in 430b3b64dbd7: batch mode would rebuild the table.
    op.add_column('absences', sa.Column('source_uid', sa.Text(), nullable=True))
    op.create_index(
        'ux_absences_member_source_uid', 'absences', ['member_id', 'source_uid'],
        unique=True, sqlite_where=sa.text('source_uid IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('ux_absences_member_source_uid', table_name='absences')
    op.drop_column('absences', 'source_uid')
