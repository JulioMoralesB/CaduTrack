"""create barcode lookups table

Revision ID: 1c3f3dcfbd63
Revises: b4566f75e1df
Create Date: 2026-09-01 19:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '1c3f3dcfbd63'
down_revision: str | None = 'b4566f75e1df'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('barcode_lookups',
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('icon', sa.String(length=16), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('code', name=op.f('pk_barcode_lookups')),
    schema='cadutrack'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('barcode_lookups', schema='cadutrack')
