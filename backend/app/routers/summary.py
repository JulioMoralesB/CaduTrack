"""Dashboard summary endpoint — see #93 and ADR 012.

A small, purpose-built, additive-only contract for the dashboard, not the
internal API — see routers/products.py for that. Read-only and cheap: one
query over just the two columns this needs, reusing app/expiry.py's own
thresholds rather than re-deriving them, so this never quietly disagrees
with what the product list itself shows.

Failing loudly on a database problem, rather than returning a "0" that
looks like good news, is not something this file does on purpose — it is
what happens by default when nothing here catches the exception. See ADR
012's own "never returns a partial answer as a complete one."
"""

import logging
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import get_db
from app.expiry import ExpiryStatus, days_until_expiry, expiry_status, today
from app.models import Product
from app.schemas.summary import SummaryNextProduct, SummaryResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["summary"])


def require_summary_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Reject anything without the dashboard's own shared secret.

    Fails closed when SUMMARY_API_KEY is unset, unlike every other optional
    setting in this app: an unset Telegram token or Ollama URL just turns a
    feature off, but an unset secret here would mean every product's name
    and expiry date sits open on the LAN, on a published port, with nothing
    else in front of it — Cloudflare Access only covers the public tunnel
    hostname. See ADR 012's own "authentication is required even on the LAN."
    """
    if not settings.summary_api_key or x_api_key != settings.summary_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing X-API-Key")


@router.get("/summary", response_model=SummaryResponse, dependencies=[Depends(require_summary_api_key)])
def get_summary(db: Session = Depends(get_db)) -> SummaryResponse:
    """Exactly what one dashboard card needs — see the module docstring."""
    rows = db.execute(
        select(Product.name, Product.expires_at)
        .where(Product.consumed_at.is_(None))
        .order_by(Product.expires_at.asc())
    ).all()

    reference = today()
    expired = 0
    expiring_soon = 0
    expired_products: list[SummaryNextProduct] = []
    not_yet_expired: list[tuple[str, date]] = []
    for name, expires_at in rows:
        bucket = expiry_status(days_until_expiry(expires_at, reference))
        if bucket == ExpiryStatus.EXPIRED:
            expired += 1
            expired_products.append(SummaryNextProduct(name=name, expires_at=expires_at))
        else:
            if bucket == ExpiryStatus.EXPIRING_SOON:
                expiring_soon += 1
            not_yet_expired.append((name, expires_at))

    # not_yet_expired keeps rows' own soonest-first order, so every entry
    # sharing the first one's own date — not just the first itself — is
    # equally the most urgent thing left to name. A same-day tie is the
    # common case, not an edge case: a shopping trip usually adds several
    # products at once. An already-expired product never reaches this list
    # at all — see #130: that used to mean the single earliest date always
    # won here even when it was long gone, and next never moved on to
    # naming anything else until someone dealt with it.
    next_products = (
        [
            SummaryNextProduct(name=name, expires_at=expires_at)
            for name, expires_at in not_yet_expired
            if expires_at == not_yet_expired[0][1]
        ]
        if not_yet_expired
        else []
    )

    return SummaryResponse(
        expired=expired,
        expired_products=expired_products,
        expiring_soon=expiring_soon,
        next=next_products,
    )
