"""add team tables

Revision ID: dc004d4ede05
Revises: a1c4e7b90d21
Create Date: 2026-08-30

Teams, members, dated working-pattern versions, absences, meetings with their
attendance, and the team-to-project assignment (spec/teams.md §3.1-§3.5, §6.3).

Nothing reads these yet. They are added in one migration because they only make
sense together: a member without a pattern version computes as zero capacity, and
an assignment without a team has nothing to assign.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc004d4ede05'
down_revision: Union[str, Sequence[str], None] = 'a1c4e7b90d21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('teams',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('normal_day_hours', sa.Float(), server_default=sa.text('(8.0)'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('system_id')
    )
    op.create_table('meetings',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('team_id', sa.Text(), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('kind', sa.Text(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('weekday', sa.Integer(), nullable=True),
    sa.Column('interval_weeks', sa.Integer(), nullable=True),
    sa.Column('half', sa.Text(), nullable=False),
    sa.Column('duration_minutes', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('system_id')
    )
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.create_index('idx_meetings_team', ['team_id'], unique=False)

    op.create_table('team_members',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('team_id', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('role', sa.Text(), nullable=True),
    sa.Column('organisation', sa.Text(), nullable=True),
    sa.Column('active_from', sa.Date(), nullable=True),
    sa.Column('active_to', sa.Date(), nullable=True),
    sa.Column('order_index', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('system_id')
    )
    with op.batch_alter_table('team_members', schema=None) as batch_op:
        batch_op.create_index('idx_team_members_team', ['team_id'], unique=False)

    op.create_table('team_projects',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('team_id', sa.Text(), nullable=False),
    sa.Column('project_id', sa.Text(), nullable=False),
    sa.Column('share_pct', sa.Integer(), server_default=sa.text('(100)'), nullable=False),
    sa.Column('available_source', sa.Text(), server_default='manual', nullable=False),
    sa.Column('units_per_pd', sa.Float(), server_default=sa.text('(1.0)'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.system_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('system_id')
    )
    with op.batch_alter_table('team_projects', schema=None) as batch_op:
        batch_op.create_index('idx_team_projects_team', ['team_id'], unique=False)
        batch_op.create_index('uq_team_projects_project', ['project_id'], unique=True)

    op.create_table('absences',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('team_id', sa.Text(), nullable=False),
    sa.Column('member_id', sa.Text(), nullable=False),
    sa.Column('label', sa.Text(), nullable=True),
    sa.Column('kind', sa.Text(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('start_half', sa.Text(), nullable=True),
    sa.Column('end_half', sa.Text(), nullable=True),
    sa.Column('weekday', sa.Integer(), nullable=True),
    sa.Column('halves', sa.Text(), nullable=True),
    sa.Column('interval_weeks', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['member_id'], ['team_members.system_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('system_id')
    )
    with op.batch_alter_table('absences', schema=None) as batch_op:
        batch_op.create_index('idx_absences_member', ['member_id'], unique=False)
        batch_op.create_index('idx_absences_member_dates', ['member_id', 'start_date'], unique=False)
        batch_op.create_index('idx_absences_team', ['team_id'], unique=False)

    op.create_table('meeting_attendees',
    sa.Column('meeting_id', sa.Text(), nullable=False),
    sa.Column('member_id', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.system_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['member_id'], ['team_members.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('meeting_id', 'member_id')
    )
    with op.batch_alter_table('meeting_attendees', schema=None) as batch_op:
        batch_op.create_index('idx_meeting_attendees_meeting', ['meeting_id'], unique=False)
        batch_op.create_index('idx_meeting_attendees_member', ['member_id'], unique=False)

    op.create_table('member_pattern_versions',
    sa.Column('system_id', sa.Text(), nullable=False),
    sa.Column('member_id', sa.Text(), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('mon_am', sa.Boolean(), nullable=False),
    sa.Column('mon_pm', sa.Boolean(), nullable=False),
    sa.Column('tue_am', sa.Boolean(), nullable=False),
    sa.Column('tue_pm', sa.Boolean(), nullable=False),
    sa.Column('wed_am', sa.Boolean(), nullable=False),
    sa.Column('wed_pm', sa.Boolean(), nullable=False),
    sa.Column('thu_am', sa.Boolean(), nullable=False),
    sa.Column('thu_pm', sa.Boolean(), nullable=False),
    sa.Column('fri_am', sa.Boolean(), nullable=False),
    sa.Column('fri_pm', sa.Boolean(), nullable=False),
    sa.Column('sat_am', sa.Boolean(), nullable=False),
    sa.Column('sat_pm', sa.Boolean(), nullable=False),
    sa.Column('sun_am', sa.Boolean(), nullable=False),
    sa.Column('sun_pm', sa.Boolean(), nullable=False),
    sa.Column('hours_per_day', sa.Float(), nullable=False),
    sa.Column('focus', sa.Float(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('modified_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['member_id'], ['team_members.system_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('system_id')
    )
    with op.batch_alter_table('member_pattern_versions', schema=None) as batch_op:
        batch_op.create_index('idx_member_pattern_versions_member', ['member_id'], unique=False)
        batch_op.create_index('uq_member_pattern_versions_date', ['member_id', 'effective_from'], unique=True)

    # Case-insensitive uniqueness. SQLite cannot reflect expression-based indexes, so
    # autogenerate skips these two and they are written by hand.
    op.execute("CREATE UNIQUE INDEX uq_teams_name ON teams (lower(name))")
    op.execute(
        "CREATE UNIQUE INDEX uq_team_members_name ON team_members (team_id, lower(name))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_team_members_name")
    op.execute("DROP INDEX IF EXISTS uq_teams_name")

    with op.batch_alter_table('member_pattern_versions', schema=None) as batch_op:
        batch_op.drop_index('uq_member_pattern_versions_date')
        batch_op.drop_index('idx_member_pattern_versions_member')

    op.drop_table('member_pattern_versions')
    with op.batch_alter_table('meeting_attendees', schema=None) as batch_op:
        batch_op.drop_index('idx_meeting_attendees_member')
        batch_op.drop_index('idx_meeting_attendees_meeting')

    op.drop_table('meeting_attendees')
    with op.batch_alter_table('absences', schema=None) as batch_op:
        batch_op.drop_index('idx_absences_team')
        batch_op.drop_index('idx_absences_member_dates')
        batch_op.drop_index('idx_absences_member')

    op.drop_table('absences')
    with op.batch_alter_table('team_projects', schema=None) as batch_op:
        batch_op.drop_index('uq_team_projects_project')
        batch_op.drop_index('idx_team_projects_team')

    op.drop_table('team_projects')
    with op.batch_alter_table('team_members', schema=None) as batch_op:
        batch_op.drop_index('idx_team_members_team')

    op.drop_table('team_members')
    with op.batch_alter_table('meetings', schema=None) as batch_op:
        batch_op.drop_index('idx_meetings_team')

    op.drop_table('meetings')
    op.drop_table('teams')
