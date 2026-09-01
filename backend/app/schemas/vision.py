"""Label-photo extraction response schema."""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class LabelExtraction(BaseModel):
    """Best-effort fields read from a photo of a product label.

    Any field may be null when the model could not determine it with
    confidence — see app/vision_client.py, which returns null rather than
    guessing. Never persisted directly: the caller submits these, edited or
    not, through the normal POST /products endpoint. Field names match
    ProductBase deliberately, so the frontend can spread this straight into
    the product form's state.
    """

    name: str | None = None
    expires_at: date | None = None
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    unit: str | None = None
