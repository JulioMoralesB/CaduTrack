"""ORM models.

Imported wholesale by alembic/env.py so every table is registered on
Base.metadata before autogenerate runs.
"""

from app.models.category import Category
from app.models.product import IconSource, Location, Product
from app.models.setting import AlertSettings, IconNameCache, IconSettings

__all__ = [
    "AlertSettings",
    "Category",
    "IconNameCache",
    "IconSettings",
    "IconSource",
    "Location",
    "Product",
]
