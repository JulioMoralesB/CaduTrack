"""add receipt name lookup

Revision ID: 497560948ecc
Revises: 1c3f3dcfbd63
Create Date: 2026-09-07 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '497560948ecc'
down_revision: str | None = '1c3f3dcfbd63'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('receipt_name_lookup',
    sa.Column('raw_text', sa.String(length=255), nullable=False),
    sa.Column('product_name', sa.String(length=255), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('raw_text', name=op.f('pk_receipt_name_lookup')),
    schema='cadutrack'
    )
    op.add_column('shopping_trip_items', sa.Column('raw_name', sa.String(length=255), server_default='', nullable=False), schema='cadutrack')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('shopping_trip_items', 'raw_name', schema='cadutrack')
    op.drop_table('receipt_name_lookup', schema='cadutrack')
