"""Product endpoint tests."""

from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.integration


def _product(**overrides) -> dict:
    payload = {
        "name": "Leche entera",
        "quantity": "2.00",
        "unit": "litros",
        "expires_at": str(date.today() + timedelta(days=5)),
        "location": "fridge",
        "notes": "abierto",
    }
    payload.update(overrides)
    return payload


def test_create_returns_the_stored_product(api_client):
    response = api_client.post("/products", json=_product())

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Leche entera"
    assert body["location"] == "fridge"
    assert body["quantity"] == "2.00"
    assert body["id"] > 0


def test_products_are_listed_soonest_to_expire_first(api_client):
    """The whole point of the app is that what is about to go off is on top."""
    today = date.today()
    for days, name in ((30, "Arroz"), (2, "Yogur"), (10, "Queso")):
        api_client.post("/products", json=_product(name=name, expires_at=str(today + timedelta(days=days))))

    names = [p["name"] for p in api_client.get("/products").json()]
    assert names == ["Yogur", "Queso", "Arroz"]


def test_list_embeds_the_category(api_client):
    category_id = api_client.post("/categories", json={"name": "Lácteos"}).json()["id"]
    api_client.post("/products", json=_product(category_id=category_id))

    product = api_client.get("/products").json()[0]
    assert product["category"]["name"] == "Lácteos"


def test_filters_narrow_the_list(api_client):
    today = date.today()
    dairy = api_client.post("/categories", json={"name": "Lácteos"}).json()["id"]
    api_client.post("/products", json=_product(name="Yogur", category_id=dairy, location="fridge",
                                               expires_at=str(today + timedelta(days=3))))
    api_client.post("/products", json=_product(name="Arroz", location="pantry",
                                               expires_at=str(today + timedelta(days=200))))
    api_client.post("/products", json=_product(name="Guisantes", location="freezer",
                                               expires_at=str(today + timedelta(days=100))))

    by_location = api_client.get("/products", params={"location": "pantry"}).json()
    assert [p["name"] for p in by_location] == ["Arroz"]

    by_category = api_client.get("/products", params={"category_id": dairy}).json()
    assert [p["name"] for p in by_category] == ["Yogur"]

    expiring = api_client.get(
        "/products", params={"expires_before": str(today + timedelta(days=7))}
    ).json()
    assert [p["name"] for p in expiring] == ["Yogur"]


def test_filters_combine(api_client):
    today = date.today()
    api_client.post("/products", json=_product(name="Yogur", location="fridge",
                                               expires_at=str(today + timedelta(days=3))))
    api_client.post("/products", json=_product(name="Leche", location="fridge",
                                               expires_at=str(today + timedelta(days=90))))

    result = api_client.get(
        "/products",
        params={"location": "fridge", "expires_before": str(today + timedelta(days=7))},
    ).json()
    assert [p["name"] for p in result] == ["Yogur"]


def test_unknown_location_is_rejected(api_client):
    assert api_client.post("/products", json=_product(location="garage")).status_code == 422


def test_non_positive_quantity_is_rejected(api_client):
    """Caught by the schema, so the client gets a readable error not a DB failure."""
    response = api_client.post("/products", json=_product(quantity="0"))
    assert response.status_code == 422
    assert "quantity" in str(response.json())


def test_unknown_category_is_rejected_with_a_useful_message(api_client):
    response = api_client.post("/products", json=_product(category_id=9999))
    assert response.status_code == 422
    assert "9999" in response.json()["detail"]


def test_replacing_a_product_clears_omitted_fields(api_client):
    """PUT is a full replace: notes left out of the payload must not survive."""
    product_id = api_client.post("/products", json=_product(notes="abierto")).json()["id"]

    payload = _product(name="Leche desnatada", quantity="1.00")
    del payload["notes"]
    replaced = api_client.put(f"/products/{product_id}", json=payload)

    assert replaced.status_code == 200
    body = replaced.json()
    assert body["name"] == "Leche desnatada"
    assert body["quantity"] == "1.00"
    assert body["notes"] is None


def test_replacing_bumps_updated_at(api_client):
    """updated_at comes from a database trigger, so it must be read back."""
    created = api_client.post("/products", json=_product()).json()
    updated = api_client.put(f"/products/{created['id']}", json=_product(name="Leche fresca")).json()

    assert updated["updated_at"] > created["updated_at"]


def test_delete_removes_the_product(api_client):
    product_id = api_client.post("/products", json=_product()).json()["id"]

    assert api_client.delete(f"/products/{product_id}").status_code == 204
    assert api_client.get(f"/products/{product_id}").status_code == 404
    assert api_client.get("/products").json() == []


@pytest.mark.parametrize("method,path", [("get", "/products/9999"), ("put", "/products/9999"), ("delete", "/products/9999")])
def test_missing_product_is_404(api_client, method, path):
    kwargs = {"json": _product()} if method == "put" else {}
    assert getattr(api_client, method)(path, **kwargs).status_code == 404
