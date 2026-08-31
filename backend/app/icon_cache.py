"""Caches a model-resolved icon by normalized product name.

A local table hit (app.icons) never reaches this — a dict lookup is already
free, and caching it would only add a database round trip to the fast path.
This exists purely to stop the same name paying for a second model call.
"""

import logging

from sqlalchemy.orm import Session

from app.models import IconNameCache

logger = logging.getLogger(__name__)


def get(session: Session, normalized_name: str) -> str | None:
    """A previously cached icon for this name, or None on a miss."""
    cached = session.get(IconNameCache, normalized_name)
    return cached.icon if cached is not None else None


def remember(session: Session, normalized_name: str, icon: str) -> None:
    """Record a model-resolved icon so this name never calls the model again.

    Overwrites rather than skipping on a duplicate key: two concurrent
    requests for the same brand-new name could each resolve it independently
    before either commits, and the second write should simply win rather than
    raise a duplicate-key error over a value that is going to be identical or
    an equally-valid answer either way.
    """
    session.merge(IconNameCache(normalized_name=normalized_name, icon=icon))
    session.commit()
    logger.info("Cached icon for %r: %s", normalized_name, icon)
