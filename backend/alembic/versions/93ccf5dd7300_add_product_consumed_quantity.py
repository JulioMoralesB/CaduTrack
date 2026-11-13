"""add product consumed quantity

Revision ID: 93ccf5dd7300
Revises: ba444299156e
Create Date: 2026-11-10 16:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '93ccf5dd7300'
down_revision: str | None = 'ba444299156e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema.

    Existing rows start at zero, which is also the truth for them: until now
    nothing recorded a unit being eaten, so what a row in history shows as its
    quantity is still all that is known about it.
    """
    op.add_column('products', sa.Column('consumed_quantity', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False), schema='cadutrack')
    op.create_check_constraint('ck_products_consumed_quantity_not_negative', 'products', 'consumed_quantity >= 0', schema='cadutrack')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('ck_products_consumed_quantity_not_negative', 'products', schema='cadutrack', type_='check')
    op.drop_column('products', 'consumed_quantity', schema='cadutrack')
