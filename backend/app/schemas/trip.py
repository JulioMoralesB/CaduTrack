"""Shopping trip request and response schemas — see #84."""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field


class ShoppingTripItemRead(BaseModel):
    """One line read from a receipt photo, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: Decimal
    is_food: bool
    resolved_at: datetime | None
    product_id: int | None


class ShoppingTripRead(BaseModel):
    """A shopping trip and its items, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    stated_item_count: int | None
    items: list[ShoppingTripItemRead]

    @computed_field
    @property
    def counted_quantity(self) -> Decimal:
        """The sum of every line's quantity — the free checksum #84 asks
        for, compared against stated_item_count."""
        return sum((item.quantity for item in self.items), Decimal(0))

    @computed_field
    @property
    def reconciled(self) -> bool | None:
        """None when there is nothing to reconcile against — the receipt
        didn't show its own total, or the model couldn't read it — which is
        a different situation from a real mismatch and must not render as
        one. Otherwise whether the summed quantities match it."""
        if self.stated_item_count is None:
            return None
        return self.counted_quantity == self.stated_item_count


class ShoppingTripItemUpdate(BaseModel):
    """Payload for correcting a line before resolving it — a receipt's own
    text arrives abbreviated and sometimes misread; see #84."""

    name: str = Field(min_length=1, max_length=255)
    quantity: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    is_food: bool


class ShoppingTripItemResolve(BaseModel):
    """Payload linking a line to the product it became.

    Deliberately just an id, not a second copy of the product-creation
    fields: the client creates the product through the normal POST
    /products first — full validation, icon assignment, everything that
    already works — and only then reports which product this line became.
    """

    product_id: int
