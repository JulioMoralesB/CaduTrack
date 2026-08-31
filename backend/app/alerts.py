"""The daily expiry alert: what to say, and to whom.

Delivery lives in app/telegram.py. Keeping the two apart means the message can
be asserted in tests without a network call, which is most of what can go wrong.
"""

import logging
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.expiry import expiry_status, today
from app.labels import LOCATION_LABELS, expiry_phrase
from app.models import Product
from app.settings_store import read_only
from app.telegram import escape, send_message

logger = logging.getLogger(__name__)


def products_needing_attention(
    session: Session, days_ahead: int | None = None, reference: date | None = None
) -> list[Product]:
    """Products already expired or expiring within the next `days_ahead` days.

    Expired items are included deliberately. They are the ones most worth acting
    on, and the action — eat it or bin it and delete the row — is the same one
    that stops them reappearing tomorrow.
    """
    if days_ahead is None:
        _enabled, _alert_time, days_ahead = read_only(session)
    horizon = (reference or today()) + timedelta(days=days_ahead)

    statement = (
        select(Product)
        .options(selectinload(Product.category))
        .where(Product.expires_at <= horizon)
        .order_by(Product.expires_at, Product.name)
    )
    return list(session.execute(statement).scalars())


def group_by_location(products: list[Product]) -> dict[str, list[Product]]:
    """Group products by storage location, preserving the expiry ordering."""
    grouped: dict[str, list[Product]] = defaultdict(list)
    for product in products:
        grouped[product.location].append(product)
    return dict(grouped)


def format_alert(products: list[Product], reference: date | None = None) -> str:
    """Render the Telegram message body.

    Grouped by location because that is how the food is actually visited: you
    open the fridge once, not once per product.
    """
    reference = reference or today()
    grouped = group_by_location(products)

    noun = "producto" if len(products) == 1 else "productos"
    lines = [f"<b>CaduTrack</b> — {len(products)} {noun} por revisar", ""]

    # Stable order regardless of what happens to be in the fridge today.
    for location in ("fridge", "freezer", "pantry"):
        in_location = grouped.get(location)
        if not in_location:
            continue

        lines.append(f"<b>{escape(LOCATION_LABELS[location])}</b>")
        for product in in_location:
            days = (product.expires_at - reference).days
            marker = "🔴" if expiry_status(days) == "expired" else "🟡"
            lines.append(f"{marker} {escape(product.name)} — {escape(expiry_phrase(days))}")
        lines.append("")

    return "\n".join(lines).strip()


def send_expiry_alert(session: Session, reference: date | None = None) -> int:
    """Send the daily alert. Returns how many products it covered.

    Sends nothing when there is nothing to report: a daily "all good" message
    trains you to ignore the channel, and then the one that matters is ignored
    too.
    """
    _enabled, _alert_time, days_ahead = read_only(session)
    products = products_needing_attention(session, days_ahead=days_ahead, reference=reference)

    if not products:
        logger.info("Nothing expiring within %s days, no alert sent", days_ahead)
        return 0

    send_message(format_alert(products, reference=reference))
    return len(products)
