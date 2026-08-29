"""Product model."""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    FetchedValue,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.category import Category


class Location(StrEnum):
    """Where a product is stored.

    Stored as language-neutral keys so the database does not need migrating if
    the UI language changes; the Spanish labels live in the frontend.
    """

    FRIDGE = "fridge"
    FREEZER = "freezer"
    PANTRY = "pantry"


class Product(Base):
    """A purchased food item with an expiry date."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(
            "location IN ('fridge', 'freezer', 'pantry')",
            name="ck_products_location",
        ),
        CheckConstraint("quantity > 0", name="ck_products_quantity_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Deleting a category keeps its products; they simply become uncategorised.
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default="1"
    )
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Indexed: every list view and the daily alert query sorts or filters on it.
    expires_at: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    location: Mapped[str] = mapped_column(String(20), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Maintained by a database trigger (see the initial migration) so edits made
    # outside the API — psql, a future import script — still bump the timestamp.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        server_onupdate=FetchedValue(),
    )

    category: Mapped[Category | None] = relationship(back_populates="products")

    def __repr__(self) -> str:
        return f"<Product id={self.id} name={self.name!r} expires_at={self.expires_at}>"
