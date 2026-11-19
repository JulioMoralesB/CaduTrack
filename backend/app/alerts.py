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
    that stops them reappearing tomorrow. A consumed item needs no such nudge:
    it already left the fridge, by the tidier path.
    """
    if days_ahead is None:
        _enabled, _alert_time, days_ahead = read_only(session)
    horizon = (reference or today()) + timedelta(days=days_ahead)

    statement = (
        select(Product)
        .options(selectinload(Product.category))
        .where(Product.expires_at <= horizon, Product.consumed_at.is_(None))
        .order_by(Product.expires_at, Product.name)
    )
    return list(session.execute(statement).scalars())


def group_by_location(products: list[Product]) -> dict[str, list[Product]]:
    """Group products by storage location, preserving the expiry ordering."""
    grouped: dict[str, list[Product]] = defaultdict(list)
    for product in products:
        grouped[product.location].append(product)
    return dict(grouped)


# Telegram rejects a message over 4096 characters — counted in UTF-16 code
# units, so each 🔴/🟡 is two — and then nothing is delivered at all. Kept a
# little under, for the part header added after packing. See #181.
TELEGRAM_MESSAGE_LIMIT = 4000


def _telegram_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _header(products: list[Product]) -> str:
    noun = "producto" if len(products) == 1 else "productos"
    return f"<b>CaduTrack</b> — {len(products)} {noun} por revisar"


def _location_sections(products: list[Product], reference: date) -> list[tuple[str, list[str]]]:
    """(location heading, product lines) for each location with something in it."""
    grouped = group_by_location(products)
    sections = []
    # Stable order regardless of what happens to be in the fridge today.
    for location in ("fridge", "freezer", "pantry"):
        in_location = grouped.get(location)
        if not in_location:
            continue
        lines = []
        for product in in_location:
            days = (product.expires_at - reference).days
            marker = "🔴" if expiry_status(days) == "expired" else "🟡"
            lines.append(f"{marker} {escape(product.name)} — {escape(expiry_phrase(days))}")
        sections.append((f"<b>{escape(LOCATION_LABELS[location])}</b>", lines))
    return sections


def format_alert(products: list[Product], reference: date | None = None) -> str:
    """Render the Telegram message body, as one message.

    Grouped by location because that is how the food is actually visited: you
    open the fridge once, not once per product.
    """
    lines = [_header(products), ""]
    for heading, product_lines in _location_sections(products, reference or today()):
        lines += [heading, *product_lines, ""]
    return "\n".join(lines).strip()


def alert_messages(products: list[Product], reference: date | None = None) -> list[str]:
    """The alert as the messages to send: one, unless it is too long for one.

    Expired products stay in the alert until they are dealt with, so an
    ignored alert only grows — and a single over-long message would fail on
    exactly the day there is most to report. Split between lines, never
    inside one; a part that starts partway through a location repeats its
    heading, and every part says which one it is.
    """
    single = format_alert(products, reference)
    if _telegram_length(single) <= TELEGRAM_MESSAGE_LIMIT:
        return [single]

    # Room left for the longest header a part can get, "(12/12)" included.
    room = TELEGRAM_MESSAGE_LIMIT - _telegram_length(f"{_header(products)} (99/99)\n\n")
    parts: list[list[str]] = [[]]

    def length(lines: list[str]) -> int:
        return _telegram_length("\n".join(lines))

    for heading, product_lines in _location_sections(products, reference or today()):
        if parts[-1]:
            parts[-1].append("")
        if parts[-1] and length([*parts[-1], heading, product_lines[0]]) > room:
            parts.append([])
        parts[-1].append(heading)
        for line in product_lines:
            if length([*parts[-1], line]) > room:
                parts.append([heading])
            parts[-1].append(line)

    total = len(parts)
    messages = []
    for number, lines in enumerate(parts, start=1):
        header = f"{_header(products)} ({number}/{total})" if number == 1 else f"<b>CaduTrack</b> — continúa ({number}/{total})"
        messages.append("\n".join([header, "", *lines]).strip())
    return messages


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

    # In order, one after another: if one fails, the ones before it still
    # arrived, and the error says the rest didn't.
    for message in alert_messages(products, reference=reference):
        send_message(message)
    return len(products)
