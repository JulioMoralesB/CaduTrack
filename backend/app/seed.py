"""Seed the default category list.

Idempotent: only an empty table is seeded, so it is safe to call on every
deploy. Categories can be renamed and deleted from the app (#144), so a default
that's missing may be missing on purpose: inserting it again would bring back
"Snacks" on every deploy after someone renamed it "Botanas".

Run it after applying migrations:

    alembic upgrade head
    python -m app.seed
"""

import logging

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.logging_config import setup_logging
from app.models import Category

# Explicit rather than __name__: running this as `python -m app.seed` would
# otherwise label every line "__main__" in the logs.
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
    """Insert the default categories into an empty table and return how many
    were added.

    ON CONFLICT DO NOTHING as well as the emptiness check, so two runs racing
    on a fresh database cannot collide into an error.
    """
    if session.scalar(select(exists().where(Category.id.is_not(None)))):
        logger.info("Categories already present, nothing to seed")
        return 0

    statement = (
        insert(Category)
        .values([{"name": name} for name in DEFAULT_CATEGORIES])
        .on_conflict_do_nothing(index_elements=["name"])
        .returning(Category.name)
    )
    inserted = session.execute(statement).scalars().all()
    session.commit()

    logger.info("Seeded %d default categories: %s", len(inserted), ", ".join(inserted))
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
