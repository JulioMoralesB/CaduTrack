"""Barcode request and response schemas — see #30."""

from decimal import Decimal

from pydantic import BaseModel, Field


class BarcodeScanPayload(BaseModel):
    """The raw value read off a scanned barcode, exactly as the scanner
    returned it — this app's own GS1 parsing depends on that rawness."""

    code: str = Field(min_length=1, max_length=128)


class BarcodeLookupResult(BaseModel):
    """What a scanned code resolved to. Every field but item_code may be
    null when nothing could be determined with confidence — never a guess,
    the same standard #83's label reading and #84's receipt reading hold
    to. Field names match ProductBase deliberately, same reasoning as
    #83's LabelExtraction, so the frontend can spread this into form state.
    """

    item_code: str
    name: str | None = None
    icon: str | None = None
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=10, decimal_places=2)
    unit: str | None = None


class BarcodeRememberPayload(BaseModel):
    """What a product actually became, once the client has already created
    it through the normal, already-confirmed POST /products — same
    resolve-after-the-fact shape as #84's trip items."""

    name: str = Field(min_length=1, max_length=255)
    icon: str | None = Field(default=None, min_length=1, max_length=16)
