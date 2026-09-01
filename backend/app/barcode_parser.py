"""Parsing a scanned barcode's raw value — see #30.

BarcodeDetector (and every other scanner) returns a GS1-128 label as a
plain concatenated digit string with no separators between the
Application Identifiers this app cares about — verified directly, not
assumed: a real GS1-128 barcode built from #30's own HEB example, decoded
independently with zbar, came back as
"01" + <14-digit GTIN> + "3103" + <6-digit weight> + "3922" + <8-digit
price> with no parentheses and no FNC1 separator character anywhere in
it. That is expected, not a decoder quirk: GS1 only requires a separator
before a *variable*-length field, and every AI this module reads — (01)
and (310n) — is fixed-length by the GS1 general specification. AI (392n),
also on a real label, is variable-length; this module does not parse it,
both because the issue's own acceptance criteria never asks for the price
and because parsing a variable-length field correctly requires knowing
where the *next* AI starts, which needs a real AI dictionary this app has
no other use for.
"""

from dataclasses import dataclass
from decimal import Decimal

_GTIN_LENGTH = 14
_WEIGHT_DIGITS = 6
# Product.quantity is NUMERIC(10, 2) — see app/models/product.py — while a
# GS1 net weight can carry a third decimal place (0.586 kg is #30's own
# worked example). Rounding here rather than widening that column: every
# other quantity in this app, and the frontend's own cents-based stepper
# math, already assumes two decimal places, and the app's purpose is
# tracking roughly how much of something is in the fridge, not weighing to
# the gram. A user who wants the exact figure can still edit the field
# after scanning — nothing here is a silent save.
_QUANTITY_DECIMAL_PLACES = Decimal("0.01")


@dataclass
class ParsedBarcode:
    """What a scanned code decomposes to.

    item_code is always populated — a barcode with nothing recognizable in
    it about a GS1 preamble is simply treated as the item code itself,
    which is exactly what a plain EAN-13/UPC scan already looks like.
    """

    item_code: str
    quantity: Decimal | None
    unit: str | None


def parse_barcode(raw: str) -> ParsedBarcode:
    """A GS1-128 label carrying a (01) GTIN, optionally followed by a
    (310n) net weight — or, for anything else (a plain EAN-13/UPC), the raw
    value itself is the item code, with no weight to find."""
    if raw.startswith("01") and len(raw) >= 2 + _GTIN_LENGTH:
        gtin = raw[2 : 2 + _GTIN_LENGTH]
        if gtin.isdigit():
            quantity, unit = _parse_weight(raw[2 + _GTIN_LENGTH :])
            return ParsedBarcode(item_code=gtin, quantity=quantity, unit=unit)

    return ParsedBarcode(item_code=raw, quantity=None, unit=None)


def _parse_weight(rest: str) -> tuple[Decimal | None, str | None]:
    """AI (310n): net weight in kilograms, n decimal places, always exactly
    6 digits — see the module docstring for why no separator precedes it
    here."""
    if len(rest) < 4 + _WEIGHT_DIGITS or not rest.startswith("310"):
        return None, None

    decimal_places = rest[3]
    digits = rest[4 : 4 + _WEIGHT_DIGITS]
    if not decimal_places.isdigit() or not digits.isdigit():
        return None, None

    quantity = Decimal(digits) / (10 ** int(decimal_places))
    if quantity <= 0:
        return None, None
    return quantity.quantize(_QUANTITY_DECIMAL_PLACES), "kg"


def is_restricted_circulation(item_code: str) -> bool:
    """GS1 prefix 2 is reserved for restricted circulation — internal store
    codes with no meaning outside the store that printed them. Open Food
    Facts, a global database, has nothing to say about these; asking it
    anyway just spends a request to learn nothing — see #30."""
    return item_code.startswith("2")
