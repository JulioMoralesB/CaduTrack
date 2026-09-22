"""Decode a barcode from a photo — see #132.

Real decoding via zbar (through pyzbar), not OCR: a barcode's own printed
pattern is what a decoder like this reads deterministically, the same way
a dedicated handheld scanner does — unlike asking a vision model to read
the small printed digits underneath it, which is a plain OCR problem with
a much higher error rate for a string this consequential (get one digit
wrong and the lookup, or an existing remembered entry, is simply wrong).

Runtime dependency, not just a pip package: pyzbar loads the zbar shared
library via ctypes at import time — see the Dockerfile's own libzbar0.
"""

import io
import logging

from PIL import Image, UnidentifiedImageError
from pyzbar.pyzbar import ZBarSymbol, decode

logger = logging.getLogger(__name__)

# The same symbologies a grocery product's own barcode actually uses —
# GS1-128 for a weighed item (see barcode_parser.py), EAN-13/EAN-8/UPC-A/
# UPC-E for everything else. Restricting to these avoids a stray QR/Aztec/
# PDF417 decode in the same photo (a receipt taped nearby, a poster in the
# background) returning something this app has no use for.
_SYMBOLS = [
    ZBarSymbol.CODE128,
    ZBarSymbol.EAN13,
    ZBarSymbol.EAN8,
    ZBarSymbol.UPCA,
    ZBarSymbol.UPCE,
]


def decode_barcode_photo(image_bytes: bytes) -> str | None:
    """The decoded value of the most prominent barcode in the photo, or
    None if nothing recognizable was found.

    "Most prominent" is the widest bounding box among everything decoded —
    a reasonable stand-in for "the one actually being photographed" on the
    rare photo that happens to catch more than one printed code.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except UnidentifiedImageError:
        logger.warning("Barcode photo decode failed: not a readable image")
        return None

    results = decode(image, symbols=_SYMBOLS)
    if not results:
        return None

    widest = max(results, key=lambda result: result.rect.width)
    return widest.data.decode("utf-8", errors="replace")
