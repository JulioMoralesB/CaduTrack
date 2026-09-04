"""Dashboard summary endpoint tests — see #93 and ADR 012."""

from datetime import date, timedelta

import pytest

from app.config import settings

pytestmark = pytest.mark.integration

_KEY = "test-summary-shared-secret"


def _product(**overrides) -> dict:
    payload = {
        "name": "Leche entera",
        "quantity": "2.00",
        "unit": "litros",
        "expires_at": str(date.today() + timedelta(days=5)),
        "location": "fridge",
        "notes": None,
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def summary_key(monkeypatch):
    """The endpoint fails closed without this — see require_summary_api_key."""
    monkeypatch.setattr(settings, "summary_api_key", _KEY)
    return _KEY


def test_rejects_a_request_with_no_key(api_client, summary_key):
    response = api_client.get("/summary")

    assert response.status_code == 401


def test_rejects_the_wrong_key(api_client, summary_key):
    response = api_client.get("/summary", headers={"X-API-Key": "not-it"})

    assert response.status_code == 401


def test_fails_closed_when_no_key_is_configured_at_all(api_client):
    """Unlike api_key, an unset summary_api_key must not mean "disabled" —
    this endpoint sits on a published port with nothing else in front of
    it. A correct-looking key must still be rejected."""
    response = api_client.get("/summary", headers={"X-API-Key": "anything"})

    assert response.status_code == 401


def test_accepts_the_configured_key(api_client, summary_key):
    response = api_client.get("/summary", headers={"X-API-Key": summary_key})

    assert response.status_code == 200


def test_counts_expired_and_expiring_soon_separately(api_client, summary_key):
    today = date.today()
    api_client.post("/products", json=_product(name="Ya caducado", expires_at=str(today - timedelta(days=1))))
    api_client.post("/products", json=_product(name="Por caducar", expires_at=str(today + timedelta(days=3))))
    api_client.post("/products", json=_product(name="Fresco", expires_at=str(today + timedelta(days=30))))

    body = api_client.get("/summary", headers={"X-API-Key": summary_key}).json()

    assert body["expired"] == 1
    assert body["expiring_soon"] == 1


def test_next_names_the_single_most_urgent_product_even_if_only_fresh(api_client, summary_key):
    """No expired or expiring_soon product exists — next must still name
    the soonest one, not report empty just because nothing is urgent yet."""
    today = date.today()
    api_client.post("/products", json=_product(name="Más lejano", expires_at=str(today + timedelta(days=60))))
    api_client.post("/products", json=_product(name="Más próximo", expires_at=str(today + timedelta(days=30))))

    body = api_client.get("/summary", headers={"X-API-Key": summary_key}).json()

    assert body["expired"] == 0
    assert body["expiring_soon"] == 0
    assert body["next"] == [{"name": "Más próximo", "expires_at": str(today + timedelta(days=30))}]


def test_next_lists_every_product_tied_for_soonest(api_client, summary_key):
    """A same-day tie is the common case (a shopping trip usually adds
    several products at once), not an edge case — every one of them
    belongs in next, not just whichever the query happened to return
    first."""
    today = date.today()
    tied_at = today + timedelta(days=3)
    api_client.post("/products", json=_product(name="Yogurt", expires_at=str(tied_at)))
    api_client.post("/products", json=_product(name="Leche", expires_at=str(tied_at)))
    api_client.post("/products", json=_product(name="Más lejano", expires_at=str(today + timedelta(days=30))))

    body = api_client.get("/summary", headers={"X-API-Key": summary_key}).json()

    assert {(item["name"], item["expires_at"]) for item in body["next"]} == {
        ("Yogurt", str(tied_at)),
        ("Leche", str(tied_at)),
    }


def test_next_is_empty_when_there_are_no_active_products(api_client, summary_key):
    body = api_client.get("/summary", headers={"X-API-Key": summary_key}).json()

    assert body == {"expired": 0, "expiring_soon": 0, "next": []}


def test_a_consumed_product_is_excluded_entirely(api_client, summary_key):
    today = date.today()
    created = api_client.post(
        "/products", json=_product(name="Consumido", expires_at=str(today - timedelta(days=1)))
    ).json()
    api_client.post(f"/products/{created['id']}/consume")

    body = api_client.get("/summary", headers={"X-API-Key": summary_key}).json()

    assert body == {"expired": 0, "expiring_soon": 0, "next": []}


def test_the_response_shape_is_exactly_the_documented_contract(api_client, summary_key):
    """A breaking change here must fail this test, not surprise a consumer
    this service does not know exists — see ADR 012."""
    today = date.today()
    api_client.post("/products", json=_product(name="Nopalitos", expires_at=str(today)))

    body = api_client.get("/summary", headers={"X-API-Key": summary_key}).json()

    assert set(body.keys()) == {"expired", "expiring_soon", "next"}
    assert isinstance(body["next"], list)
    assert set(body["next"][0].keys()) == {"name", "expires_at"}
