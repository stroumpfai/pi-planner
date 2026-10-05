"""deactivate API keys whose user was deleted

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-10-05

Deleting a user used to leave their API keys active. SQLite doesn't enforce the
``api_keys.username`` foreign key, so the rows survived, and an account created
later with the same username would inherit them. Deleting a user now revokes
them (services.auth.revoke_user_api_keys); this cleans up keys orphaned before
that. Rows are deactivated, not deleted, so the activity log keeps its
references, as for any revoked key.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b6c7d8e9f0a1'
down_revision: Union[str, Sequence[str], None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE api_keys SET is_active = 0"
        " WHERE is_active = 1 AND username NOT IN (SELECT username FROM users)"
    )


def downgrade() -> None:
    # Nothing to restore: which keys were orphaned isn't recorded, and reviving
    # them is exactly what this migration exists to prevent.
    pass
