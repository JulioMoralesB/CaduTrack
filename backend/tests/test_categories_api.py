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
    assert duplicate.json()["detail"] == "Ya existe una categoría con ese nombre"


def test_a_name_differing_only_in_case_is_a_duplicate(api_client):
    api_client.post("/categories", json={"name": "Carnes frías"})

    assert api_client.post("/categories", json={"name": "CARNES FRÍAS"}).status_code == 409


def test_blank_category_name_is_rejected(api_client):
    assert api_client.post("/categories", json={"name": ""}).status_code == 422
    assert api_client.post("/categories", json={"name": "   "}).status_code == 422


def test_surrounding_spaces_are_not_part_of_the_name(api_client):
    assert api_client.post("/categories", json={"name": "  Botanas "}).json()["name"] == "Botanas"


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


def test_renaming_a_category_carries_its_products_along(api_client):
    category_id = api_client.post("/categories", json={"name": "Snacks"}).json()["id"]
    api_client.post(
        "/products",
        json={"name": "Papas", "category_id": category_id, "expires_at": "2026-12-01", "location": "pantry"},
    )

    renamed = api_client.put(f"/categories/{category_id}", json={"name": "Botanas"})

    assert renamed.status_code == 200
    assert renamed.json() == {**renamed.json(), "id": category_id, "name": "Botanas"}
    assert api_client.get("/products").json()[0]["category"]["name"] == "Botanas"


def test_renaming_to_another_categorys_name_is_rejected(api_client):
    api_client.post("/categories", json={"name": "Carnes"})
    other_id = api_client.post("/categories", json={"name": "Frutas"}).json()["id"]

    response = api_client.put(f"/categories/{other_id}", json={"name": "carnes"})

    assert response.status_code == 409
    assert [c["name"] for c in api_client.get("/categories").json()] == ["Carnes", "Frutas"]


def test_a_category_can_change_only_its_own_case(api_client):
    category_id = api_client.post("/categories", json={"name": "bebidas"}).json()["id"]

    assert api_client.put(f"/categories/{category_id}", json={"name": "Bebidas"}).status_code == 200


def test_renaming_a_missing_category_is_404(api_client):
    assert api_client.put("/categories/9999", json={"name": "X"}).status_code == 404


def test_a_blank_rename_is_rejected(api_client):
    category_id = api_client.post("/categories", json={"name": "Otros"}).json()["id"]

    assert api_client.put(f"/categories/{category_id}", json={"name": "  "}).status_code == 422
