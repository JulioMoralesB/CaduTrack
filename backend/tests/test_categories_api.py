"""Category endpoint tests."""

import pytest

pytestmark = pytest.mark.integration


def test_create_and_list_categories(api_client):
    created = api_client.post("/categories", json={"name": "Lácteos"})
    assert created.status_code == 201
    assert created.json()["name"] == "Lácteos"

    api_client.post("/categories", json={"name": "Bebidas"})

    listed = api_client.get("/categories")
    assert listed.status_code == 200
    # Alphabetical, not insertion order.
    assert [c["name"] for c in listed.json()] == ["Bebidas", "Lácteos"]


def test_duplicate_category_name_is_rejected(api_client):
    api_client.post("/categories", json={"name": "Carnes"})
    duplicate = api_client.post("/categories", json={"name": "Carnes"})

    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]


def test_blank_category_name_is_rejected(api_client):
    assert api_client.post("/categories", json={"name": ""}).status_code == 422


def test_deleting_a_category_keeps_its_products(api_client):
    """Deleting a label must not delete food the user still has."""
    category_id = api_client.post("/categories", json={"name": "Verduras"}).json()["id"]
    api_client.post(
        "/products",
        json={
            "name": "Espinacas",
            "category_id": category_id,
            "expires_at": "2026-12-01",
            "location": "fridge",
        },
    )

    assert api_client.delete(f"/categories/{category_id}").status_code == 204

    products = api_client.get("/products").json()
    assert len(products) == 1
    assert products[0]["category_id"] is None
    assert products[0]["category"] is None


def test_deleting_a_missing_category_is_404(api_client):
    assert api_client.delete("/categories/9999").status_code == 404
