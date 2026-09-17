"""Summary contract for the dashboard — see #93 and ADR 012.

Small, additive-only, and explicitly for external consumption: this is not
the internal API. A future field is fine to add; changing or removing one of
these is a breaking change for a consumer this service does not know exists.
"""

from datetime import date

from pydantic import BaseModel


class SummaryNextProduct(BaseModel):
    """One active product's name and expiry date — the shape both
    `expired_products` and `next` below share."""

    name: str
    expires_at: date


class SummaryResponse(BaseModel):
    expired: int
    # Every active product already past its own expires_at — `expired`
    # above says how many, this says which ones. Sorted soonest (most
    # overdue) first. See #130.
    expired_products: list[SummaryNextProduct]
    expiring_soon: int
    # Every active, NOT-yet-expired product sharing the soonest expires_at —
    # what to use before it joins expired_products, never what is already
    # there. A same-day tie is common (a shopping trip usually adds several
    # at once), and naming only one of them hid the rest from the one field
    # meant to say what's next. Empty when nothing active is left that
    # hasn't already expired — see #130: an already-expired product used to
    # crowd this out and never let go once nobody dealt with it, so
    # expired_products above is now the only place that ever names one.
    next: list[SummaryNextProduct]
