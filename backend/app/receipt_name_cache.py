"""Caches the accepted product name for a raw receipt line — see #126.

A cache hit never reaches the model — this exists purely to stop the same
raw ticket text ever being (mis)read twice, and to make a correction stick
permanently instead of being asked again on the next receipt.
"""

import logging

from sqlalchemy.orm import Session

from app.icons import normalize as normalize_name
from app.models import ReceiptNameLookup

logger = logging.getLogger(__name__)


def _key(raw_text: str) -> str:
    """Collapse incidental OCR noise (repeated spaces, case, accents) so the
    same physical item still keys the same row even if a later read of the
    same receipt varies slightly in spacing or capitalization."""
    return normalize_name(" ".join(raw_text.split()))


def get(session: Session, raw_text: str) -> str | None:
    """A previously accepted name for this raw text, or None on a miss."""
    cached = session.get(ReceiptNameLookup, _key(raw_text))
    return cached.product_name if cached is not None else None


def remember(session: Session, raw_text: str, product_name: str) -> None:
    """Record the name a trip item actually resolved to, so this raw text
    never has to be read or guessed again.

    Overwrites rather than skipping on a duplicate key, same reasoning as
    icon_cache.remember: a later, corrected resolve for the same raw text
    should simply win over an earlier guess.
    """
    session.merge(ReceiptNameLookup(raw_text=_key(raw_text), product_name=product_name))
    session.commit()
    logger.info("Cached receipt name for %r: %s", raw_text, product_name)
