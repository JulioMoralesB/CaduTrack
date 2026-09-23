"""Decode a barcode from a photo — see #132 and #137.

Real decoding, not OCR: a barcode's own printed pattern is what a decoder
like this reads deterministically, the same way a dedicated handheld
scanner does — unlike asking a vision model to read the small printed
digits underneath it, which is a plain OCR problem with a much higher
error rate for a string this consequential (get one digit wrong and the
lookup, or an existing remembered entry, is simply wrong).

Two libraries, because neither covers both halves (#137):

- zbar reads a barcode reliably once it's looking at one, but scanning a
  whole phone photo it can fail to *find* it: print right next to the
  bars (a logo on a dark band, on a real bottle) reads as more bars and
  spoils the whole scanline. That bottle's photo decoded in 3 of 32
  scale/angle variants, yet every variant decodes when cropped to just
  the barcode.
- OpenCV's detector localizes first (28/32 on the same photo), but only
  decodes EAN/UPC — not Code-128, which GS1-128 weighed items use.

So OpenCV finds the regions, each region is decoded by OpenCV or else
cropped and handed to zbar, and zbar on the full photo is the last resort
for anything OpenCV couldn't localize at all.

Runtime dependency, not just a pip package: pyzbar loads the zbar shared
library via ctypes at import time — see the Dockerfile's own libzbar0.
"""

import io
import logging

import cv2
import numpy as np
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

# OpenCV's corners hug the bars tightly; zbar needs some quiet zone around
# them to decode the crop.
_CROP_MARGIN = 0.25


def decode_barcode_photo(image_bytes: bytes) -> str | None:
    """The decoded value of the most prominent barcode in the photo, or
    None if nothing recognizable was found.

    "Most prominent" is the widest barcode among everything decoded — a
    reasonable stand-in for "the one actually being photographed" on the
    rare photo that happens to catch more than one printed code.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("L")
    except UnidentifiedImageError:
        logger.warning("Barcode photo decode failed: not a readable image")
        return None

    found = _decode_localized(np.array(image))
    if not found:
        found = [
            (result.rect.width, result.data.decode("utf-8", errors="replace"))
            for result in decode(image, symbols=_SYMBOLS)
        ]
    if not found:
        return None

    _, value = max(found, key=lambda candidate: candidate[0])
    return value


def _decode_localized(gray: np.ndarray) -> list[tuple[float, str]]:
    """(width, value) for every region OpenCV localizes and either it or
    zbar (on the cropped region) can decode."""
    # A detector per call: construction is microseconds, and OpenCV makes
    # no thread-safety promise for sharing one across FastAPI's threadpool.
    detector = cv2.barcode.BarcodeDetector()
    _, values, _, corners = detector.detectAndDecodeWithType(gray)
    if corners is None:
        return []

    found = []
    for value, quad in zip(values, corners):
        (_, _), (side_a, side_b), _ = cv2.minAreaRect(quad)
        value = value or _decode_crop(gray, quad)
        if value:
            found.append((max(side_a, side_b), value))
    return found


def _decode_crop(gray: np.ndarray, quad: np.ndarray) -> str | None:
    x, y, w, h = cv2.boundingRect(quad.astype(np.int32))
    margin = int(max(w, h) * _CROP_MARGIN)
    crop = gray[max(0, y - margin) : y + h + margin, max(0, x - margin) : x + w + margin]
    results = decode(Image.fromarray(crop), symbols=_SYMBOLS)
    if not results:
        return None
    return results[0].data.decode("utf-8", errors="replace")
