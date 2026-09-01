"""Shopping trip endpoint tests."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.receipt_client import ReceiptExtraction, ReceiptItem

pytestmark = pytest.mark.integration


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


def _extraction(**overrides) -> ReceiptExtraction:
    defaults = {
        "items": [
            ReceiptItem(name="Nopal limpio", quantity=Decimal("1.00"), is_food=True),
            ReceiptItem(name="Jabón Grisi", quantity=Decimal("2.00"), is_food=False),
        ],
        "stated_item_count": 3,
    }
    defaults.update(overrides)
    return ReceiptExtraction(**defaults)


def _upload_receipt(api_client, mocker, **extraction_overrides):
    mocker.patch("app.routers.trips.extract_receipt", return_value=_extraction(**extraction_overrides))
    return api_client.post("/trips/receipt", files={"image": ("receipt.jpg", b"fake", "image/jpeg")})


def test_a_receipt_photo_creates_a_trip_with_its_items(api_client, mocker):
    response = _upload_receipt(api_client, mocker)

    assert response.status_code == 201
    body = response.json()
    assert [(i["name"], i["quantity"], i["is_food"]) for i in body["items"]] == [
        ("Nopal limpio", "1.00", True),
        ("Jabón Grisi", "2.00", False),
    ]
    assert body["stated_item_count"] == 3
    assert all(i["resolved_at"] is None and i["product_id"] is None for i in body["items"])


def test_counted_quantity_and_reconciliation_match_when_they_should(api_client, mocker):
    response = _upload_receipt(api_client, mocker, stated_item_count=3)

    body = response.json()
    assert body["counted_quantity"] == "3.00"
    assert body["reconciled"] is True


def test_reconciliation_is_false_when_the_sum_does_not_match(api_client, mocker):
    response = _upload_receipt(api_client, mocker, stated_item_count=99)

    body = response.json()
    assert body["counted_quantity"] == "3.00"
    assert body["reconciled"] is False


def test_reconciliation_is_null_when_the_receipt_had_no_stated_total(api_client, mocker):
    response = _upload_receipt(api_client, mocker, stated_item_count=None)

    assert response.json()["reconciled"] is None


def test_a_total_extraction_failure_is_reported_as_service_unavailable(api_client, mocker):
    mocker.patch("app.routers.trips.extract_receipt", return_value=None)

    response = api_client.post("/trips/receipt", files={"image": ("receipt.jpg", b"fake", "image/jpeg")})

    assert response.status_code == 503


def test_an_empty_file_is_rejected_without_calling_the_model(api_client, mocker):
    extract = mocker.patch("app.routers.trips.extract_receipt")

    response = api_client.post("/trips/receipt", files={"image": ("receipt.jpg", b"", "image/jpeg")})

    assert response.status_code == 422
    extract.assert_not_called()


def test_an_oversized_file_is_rejected_without_calling_the_model(api_client, mocker):
    extract = mocker.patch("app.routers.trips.extract_receipt")
    oversized = b"x" * (10 * 1024 * 1024 + 1)

    response = api_client.post("/trips/receipt", files={"image": ("receipt.jpg", oversized, "image/jpeg")})

    assert response.status_code == 413
    extract.assert_not_called()


def test_current_trip_is_null_when_there_is_none(api_client):
    assert api_client.get("/trips/current").json() is None


def test_current_trip_returns_one_with_an_unresolved_item(api_client, mocker):
    created = _upload_receipt(api_client, mocker).json()

    response = api_client.get("/trips/current")

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_current_trip_is_null_once_every_item_is_resolved(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    for item in trip["items"]:
        api_client.post(f"/trips/{trip['id']}/items/{item['id']}/drop")

    assert api_client.get("/trips/current").json() is None


def test_current_trip_is_the_most_recently_created_unresolved_one(api_client, mocker):
    older = _upload_receipt(api_client, mocker).json()
    newer = _upload_receipt(api_client, mocker).json()

    assert api_client.get("/trips/current").json()["id"] == newer["id"]
    assert older["id"] != newer["id"]


def test_updating_an_item_corrects_its_fields(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]

    response = api_client.patch(
        f"/trips/{trip['id']}/items/{item['id']}",
        json={"name": "Nopal", "quantity": "0.59", "is_food": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Nopal"
    assert body["quantity"] == "0.59"


def test_updating_a_resolved_item_is_rejected(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]
    api_client.post(f"/trips/{trip['id']}/items/{item['id']}/drop")

    response = api_client.patch(
        f"/trips/{trip['id']}/items/{item['id']}",
        json={"name": "Nopal", "quantity": "1.00", "is_food": True},
    )

    assert response.status_code == 409


def test_dropping_an_item_resolves_it_without_a_product(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]

    response = api_client.post(f"/trips/{trip['id']}/items/{item['id']}/drop")

    assert response.status_code == 200
    body = response.json()
    assert body["resolved_at"] is not None
    assert body["product_id"] is None


def test_dropping_an_already_resolved_item_is_rejected(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]
    api_client.post(f"/trips/{trip['id']}/items/{item['id']}/drop")

    response = api_client.post(f"/trips/{trip['id']}/items/{item['id']}/drop")

    assert response.status_code == 409


def test_resolving_an_item_links_it_to_a_real_product(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]
    product = api_client.post("/products", json=_product(name=item["name"])).json()

    response = api_client.post(
        f"/trips/{trip['id']}/items/{item['id']}/resolve", json={"product_id": product["id"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["resolved_at"] is not None
    assert body["product_id"] == product["id"]


def test_resolving_against_a_nonexistent_product_is_rejected(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]

    response = api_client.post(f"/trips/{trip['id']}/items/{item['id']}/resolve", json={"product_id": 9999})

    assert response.status_code == 422


def test_resolving_an_already_resolved_item_is_rejected(api_client, mocker):
    trip = _upload_receipt(api_client, mocker).json()
    item = trip["items"][0]
    api_client.post(f"/trips/{trip['id']}/items/{item['id']}/drop")
    product = api_client.post("/products", json=_product()).json()

    response = api_client.post(
        f"/trips/{trip['id']}/items/{item['id']}/resolve", json={"product_id": product["id"]}
    )

    assert response.status_code == 409


def test_an_item_from_another_trip_is_not_found(api_client, mocker):
    trip_a = _upload_receipt(api_client, mocker).json()
    trip_b = _upload_receipt(api_client, mocker).json()
    item_from_a = trip_a["items"][0]

    response = api_client.post(f"/trips/{trip_b['id']}/items/{item_from_a['id']}/drop")

    assert response.status_code == 404


@pytest.mark.parametrize(
    "method,path_suffix",
    [
        ("patch", "/items/9999"),
        ("post", "/items/9999/drop"),
        ("post", "/items/9999/resolve"),
    ],
)
def test_missing_item_is_404(api_client, mocker, method, path_suffix):
    trip = _upload_receipt(api_client, mocker).json()
    kwargs = {}
    if path_suffix.endswith("/items/9999"):
        kwargs = {"json": {"name": "x", "quantity": "1.00", "is_food": True}}
    elif path_suffix.endswith("/resolve"):
        kwargs = {"json": {"product_id": 1}}

    response = getattr(api_client, method)(f"/trips/{trip['id']}{path_suffix}", **kwargs)

    assert response.status_code == 404


@pytest.mark.integration
def test_resolving_actually_commits_not_just_the_in_session_object(api_client, db_session, mocker):
    """Same reasoning as products' own reassign-commit test: api_client and
    db_session share one SQLAlchemy session in this fixture, so only a fresh
    read after expiring the identity map proves the UPDATE reached the
    database rather than just this test's in-memory object."""
    trip = _upload_receipt(api_client, mocker).json()
    item, other_item = trip["items"]
    product = api_client.post("/products", json=_product(name=item["name"])).json()

    api_client.post(f"/trips/{trip['id']}/items/{item['id']}/resolve", json={"product_id": product["id"]})
    api_client.post(f"/trips/{trip['id']}/items/{other_item['id']}/drop")
    db_session.expire_all()

    assert api_client.get("/trips/current").json() is None
