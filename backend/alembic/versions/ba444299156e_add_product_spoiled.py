"""add product spoiled

Revision ID: ba444299156e
Revises: 8918bcd28a56
Create Date: 2026-11-09 11:00:44.958425

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ba444299156e'
down_revision: str | None = '8918bcd28a56'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('products', sa.Column('spoiled', sa.Boolean(), server_default='false', nullable=False), schema='cadutrack')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('products', 'spoiled', schema='cadutrack')
