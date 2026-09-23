"""create label scans table

Revision ID: 8918bcd28a56
Revises: 497560948ecc
Create Date: 2026-09-22 23:18:10.132981

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '8918bcd28a56'
down_revision: str | None = '497560948ecc'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('label_scans',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('image', sa.LargeBinary(), nullable=True),
    sa.Column('image_type', sa.String(length=100), server_default='image/jpeg', nullable=False),
    sa.Column('status', sa.String(length=16), server_default='pending', nullable=False),
    sa.Column('name', sa.String(length=255), nullable=True),
    sa.Column('expires_at', sa.Date(), nullable=True),
    sa.Column('quantity', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('unit', sa.String(length=50), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('product_id', sa.Integer(), nullable=True),
    sa.CheckConstraint("status IN ('pending', 'read', 'failed')", name='ck_label_scans_status'),
    sa.CheckConstraint('quantity > 0', name='ck_label_scans_quantity_positive'),
    sa.ForeignKeyConstraint(['product_id'], ['cadutrack.products.id'], name=op.f('fk_label_scans_product_id_products'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_label_scans')),
    schema='cadutrack'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('label_scans', schema='cadutrack')
