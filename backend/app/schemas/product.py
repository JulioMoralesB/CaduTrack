"""Product request and response schemas."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.expiry import ExpiryStatus, days_until_expiry, expiry_status
from app.models import Location
from app.schemas.category import CategoryRead


class ProductBase(BaseModel):
    """Fields a client may set on a product."""

    name: str = Field(min_length=1, max_length=255)
    category_id: int | None = None
    # gt=0 mirrors ck_products_quantity_positive, so a bad value is rejected
    # with a readable 422 instead of a database integrity error.
    quantity: Decimal = Field(default=Decimal(1), gt=0, max_digits=10, decimal_places=2)
    unit: str | None = Field(default=None, max_length=50)
    expires_at: date
    location: Location
    notes: str | None = None


class ProductCreate(ProductBase):
    """Payload for creating a product."""


class ProductUpdate(ProductBase):
    """Payload for replacing a product.

    PUT semantics: every field is sent, and omitted optional fields are cleared.
    """


class ProductQuantityDelta(BaseModel):
    """A relative change to a product's quantity.

    Sent as a delta rather than an absolute value: two quick taps racing on a
    slow connection both send "-1" and compose correctly regardless of arrival
    order, where two absolute values ("quantity = 4" twice) would silently
    drop one of the taps. See #82.
    """

    delta: Decimal = Field(max_digits=10, decimal_places=2)


class ProductRead(ProductBase):
    """A product as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    # Nested so the list view can show the category name without a second call.
    category: CategoryRead | None = None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def days_until_expiry(self) -> int:
        """Whole days left. Negative once the product has expired."""
        return days_until_expiry(self.expires_at)

    @computed_field
    @property
    def status(self) -> ExpiryStatus:
        """fresh / expiring_soon / expired, for the colour coding in #16."""
        return expiry_status(self.days_until_expiry)
