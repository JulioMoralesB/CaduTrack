"""Product CRUD endpoints."""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app import icon_cache, icon_settings_store
from app.db.session import get_db
from app.icons import DEFAULT_ICON, normalize, resolve_icon
from app.models import Category, IconSource, Location, Product
from app.ollama_client import resolve_icon_via_model
from app.schemas.product import (
    ProductCreate,
    ProductIconUpdate,
    ProductQuantityDelta,
    ProductRead,
    ProductUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["products"])


def _get_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


def _validate_category(db: Session, category_id: int | None) -> None:
    """Reject an unknown category with a readable error.

    Left to the database this would surface as a foreign key violation, which
    tells the client nothing useful.
    """
    if category_id is None:
        return
    if db.get(Category, category_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Category {category_id} does not exist",
        )


@router.get("", response_model=list[ProductRead])
def list_products(
    db: Session = Depends(get_db),
    category_id: int | None = Query(default=None, description="Only products in this category"),
    location: Location | None = Query(default=None, description="Only products stored here"),
    expires_before: date | None = Query(
        default=None, description="Only products expiring strictly before this date"
    ),
) -> list[Product]:
    """List products, soonest to expire first.

    Ordering is the point of the app: what is about to go off has to be at the
    top without the client having to sort.
    """
    statement = (
        select(Product)
        # Without this the category of every row is a separate query.
        .options(selectinload(Product.category))
        .order_by(Product.expires_at, Product.name)
    )

    if category_id is not None:
        statement = statement.where(Product.category_id == category_id)
    if location is not None:
        statement = statement.where(Product.location == location.value)
    if expires_before is not None:
        statement = statement.where(Product.expires_at < expires_before)

    return list(db.execute(statement).scalars())


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, db: Session = Depends(get_db)) -> Product:
    """Fetch a single product."""
    return _get_or_404(db, product_id)


def _resolve_icon(db: Session, name: str) -> tuple[str, IconSource]:
    """The icon for a new product, and how it was decided.

    Four steps, cheapest first, each only reached when the one before it
    misses: the local table (instant, no query), the name cache (one query,
    no network), the model (one query plus a call to Ollama), and finally the
    default. Any step that succeeds short-circuits the rest.
    """
    table_hit = resolve_icon(name)
    if table_hit != DEFAULT_ICON:
        return table_hit, IconSource.LOOKUP

    if not icon_settings_store.ai_enabled(db):
        return DEFAULT_ICON, IconSource.DEFAULT

    normalized = normalize(name)
    cached = icon_cache.get(db, normalized)
    if cached is not None:
        return cached, IconSource.AI

    model_icon = resolve_icon_via_model(name)
    if model_icon is None:
        return DEFAULT_ICON, IconSource.DEFAULT

    icon_cache.remember(db, normalized, model_icon)
    return model_icon, IconSource.AI


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> Product:
    """Create a product.

    The icon is assigned here, once — never from a value the client sends,
    since ProductCreate has no icon field. See _resolve_icon for the order it
    is decided in; a miss at every step still gets DEFAULT_ICON rather than an
    empty space.
    """
    _validate_category(db, payload.category_id)

    icon, icon_source = _resolve_icon(db, payload.name)

    product = Product(**payload.model_dump(), icon=icon, icon_source=icon_source)
    db.add(product)
    db.commit()
    db.refresh(product)
    logger.info("Created product %s (%s) expiring %s", product.id, product.name, product.expires_at)
    return product


@router.put("/{product_id}", response_model=ProductRead)
def replace_product(
    product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)
) -> Product:
    """Replace a product. Omitted optional fields are cleared, per PUT semantics."""
    product = _get_or_404(db, product_id)
    _validate_category(db, payload.category_id)

    for field, value in payload.model_dump().items():
        setattr(product, field, value)

    db.commit()
    # updated_at is set by a database trigger, so the in-session value is stale
    # until we read it back.
    db.refresh(product)
    logger.info("Updated product %s (%s)", product.id, product.name)
    return product


@router.patch("/{product_id}/quantity", response_model=ProductRead)
def adjust_quantity(
    product_id: int, payload: ProductQuantityDelta, db: Session = Depends(get_db)
) -> Product:
    """Apply a relative change to a product's quantity.

    Deliberately a delta, not PATCH-with-an-absolute-value: see
    ProductQuantityDelta. The UPDATE below is what makes the delta contract
    actually safe under concurrent requests, not just in principle. `quantity`
    is read and written in the same statement, evaluated against the row's
    live value at the moment of the update under Postgres's row lock — not a
    value this function fetched earlier and might be replaying against a stale
    read. Two overlapping requests serialize on that lock and each is applied
    to what the other left behind, so composing correctly does not depend on
    which one the database happens to run first.
    """
    product = _get_or_404(db, product_id)

    result = db.execute(
        update(Product)
        .where(Product.id == product_id, Product.quantity + payload.delta > 0)
        .values(quantity=Product.quantity + payload.delta)
    )
    if result.rowcount == 0:
        # The existence check above already passed, so the only way to match
        # zero rows here is the WHERE clause's positivity guard — the database
        # constraint would catch this too, but as a 500 with no useful detail.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Adjusting by {payload.delta} would leave a non-positive quantity",
        )

    db.commit()
    db.refresh(product)
    logger.info("Adjusted product %s (%s) quantity by %s", product.id, product.name, payload.delta)
    return product


@router.patch("/{product_id}/icon", response_model=ProductRead)
def override_icon(product_id: int, payload: ProductIconUpdate, db: Session = Depends(get_db)) -> Product:
    """Manually set a product's icon.

    The only path that can produce IconSource.MANUAL — nothing automatic runs
    over a product again after creation, so a manual choice made here is not
    at risk of being silently reprocessed later.
    """
    product = _get_or_404(db, product_id)
    product.icon = payload.icon
    product.icon_source = IconSource.MANUAL
    db.commit()
    db.refresh(product)
    logger.info("Set product %s (%s) icon to %r manually", product.id, product.name, payload.icon)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a product."""
    product = _get_or_404(db, product_id)
    name = product.name

    db.delete(product)
    db.commit()
    logger.info("Deleted product %s (%s)", product_id, name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
