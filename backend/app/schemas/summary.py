"""Summary contract for the dashboard — see #93 and ADR 012.

Small, additive-only, and explicitly for external consumption: this is not
the internal API. A future field is fine to add; changing or removing one of
these is a breaking change for a consumer this service does not know exists.
"""

from datetime import date

from pydantic import BaseModel


class SummaryNextProduct(BaseModel):
    """The single most urgent active product, regardless of its own status —
    still worth naming even when it is merely fresh and nothing is actually
    expiring soon."""

    name: str
    expires_at: date


class SummaryResponse(BaseModel):
    expired: int
    expiring_soon: int
    # None only when there are no active products at all.
    next: SummaryNextProduct | None
