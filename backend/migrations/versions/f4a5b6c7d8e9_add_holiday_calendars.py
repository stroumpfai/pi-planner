"""add shared holiday calendars

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-10-05

Holiday calendars shared across the app, their dated entries, the teams that
enable them, and per-member "works this holiday" exceptions
(spec/public-holidays.md §3). Nothing existing is altered or back-filled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, Sequence[str], None] = 'e3f4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'holiday_calendars',
        sa.Column('system_id', sa.Text(), primary_key=True),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('modified_at', sa.DateTime(), nullable=False),
    )
    # SQLite cannot reflect an expression index, so this one is written by hand.
    op.execute("CREATE UNIQUE INDEX uq_holiday_calendars_name ON holiday_calendars (lower(name))")
    op.create_table(
        'holiday_entries',
        sa.Column('system_id', sa.Text(), primary_key=True),
        sa.Column(
            'calendar_id', sa.Text(),
            sa.ForeignKey('holiday_calendars.system_id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('label', sa.Text(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('start_half', sa.Text(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('end_half', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('modified_at', sa.DateTime(), nullable=False),
    )
    op.create_index(
        'idx_holiday_entries_calendar_dates', 'holiday_entries', ['calendar_id', 'start_date']
    )
    op.create_table(
        'team_holiday_calendars',
        sa.Column(
            'team_id', sa.Text(),
            sa.ForeignKey('teams.system_id', ondelete='CASCADE'), primary_key=True,
        ),
        sa.Column(
            'calendar_id', sa.Text(),
            sa.ForeignKey('holiday_calendars.system_id', ondelete='CASCADE'), primary_key=True,
        ),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index(
        'idx_team_holiday_calendars_calendar', 'team_holiday_calendars', ['calendar_id']
    )
    op.create_table(
        'holiday_exceptions',
        sa.Column('system_id', sa.Text(), primary_key=True),
        sa.Column(
            'member_id', sa.Text(),
            sa.ForeignKey('team_members.system_id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column(
            'entry_id', sa.Text(),
            sa.ForeignKey('holiday_entries.system_id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            'member_id', 'entry_id', 'day', name='uq_holiday_exceptions_member_entry_day'
        ),
    )
    op.create_index('idx_holiday_exceptions_entry', 'holiday_exceptions', ['entry_id'])


def downgrade() -> None:
    op.drop_index('idx_holiday_exceptions_entry', table_name='holiday_exceptions')
    op.drop_table('holiday_exceptions')
    op.drop_index('idx_team_holiday_calendars_calendar', table_name='team_holiday_calendars')
    op.drop_table('team_holiday_calendars')
    op.drop_index('idx_holiday_entries_calendar_dates', table_name='holiday_entries')
    op.drop_table('holiday_entries')
    op.execute("DROP INDEX IF EXISTS uq_holiday_calendars_name")
    op.drop_table('holiday_calendars')
