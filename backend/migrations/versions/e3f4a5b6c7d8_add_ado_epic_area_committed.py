"""add Azure DevOps epic, area path, committed and state change date

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-10-01

Fields the CSV import brings across from Azure DevOps and nothing else writes:
a feature's parent Epic (its ADO ID and title, denormalised onto the feature),
the Area Path and the State Change Date of features and stories, and the
Committed flag of stories (docs/csv-import-logic.md).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('features', sa.Column('epic_id', sa.Integer(), nullable=True))
    op.add_column('features', sa.Column('epic_title', sa.Text(), nullable=True))
    op.add_column('features', sa.Column('area_path', sa.Text(), nullable=True))
    op.add_column('features', sa.Column('state_changed_on', sa.Date(), nullable=True))
    op.create_index('idx_features_epic', 'features', ['project_id', 'epic_id'])
    op.add_column('pbis', sa.Column('area_path', sa.Text(), nullable=True))
    op.add_column(
        'pbis',
        sa.Column('committed', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('pbis', sa.Column('state_changed_on', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('pbis', 'state_changed_on')
    op.drop_column('pbis', 'committed')
    op.drop_column('pbis', 'area_path')
    op.drop_index('idx_features_epic', table_name='features')
    op.drop_column('features', 'state_changed_on')
    op.drop_column('features', 'area_path')
    op.drop_column('features', 'epic_title')
    op.drop_column('features', 'epic_id')
