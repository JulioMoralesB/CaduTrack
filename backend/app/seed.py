"""Seed the default category list.

Idempotent: running it repeatedly inserts nothing new, so it is safe to call on
every deploy. Categories the user has since renamed or deleted are left alone —
only names that are absent get inserted.

Run it after applying migrations:

    alembic upgrade head
    python -m app.seed
"""

import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.logging_config import setup_logging
from app.models import Category

# Explicit rather than __name__: running this as `python -m app.seed` would
# otherwise label every line "__main__" in Loki.
logger = logging.getLogger("app.seed")

# Spanish, because these are user-facing labels the user edits directly.
# Unlike Product.location, category names are data rather than keys.
#
# Deliberately no "Congelados": frozen is a storage state, already covered by
# Product.location == "freezer". Frozen peas are Verduras that live in the
# freezer, and categorising them by location would weaken the category filter.
DEFAULT_CATEGORIES: tuple[str, ...] = (
    "Lácteos",
    "Carnes",
    "Verduras",
    "Frutas",
    "Cereales",
    "Bebidas",
    "Snacks",
    "Otros",
)


def seed_categories(session: Session) -> int:
    """Insert any missing default categories and return how many were added.

    Uses ON CONFLICT DO NOTHING against the unique name constraint rather than
    a read-then-write, so concurrent runs cannot race each other into an error.
    """
    statement = (
        insert(Category)
        .values([{"name": name} for name in DEFAULT_CATEGORIES])
        .on_conflict_do_nothing(index_elements=["name"])
        .returning(Category.name)
    )
    inserted = session.execute(statement).scalars().all()
    session.commit()

    if inserted:
        logger.info("Seeded %d default categories: %s", len(inserted), ", ".join(inserted))
    else:
        logger.info("Default categories already present, nothing to seed")

    return len(inserted)


def main() -> None:
    """Entry point for `python -m app.seed`."""
    from app.config import settings

    setup_logging(
        timezone=settings.timezone,
        log_file=settings.log_file or None,
        level=settings.log_level,
    )
    with SessionLocal() as session:
        seed_categories(session)


if __name__ == "__main__":
    main()
