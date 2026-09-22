"""Barcode lookup endpoints — see #30 and #132."""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.barcode_parser import is_restricted_circulation, parse_barcode
from app.barcode_photo import decode_barcode_photo
from app.db.session import get_db
from app.models import BarcodeLookup
from app.off_client import lookup_product_name
from app.schemas.barcode import (
    BarcodeLookupResult,
    BarcodeRememberPayload,
    BarcodeScanPayload,
    BarcodeScanPhotoResult,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/barcodes", tags=["barcodes"])

# Same ceiling and reasoning as /vision/label: a phone photo is a few MB at
# most, this is a generous bound against a mistake or abuse, not a limit
# meant to bind on a real photo.
_MAX_IMAGE_BYTES = 10 * 1024 * 1024


@router.post("/scan-photo", response_model=BarcodeScanPhotoResult)
async def scan_barcode_photo(image: UploadFile = File(...)) -> BarcodeScanPhotoResult:
    """Decode a barcode from a photo taken with the phone's own camera —
    see #132, replacing the old live in-browser video scan.

    Side-effect free, same contract as /vision/label and /barcodes/lookup:
    decoding is not looking anything up yet — the client still calls
    /barcodes/lookup with the raw value this returns, exactly as it did
    with a live scanner's own detected value.
    """
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="La imagen está vacía")
    if len(contents) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="La imagen es demasiado grande"
        )

    raw = decode_barcode_photo(contents)
    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="No se detectó ningún código de barras en la foto. Intenta de nuevo, más cerca y con buena luz.",
        )

    return BarcodeScanPhotoResult(raw=raw)


@router.post("/lookup", response_model=BarcodeLookupResult)
def lookup_barcode(payload: BarcodeScanPayload, db: Session = Depends(get_db)) -> BarcodeLookupResult:
    """Read a scanned code's own GS1 data, and fill in a name from whatever
    remembers this code or, failing that, Open Food Facts.

    Side-effect free, like #83's and #84's own analysis endpoints: nothing
    here is saved. Remembering a name is a separate, explicit step — see
    POST /barcodes/{item_code}/remember — that only happens once a product
    genuinely gets created, not on every scan.
    """
    parsed = parse_barcode(payload.code)

    remembered = db.get(BarcodeLookup, parsed.item_code)
    if remembered is not None:
        return BarcodeLookupResult(
            item_code=parsed.item_code,
            name=remembered.name,
            icon=remembered.icon,
            quantity=parsed.quantity,
            unit=parsed.unit,
        )

    name = None if is_restricted_circulation(parsed.item_code) else lookup_product_name(parsed.item_code)
    return BarcodeLookupResult(
        item_code=parsed.item_code, name=name, icon=None, quantity=parsed.quantity, unit=parsed.unit
    )


@router.post("/{item_code}/remember", response_model=BarcodeLookupResult)
def remember_barcode(
    item_code: str, payload: BarcodeRememberPayload, db: Session = Depends(get_db)
) -> BarcodeLookupResult:
    """Record what this code turned out to be, so the next scan of the same
    code fills itself in — the client's own confirmation that a product
    was actually created, not a guess made on scan."""
    row = db.get(BarcodeLookup, item_code)
    if row is None:
        row = BarcodeLookup(code=item_code, name=payload.name, icon=payload.icon)
        db.add(row)
    else:
        row.name = payload.name
        row.icon = payload.icon
        row.updated_at = func.now()

    db.commit()
    logger.info("Remembered barcode %s as %r", item_code, payload.name)
    return BarcodeLookupResult(item_code=item_code, name=payload.name, icon=payload.icon, quantity=None, unit=None)
