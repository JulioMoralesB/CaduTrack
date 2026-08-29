"""ORM models.

Imported wholesale by alembic/env.py so every table is registered on
Base.metadata before autogenerate runs.
"""

from app.models.category import Category
from app.models.product import Location, Product

__all__ = ["Category", "Location", "Product"]
