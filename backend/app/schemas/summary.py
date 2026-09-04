"""Summary contract for the dashboard — see #93 and ADR 012.

Small, additive-only, and explicitly for external consumption: this is not
the internal API. A future field is fine to add; changing or removing one of
these is a breaking change for a consumer this service does not know exists.
"""

from datetime import date

from pydantic import BaseModel


class SummaryNextProduct(BaseModel):
    """One of the most urgent active products, regardless of its own status —
    still worth naming even when it is merely fresh and nothing is actually
    expiring soon."""

    name: str
    expires_at: date


class SummaryResponse(BaseModel):
    expired: int
    expiring_soon: int
    # Every active product sharing the soonest expires_at — a same-day tie
    # is common (a shopping trip usually adds several at once), and naming
    # only one of them hid the rest from the one field meant to say what's
    # most urgent. Empty only when there are no active products at all.
    next: list[SummaryNextProduct]
