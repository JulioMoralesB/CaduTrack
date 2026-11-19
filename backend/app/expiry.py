"""Expiry status calculation.

Single source of truth for the fresh / expiring_soon / expired thresholds, so
the API response, the daily alert and any future filter agree.
"""

from datetime import date, datetime
from enum import StrEnum
from zoneinfo import ZoneInfo

from app.config import settings

# A product is "expiring soon" from this many days out, inclusive — until
# the stored alert settings say otherwise. See #182: "Días de anticipación"
# in Ajustes is the one setting, so the amber status, the "Por caducar"
# chip, /summary and the daily alert always agree on what is about to
# expire. 7 is only the value before those settings are first read.
EXPIRING_SOON_DAYS = 7

_expiring_soon_days = EXPIRING_SOON_DAYS


def set_expiring_soon_days(days: int) -> None:
    """Follow the alert's days-ahead setting — app.settings_store calls this
    whenever it reads or saves one.

    Held process-wide rather than looked up per product: a status is computed
    for every row of every product response, and the setting is a singleton
    that only ever changes through settings_store in this same process.
    """
    global _expiring_soon_days
    _expiring_soon_days = days


class ExpiryStatus(StrEnum):
    """How urgent a product is."""

    FRESH = "fresh"
    EXPIRING_SOON = "expiring_soon"
    EXPIRED = "expired"


def today() -> date:
    """Today's date in the configured timezone.

    Not date.today(): the host's local date can be a day off from the user's
    around midnight, which would mark food expired while it is still good.
    An unknown TIMEZONE raises here rather than silently using UTC — quietly
    doing expiry maths in the wrong zone is worse than a startup failure.
    """
    return datetime.now(ZoneInfo(settings.timezone)).date()


def days_until_expiry(expires_at: date, reference: date | None = None) -> int:
    """Whole days from the reference date until expiry. Negative once expired."""
    return (expires_at - (reference or today())).days


def shelf_life_days(expires_at: date, created_at: datetime) -> int | None:
    """How many days a product had left on the day it was added — see #164.

    created_at is a timestamp, so it's converted to the configured timezone
    first, or anything added at night in Mexico comes up a day short. None
    when it was added on or after its own expiry date: that isn't a shelf
    life worth offering for the next purchase.
    """
    days = (expires_at - created_at.astimezone(ZoneInfo(settings.timezone)).date()).days
    return days if days > 0 else None


def expiry_status(days: int) -> ExpiryStatus:
    """Bucket a day count.

    A product expiring today counts as expiring soon, not expired — it is still
    edible, and the point is to prompt the user to use it.
    """
    if days < 0:
        return ExpiryStatus.EXPIRED
    if days <= _expiring_soon_days:
        return ExpiryStatus.EXPIRING_SOON
    return ExpiryStatus.FRESH
