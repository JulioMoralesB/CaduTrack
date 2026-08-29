"""Category CRUD endpoints."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Category
from app.schemas.category import CategoryCreate, CategoryRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
def list_categories(db: Session = Depends(get_db)) -> list[Category]:
    """List every category, alphabetically."""
    return list(db.execute(select(Category).order_by(Category.name)).scalars())


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)) -> Category:
    """Create a category. Names are unique."""
    category = Category(name=payload.name)
    db.add(category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A category named {payload.name!r} already exists",
        ) from None
    db.refresh(category)
    logger.info("Created category %s (%s)", category.id, category.name)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a category.

    Its products are kept and become uncategorised — the food is still in the
    fridge even if the label is gone.
    """
    category = db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    db.delete(category)
    db.commit()
    logger.info("Deleted category %s (%s)", category_id, category.name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
