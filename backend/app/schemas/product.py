"""Product request and response schemas."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.expiry import ExpiryStatus, days_until_expiry, expiry_status
from app.models import IconSource, Location
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


class ProductIconUpdate(BaseModel):
    """Payload for the dedicated manual-icon-override endpoint.

    Its own schema, not a field on ProductUpdate: presence of this payload IS
    the signal that the choice is manual (see IconSource), and keeping it off
    the general PUT payload means no other edit can touch it, intentionally or
    by omission.
    """

    icon: str = Field(min_length=1, max_length=16)


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
    # Assigned automatically at creation (see app.icons) and never accepted on
    # ProductCreate/ProductUpdate — a manual choice goes through the dedicated
    # PATCH /products/{id}/icon endpoint instead, so an unrelated edit (the
    # expiry date, the quantity) can never carry an icon change along with it
    # and can never accidentally clear one.
    icon: str
    icon_source: IconSource
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
