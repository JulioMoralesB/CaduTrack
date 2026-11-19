"""Expiry alert tests."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.alerts import (
    TELEGRAM_MESSAGE_LIMIT,
    alert_messages,
    format_alert,
    group_by_location,
    products_needing_attention,
    send_expiry_alert,
)
from app.models import Product
from app.telegram import TelegramDeliveryError, TelegramNotConfigured, escape

REFERENCE = date(2026, 9, 1)


def _product(name: str, days: int, location: str = "fridge") -> Product:
    return Product(
        id=abs(hash(name)) % 10000,
        name=name,
        quantity=1,
        expires_at=REFERENCE + timedelta(days=days),
        location=location,
    )


def test_groups_by_location_keeping_the_expiry_order():
    products = [
        _product("Yogur", -1, "fridge"),
        _product("Arroz", 3, "pantry"),
        _product("Leche", 2, "fridge"),
    ]

    grouped = group_by_location(products)

    assert [p.name for p in grouped["fridge"]] == ["Yogur", "Leche"]
    assert [p.name for p in grouped["pantry"]] == ["Arroz"]


def test_message_uses_spanish_labels_and_phrasing():
    message = format_alert([_product("Leche entera", 0, "fridge")], reference=REFERENCE)

    assert "Refrigerador" in message
    assert "caduca hoy" in message
    # Never the stored key.
    assert "fridge" not in message


def test_expired_and_expiring_are_visually_distinct():
    message = format_alert(
        [_product("Yogur", -2, "fridge"), _product("Leche", 3, "fridge")], reference=REFERENCE
    )

    expired_line = next(line for line in message.splitlines() if "Yogur" in line)
    expiring_line = next(line for line in message.splitlines() if "Leche" in line)
    assert expired_line.startswith("🔴")
    assert expiring_line.startswith("🟡")


def test_locations_appear_in_a_stable_order():
    """Otherwise the message reshuffles daily and stops being skimmable."""
    message = format_alert(
        [_product("Arroz", 1, "pantry"), _product("Guisantes", 1, "freezer"), _product("Leche", 1, "fridge")],
        reference=REFERENCE,
    )

    order = [message.index(label) for label in ("Refrigerador", "Congelador", "Alacena")]
    assert order == sorted(order)


def test_product_names_are_escaped():
    """A name with an ampersand would otherwise make Telegram reject the message."""
    message = format_alert([_product("Pan & mantequilla", 1)], reference=REFERENCE)

    assert "Pan &amp; mantequilla" in message
    assert "Pan & mantequilla" not in message


def test_the_count_is_written_as_spanish_not_as_a_template():
    one = format_alert([_product("Leche", 1)], reference=REFERENCE)
    many = format_alert([_product("Leche", 1), _product("Pan", 2)], reference=REFERENCE)

    assert "1 producto por revisar" in one
    assert "2 productos por revisar" in many


def _telegram_length(text: str) -> int:
    """Length as Telegram counts it: UTF-16 code units, so an emoji is two."""
    return len(text.encode("utf-16-le")) // 2


def _many_products(count: int) -> list[Product]:
    locations = ("fridge", "freezer", "pantry")
    products = [
        _product(f"Producto con un nombre bastante largo número {i:03d}", i % 7 - 2, locations[i % 3])
        for i in range(count)
    ]
    # Distinct ids: _product's hash-based one can collide over this many.
    for i, product in enumerate(products):
        product.id = 1000 + i
    return products


def test_a_short_alert_is_one_message_exactly_as_formatted():
    products = [_product("Leche", 1), _product("Pan", 2, "pantry")]

    assert alert_messages(products, reference=REFERENCE) == [format_alert(products, reference=REFERENCE)]


def test_a_long_alert_is_split_under_telegrams_limit():
    """See #181: Telegram rejects a message over 4096 characters, and then
    nothing at all arrives — on exactly the day there is most to report."""
    products = _many_products(240)
    assert _telegram_length(format_alert(products, reference=REFERENCE)) > 4096

    messages = alert_messages(products, reference=REFERENCE)

    assert len(messages) > 1
    assert all(_telegram_length(message) <= TELEGRAM_MESSAGE_LIMIT for message in messages)
    assert TELEGRAM_MESSAGE_LIMIT <= 4096


def test_a_split_alert_keeps_every_product_once_and_in_order():
    products = _many_products(240)

    messages = alert_messages(products, reference=REFERENCE)

    joined = "\n".join(messages)
    names = [line for line in joined.splitlines() if "Producto con un nombre" in line]
    assert len(names) == len(products)
    # Same order as the single message would have had.
    single = [line for line in format_alert(products, reference=REFERENCE).splitlines() if "Producto con un nombre" in line]
    assert names == single


def test_each_part_says_which_part_it_is_and_where_its_lines_are():
    messages = alert_messages(_many_products(240), reference=REFERENCE)
    total = len(messages)

    assert messages[0].startswith(f"<b>CaduTrack</b> — 240 productos por revisar (1/{total})")
    for number, message in enumerate(messages[1:], start=2):
        first_line, second_line = message.splitlines()[:2]
        assert first_line == f"<b>CaduTrack</b> — continúa ({number}/{total})"
        # A part never starts with a product line cut off from its location.
        assert second_line == "" and message.splitlines()[2].startswith("<b>")


def test_escape_leaves_ordinary_text_alone():
    assert escape("Leche entera") == "Leche entera"


@pytest.mark.integration
def test_query_covers_expired_and_upcoming_but_not_the_distant_future(db_session):
    reference = date(2026, 9, 1)
    for name, days in [("Caducado", -5), ("Hoy", 0), ("Limite", 7), ("Fuera", 8)]:
        db_session.add(_product(name, days))
    db_session.commit()

    found = products_needing_attention(db_session, days_ahead=7, reference=reference)

    assert [p.name for p in found] == ["Caducado", "Hoy", "Limite"]


@pytest.mark.integration
def test_a_consumed_product_is_excluded_even_though_it_is_expired(db_session):
    """A consumed item already left the fridge — it must not keep nagging
    the daily alert after being checked off. See #31."""
    from datetime import datetime, timezone

    consumed = _product("Ya comido", -1)
    consumed.consumed_at = datetime.now(timezone.utc)
    db_session.add(consumed)
    db_session.add(_product("Sin comer", -1))
    db_session.commit()

    found = products_needing_attention(db_session, days_ahead=7, reference=date(2026, 9, 1))

    assert [p.name for p in found] == ["Sin comer"]


