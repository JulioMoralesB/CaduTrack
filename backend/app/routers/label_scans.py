"""Label photo queue endpoints — see #134."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.db.session import get_db
from app.label_queue import process_pending
from app.models import LabelScan, LabelScanStatus, Product
from app.schemas.label_scan import LabelScanRead, LabelScanResolve

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/label-scans", tags=["label-scans"])

# Same ceiling and reasoning as /vision/label.
_MAX_IMAGE_BYTES = 10 * 1024 * 1024

# Served back as-is to the checklist's own <img>, so only types a browser
# renders as a plain image. Anything else — an SVG, say, which can carry
# script — is still stored and read, just never served as what it claims.
_SERVABLE_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _get_scan_or_404(db: Session, scan_id: int) -> LabelScan:
    scan = db.get(LabelScan, scan_id)
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
    return scan


def _require_unresolved(scan: LabelScan) -> None:
    if scan.resolved_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan has already been resolved")


def _resolve(scan: LabelScan, product_id: int | None) -> None:
    scan.resolved_at = func.now()
    scan.product_id = product_id
    # Only needed while the scan is still on the checklist — see the model.
    scan.image = None


@router.get("/current", response_model=list[LabelScanRead])
def list_current_scans(db: Session = Depends(get_db)) -> list[LabelScan]:
    """Every photo still awaiting a decision, oldest first — whether it's
    still being read, read, or failed. Empty rather than null when there
    are none: unlike a trip, the queue is one list, not one of many."""
    statement = select(LabelScan).where(LabelScan.resolved_at.is_(None)).order_by(LabelScan.id)
    return list(db.execute(statement).scalars())


@router.post("", response_model=LabelScanRead, status_code=status.HTTP_201_CREATED)
async def queue_scan(
    background_tasks: BackgroundTasks, image: UploadFile = File(...), db: Session = Depends(get_db)
) -> LabelScan:
    """Queue a label photo and return right away, before it's read.

    The read itself happens in the background (see app/label_queue.py) so
    the user can queue the next photo, or go on using the app, instead of
    waiting on the model each time. Persisted for the same reason a trip
    is: the queue has to survive a reload.
    """
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="La imagen está vacía")
    if len(contents) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="La imagen es demasiado grande"
        )

    scan = LabelScan(image=contents, image_type=image.content_type or "application/octet-stream")
    db.add(scan)
    db.commit()
    db.refresh(scan)
    logger.info("Queued label scan %s", scan.id)

    background_tasks.add_task(process_pending)
    return scan


@router.get("/{scan_id}/image")
def get_scan_image(scan_id: int, db: Session = Depends(get_db)) -> Response:
    """The photo itself, for the checklist's thumbnail — gone once the scan
    is resolved or dropped."""
    scan = db.execute(
        select(LabelScan).options(undefer(LabelScan.image)).where(LabelScan.id == scan_id)
    ).scalar_one_or_none()
    if scan is None or scan.image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")

    media_type = scan.image_type if scan.image_type in _SERVABLE_IMAGE_TYPES else "application/octet-stream"
    return Response(
        content=scan.image,
        media_type=media_type,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


@router.post("/{scan_id}/retry", response_model=LabelScanRead)
def retry_scan(scan_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> LabelScan:
    """Queue a photo the model couldn't read for another attempt — most
    often because Ollama itself was down or mid-restart the first time."""
    scan = _get_scan_or_404(db, scan_id)
    _require_unresolved(scan)
    if scan.status != LabelScanStatus.failed:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a failed scan can be retried")

    scan.status = LabelScanStatus.pending
    db.commit()
    db.refresh(scan)

    background_tasks.add_task(process_pending)
    return scan


@router.post("/{scan_id}/drop", response_model=LabelScanRead)
def drop_scan(scan_id: int, db: Session = Depends(get_db)) -> LabelScan:
    """Take a photo off the checklist without adding a product for it —
    allowed at any point, even while it's still being read."""
    scan = _get_scan_or_404(db, scan_id)
    _require_unresolved(scan)

    _resolve(scan, None)
    db.commit()
    db.refresh(scan)
    logger.info("Dropped label scan %s", scan.id)
    return scan


@router.post("/{scan_id}/resolve", response_model=LabelScanRead)
def resolve_scan(scan_id: int, payload: LabelScanResolve, db: Session = Depends(get_db)) -> LabelScan:
    """Link a photo to the product it became. Like a trip item, the product
    is created first through the normal POST /products."""
    scan = _get_scan_or_404(db, scan_id)
    _require_unresolved(scan)

    if db.get(Product, payload.product_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Ese producto ya no existe. Elige otro.",
        )

    _resolve(scan, payload.product_id)
    db.commit()
    db.refresh(scan)
    logger.info("Resolved label scan %s into product %s", scan.id, payload.product_id)
    return scan
