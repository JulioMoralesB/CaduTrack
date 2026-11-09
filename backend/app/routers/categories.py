"""Category CRUD endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Category
from app.schemas.category import CategoryCreate, CategoryRead, CategoryUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/categories", tags=["categories"])

_DUPLICATE_NAME = "Ya existe una categoría con ese nombre"


def _duplicate_name_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_DUPLICATE_NAME)


def _require_name_available(db: Session, name: str, ignoring_id: int | None = None) -> None:
    """Rejects a name differing only in case from another category's: the
    database's own unique constraint is case-sensitive, and "bebidas" next to
    "Bebidas" is exactly the near-duplicate that managing these by hand
    invites. Compared here rather than with SQL lower(), whose handling of
    accented letters depends on the database's locale."""
    target = name.casefold()
    for category_id, existing in db.execute(select(Category.id, Category.name)):
        if category_id != ignoring_id and existing.casefold() == target:
            raise _duplicate_name_error()


def _get_or_404(db: Session, category_id: int) -> Category:
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Esa categoría ya no existe")
    return category


@router.get("", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)) -> list[Category]:
    """List every category, alphabetically."""
    return list(db.execute(select(Category).order_by(Category.name)).scalars())


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)) -> Category:
    """Create a category. Names are unique, ignoring case."""
    _require_name_available(db, payload.name)
    category = Category(name=payload.name)
    db.add(category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_name_error() from None
    db.refresh(category)
    logger.info("Created category %s (%s)", category.id, category.name)
    return category


@router.put("/{category_id}", response_model=CategoryRead)
def rename_category(category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)) -> Category:
    """Rename a category. Its products follow, since they reference it by id."""
    category = _get_or_404(db, category_id)
    _require_name_available(db, payload.name, ignoring_id=category_id)

    previous = category.name
    category.name = payload.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate_name_error() from None
    db.refresh(category)
    logger.info("Renamed category %s from %s to %s", category.id, previous, category.name)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a category.

    Its products are kept and become uncategorised — the food is still in the
    fridge even if the label is gone.
    """
    category = _get_or_404(db, category_id)

    db.delete(category)
    db.commit()
    logger.info("Deleted category %s (%s)", category_id, category.name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
