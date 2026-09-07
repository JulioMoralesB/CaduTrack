"""Shopping trip endpoints — see #84."""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, selectinload

from app import receipt_name_cache
from app.db.session import get_db
from app.models import Product, ShoppingTrip, ShoppingTripItem
from app.receipt_client import expand_names, extract_receipt
from app.schemas.trip import (
    ShoppingTripItemRead,
    ShoppingTripItemResolve,
    ShoppingTripItemUpdate,
    ShoppingTripRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trips", tags=["trips"])

# Same ceiling and reasoning as /vision/label: a phone photo is a few MB at
# most, this is a generous bound against a mistake or abuse, not a limit
# meant to bind on a real receipt photo.
_MAX_IMAGE_BYTES = 10 * 1024 * 1024


def _with_items(statement):
    return statement.options(selectinload(ShoppingTrip.items))


def _get_trip_or_404(db: Session, trip_id: int) -> ShoppingTrip:
    trip = db.execute(_with_items(select(ShoppingTrip).where(ShoppingTrip.id == trip_id))).scalar_one_or_none()
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


def _get_item_or_404(db: Session, trip_id: int, item_id: int) -> ShoppingTripItem:
    item = db.get(ShoppingTripItem, item_id)
    if item is None or item.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    return item


def _require_unresolved(item: ShoppingTripItem) -> None:
    if item.resolved_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Item has already been resolved"
        )


@router.get("/current", response_model=ShoppingTripRead | None)
def get_current_trip(db: Session = Depends(get_db)) -> ShoppingTrip | None:
    """The most recent trip with at least one unresolved item, or null.

    "Current" is computed, not stored: a trip has no status field of its
    own, since whether it still needs attention is fully determined by its
    items and would only be able to drift out of sync as a stored copy of
    that. Null rather than 404 — nothing went wrong, there is simply
    nothing to resume, which the client checks unconditionally on load the
    same way it checks for an empty product list.
    """
    statement = _with_items(
        select(ShoppingTrip)
        .where(
            exists().where(
                ShoppingTripItem.trip_id == ShoppingTrip.id, ShoppingTripItem.resolved_at.is_(None)
            )
        )
        .order_by(ShoppingTrip.created_at.desc())
        .limit(1)
    )
    return db.execute(statement).scalars().first()


@router.post("/receipt", response_model=ShoppingTripRead, status_code=status.HTTP_201_CREATED)
async def create_trip_from_receipt(
    image: UploadFile = File(...), db: Session = Depends(get_db)
) -> ShoppingTrip:
    """Read a receipt photo into a new trip's checklist.

    Persists immediately, unlike /vision/label: the whole point of a trip is
    surviving a reload without asking for the photo again — see #84's "an
    unfinished trip is still visible on the next visit". This does not
    conflict with "nothing is saved without confirmation": that guarantee is
    about products, and nothing here is one. A trip item only reaches the
    products table through its own dedicated resolve endpoint, same as
    every other create in this API going through its own confirmation step.
    """
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="La imagen está vacía")
    if len(contents) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="La imagen es demasiado grande"
        )

    extraction = extract_receipt(contents)
    if extraction is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo leer el recibo. Agrega los productos manualmente.",
        )

    # A name for every line, cache first — see #126. Only a raw text
    # receipt_name_cache has never seen before ever reaches expand_names,
    # so a repeat purchase costs one model call (the OCR pass above), not
    # two, and a name the user already corrected once is never re-guessed.
    resolved_names: dict[str, str] = {}
    unseen_raw_names: set[str] = set()
    for item in extraction.items:
        if item.raw_name in resolved_names or item.raw_name in unseen_raw_names:
            continue
        cached_name = receipt_name_cache.get(db, item.raw_name)
        if cached_name is not None:
            resolved_names[item.raw_name] = cached_name
        else:
            unseen_raw_names.add(item.raw_name)

    if unseen_raw_names:
        resolved_names.update(expand_names(list(unseen_raw_names)))

    trip = ShoppingTrip(stated_item_count=extraction.stated_item_count)
    for item in extraction.items:
        # A name expand_names couldn't produce (unconfigured, a failure, or
        # simply dropped) falls back to the raw text itself — still usable,
        # just uncorrected, same as before #126.
        name = resolved_names.get(item.raw_name, item.raw_name)
        trip.items.append(
            ShoppingTripItem(name=name, raw_name=item.raw_name, quantity=item.quantity, is_food=item.is_food)
        )

    db.add(trip)
    db.commit()
    logger.info("Created shopping trip %s with %d items", trip.id, len(trip.items))
    return _get_trip_or_404(db, trip.id)


@router.patch("/{trip_id}/items/{item_id}", response_model=ShoppingTripItemRead)
def update_trip_item(
    trip_id: int, item_id: int, payload: ShoppingTripItemUpdate, db: Session = Depends(get_db)
) -> ShoppingTripItem:
    """Correct a line's name, quantity, or food classification before
    resolving it — a receipt's own text arrives abbreviated and is
    sometimes misread."""
    item = _get_item_or_404(db, trip_id, item_id)
    _require_unresolved(item)

    item.name = payload.name
    item.quantity = payload.quantity
    item.is_food = payload.is_food
    db.commit()
    db.refresh(item)
    return item


@router.post("/{trip_id}/items/{item_id}/drop", response_model=ShoppingTripItemRead)
def drop_trip_item(trip_id: int, item_id: int, db: Session = Depends(get_db)) -> ShoppingTripItem:
    """Mark a line as dealt with without adding a product for it — the
    checklist's uncheck-and-confirm action for a non-food line, or any
    other line not worth tracking."""
    item = _get_item_or_404(db, trip_id, item_id)
    _require_unresolved(item)

    item.resolved_at = func.now()
    db.commit()
    db.refresh(item)
    logger.info("Dropped trip item %s (%s) from trip %s", item.id, item.name, trip_id)
    return item


@router.post("/{trip_id}/items/{item_id}/resolve", response_model=ShoppingTripItemRead)
def resolve_trip_item(
    trip_id: int, item_id: int, payload: ShoppingTripItemResolve, db: Session = Depends(get_db)
) -> ShoppingTripItem:
    """Link a line to the product it became — either one just created
    through the normal POST /products, or an existing one the user is
    saying this line is really the same thing as (see #126: there is
    nothing here that requires the product to be new)."""
    item = _get_item_or_404(db, trip_id, item_id)
    _require_unresolved(item)

    product = db.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Product {payload.product_id} does not exist",
        )

    item.resolved_at = func.now()
    item.product_id = payload.product_id
    db.commit()
    db.refresh(item)

    # Whatever name the user actually settled on for this raw text — via
    # the product just created, or the existing one just linked — so the
    # next receipt with this same line never has to ask again. See #126.
    receipt_name_cache.remember(db, item.raw_name, product.name)

    logger.info("Resolved trip item %s (%s) into product %s", item.id, item.name, payload.product_id)
    return item