@pytest.mark.integration
def test_nothing_to_report_sends_nothing(db_session):
    """A daily "all good" message trains you to ignore the channel."""
    db_session.add(_product("Lejano", 90))
    db_session.commit()

    with patch("app.alerts.send_message") as send:
        assert send_expiry_alert(db_session, reference=REFERENCE) == 0

    send.assert_not_called()


@pytest.mark.integration
def test_sends_when_there_is_something_to_report(db_session):
    db_session.add(_product("Leche", 1))
    db_session.commit()

    with patch("app.alerts.send_message") as send:
        assert send_expiry_alert(db_session, reference=REFERENCE) == 1

    send.assert_called_once()
    assert "Leche" in send.call_args[0][0]


@pytest.mark.integration
def test_a_long_alert_is_sent_as_several_messages_in_order(db_session):
    db_session.add_all(_many_products(240))
    db_session.commit()

    with patch("app.alerts.send_message") as send:
        assert send_expiry_alert(db_session, reference=REFERENCE) == 240

    sent = [call.args[0] for call in send.call_args_list]
    assert len(sent) > 1
    assert sent[0].startswith("<b>CaduTrack</b> — 240 productos por revisar (1/")


@pytest.mark.integration
def test_trigger_endpoint_reports_what_it_sent(api_client, db_session):
    db_session.add(_product("Leche", 1))
    db_session.commit()

    with patch("app.alerts.send_message"):
        response = api_client.post("/alerts/trigger")

    assert response.status_code == 200
    assert response.json() == {"sent": True, "products": 1, "detail": "Alerta enviada"}


@pytest.mark.integration
def test_trigger_endpoint_says_so_when_telegram_is_unconfigured(api_client, db_session):
    """Better a clear 503 than a silent success that delivered nothing."""
    db_session.add(_product("Leche", 1))
    db_session.commit()

    with patch("app.alerts.send_message", side_effect=TelegramNotConfigured("not configured")):
        response = api_client.post("/alerts/trigger")

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


@pytest.mark.integration
def test_trigger_endpoint_passes_on_why_telegram_rejected_the_alert(api_client, db_session):
    """A readable 502, not a bare 500 — see #170. What Telegram said is the
    only clue to what's misconfigured."""
    db_session.add(_product("Leche", 1))
    db_session.commit()

    rejected = TelegramDeliveryError(
        "Telegram rejected the message: HTTP 400 Bad Request: chat not found",
        status_code=400,
        reason="Bad Request: chat not found",
    )
    with patch("app.alerts.send_message", side_effect=rejected):
        response = api_client.post("/alerts/trigger")

    assert response.status_code == 502
    assert response.json()["detail"] == "Telegram rechazó la alerta: Bad Request: chat not found"


@pytest.mark.integration
def test_trigger_endpoint_says_so_when_telegram_cannot_be_reached(api_client, db_session):
    db_session.add(_product("Leche", 1))
    db_session.commit()

    unreachable = TelegramDeliveryError("Could not reach Telegram: ConnectError")
    with patch("app.alerts.send_message", side_effect=unreachable):
        response = api_client.post("/alerts/trigger")

    assert response.status_code == 502
    assert response.json()["detail"] == "No se pudo conectar con Telegram. Inténtalo de nuevo."
