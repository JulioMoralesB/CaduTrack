"""Label photo queue request and response schemas — see #134."""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models import LabelScanStatus


class LabelScanRead(BaseModel):
    """One queued label photo and whatever has been read from it so far.

    name/expires_at/quantity/unit follow LabelExtraction exactly, so the
    client can prefill the product form the same way a single scan does.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    status: LabelScanStatus
    name: str | None
    expires_at: date | None
    quantity: Decimal | None
    unit: str | None
    resolved_at: datetime | None
    product_id: int | None


class LabelScanResolve(BaseModel):
    """Payload linking a photo to the product it became — created first
    through the normal POST /products, same as ShoppingTripItemResolve."""

    product_id: int
