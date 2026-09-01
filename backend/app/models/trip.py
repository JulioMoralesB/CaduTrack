"""Shopping trip models — see #84."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ShoppingTrip(Base):
    """A receipt photo's items, staged until each is either turned into a
    product or explicitly dropped.

    Not itself trusted inventory data: nothing here is a Product, and
    nothing here reaches the products table until a specific item is
    resolved through its own endpoint, with a date the receipt never had.
    """

    __tablename__ = "shopping_trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # What the model read off the receipt's own printed total, e.g.
    # "ARTICULOS COMPRADOS: 19" — see #84's reconciliation check. Null when
    # the receipt didn't show one or the model couldn't read it, in which
    # case there is nothing to reconcile against, not a mismatch.
    stated_item_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    items: Mapped[list["ShoppingTripItem"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="ShoppingTripItem.id"
    )

    def __repr__(self) -> str:
        return f"<ShoppingTrip id={self.id} items={len(self.items)}>"


class ShoppingTripItem(Base):
    """One line read from a receipt photo."""

    __tablename__ = "shopping_trip_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_shopping_trip_items_quantity_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("shopping_trips.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    # The model's own guess at whether this line is worth tracking at all —
    # see #84: "non-food is a real fraction" of a typical receipt. Drives the
    # checklist's initial tick state; the user can still override it either
    # way before resolving the item.
    is_food: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    # Set once dealt with, one way or the other. product_id distinguishes
    # which way: still null means the item was dropped, not added.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )

    trip: Mapped[ShoppingTrip] = relationship(back_populates="items")

    def __repr__(self) -> str:
        return f"<ShoppingTripItem id={self.id} name={self.name!r} resolved={self.resolved_at is not None}>"
