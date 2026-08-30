"""Expiry alert tests."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.alerts import format_alert, group_by_location, products_needing_attention, send_expiry_alert
from app.models import Product
from app.telegram import TelegramNotConfigured, escape

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
