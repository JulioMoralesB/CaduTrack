"""create shopping trips tables

Revision ID: b4566f75e1df
Revises: 2e871a12d0b8
Create Date: 2026-09-01 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b4566f75e1df'
down_revision: str | None = '2e871a12d0b8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('shopping_trips',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('stated_item_count', sa.Integer(), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_shopping_trips')),
    schema='cadutrack'
    )
    op.create_table('shopping_trip_items',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('trip_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('quantity', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('is_food', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('product_id', sa.Integer(), nullable=True),
    sa.CheckConstraint('quantity > 0', name=op.f('ck_shopping_trip_items_quantity_positive')),
    sa.ForeignKeyConstraint(['product_id'], ['cadutrack.products.id'], name=op.f('fk_shopping_trip_items_product_id_products'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['trip_id'], ['cadutrack.shopping_trips.id'], name=op.f('fk_shopping_trip_items_trip_id_shopping_trips'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_shopping_trip_items')),
    schema='cadutrack'
    )
    op.create_index(op.f('ix_cadutrack_shopping_trip_items_trip_id'), 'shopping_trip_items', ['trip_id'], unique=False, schema='cadutrack')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_cadutrack_shopping_trip_items_trip_id'), table_name='shopping_trip_items', schema='cadutrack')
    op.drop_table('shopping_trip_items', schema='cadutrack')
    op.drop_table('shopping_trips', schema='cadutrack')
