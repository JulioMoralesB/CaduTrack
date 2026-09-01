"""add product consumed_at

Revision ID: 2e871a12d0b8
Revises: ebde07d3dd73
Create Date: 2026-08-31 23:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '2e871a12d0b8'
down_revision: str | None = 'ebde07d3dd73'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('products', sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True), schema='cadutrack')
    op.create_index(op.f('ix_cadutrack_products_consumed_at'), 'products', ['consumed_at'], unique=False, schema='cadutrack')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_cadutrack_products_consumed_at'), table_name='products', schema='cadutrack')
    op.drop_column('products', 'consumed_at', schema='cadutrack')
