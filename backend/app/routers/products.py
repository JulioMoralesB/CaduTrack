"""Product CRUD endpoints."""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models import Category, Location, Product
from app.schemas.product import ProductCreate, ProductRead, ProductUpdate

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


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)) -> Product:
    """Create a product."""
    _validate_category(db, payload.category_id)

    product = Product(**payload.model_dump())
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


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a product."""
    product = _get_or_404(db, product_id)
    name = product.name

    db.delete(product)
    db.commit()
    logger.info("Deleted product %s (%s)", product_id, name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
