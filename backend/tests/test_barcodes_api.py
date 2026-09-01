"""Barcode endpoint tests."""

import pytest

pytestmark = pytest.mark.integration


def test_a_restricted_prefix_code_never_calls_open_food_facts(api_client, mocker):
    off = mocker.patch("app.routers.barcodes.lookup_product_name")

    response = api_client.post("/barcodes/lookup", json={"code": "2520157108483"})

    assert response.status_code == 200
    body = response.json()
    assert body["item_code"] == "2520157108483"
    assert body["name"] is None
    off.assert_not_called()


def test_a_normal_prefix_code_calls_open_food_facts(api_client, mocker):
    off = mocker.patch("app.routers.barcodes.lookup_product_name", return_value="Coca-Cola")

    response = api_client.post("/barcodes/lookup", json={"code": "5449000000996"})

    assert response.status_code == 200
    body = response.json()
    assert body["item_code"] == "5449000000996"
    assert body["name"] == "Coca-Cola"
    off.assert_called_once_with("5449000000996")


def test_a_gs1_code_extracts_the_weight_and_still_checks_the_restricted_prefix(api_client, mocker):
    off = mocker.patch("app.routers.barcodes.lookup_product_name")
    raw = "01" + "29045580000076" + "3103" + "000586"  # GTIN starts with 2

    response = api_client.post("/barcodes/lookup", json={"code": raw})

    body = response.json()
    assert body["item_code"] == "29045580000076"
    assert body["quantity"] == "0.59"
    assert body["unit"] == "kg"
    assert body["name"] is None
    off.assert_not_called()


def test_a_remembered_code_skips_open_food_facts_and_returns_what_was_saved(api_client, mocker):
    off = mocker.patch("app.routers.barcodes.lookup_product_name", return_value="Should not be used")
    api_client.post("/barcodes/5449000000996/remember", json={"name": "Coca-Cola de dieta", "icon": "\U0001F964"})

    response = api_client.post("/barcodes/lookup", json={"code": "5449000000996"})

    body = response.json()
    assert body["name"] == "Coca-Cola de dieta"
    assert body["icon"] == "\U0001F964"
    off.assert_not_called()


def test_a_remembered_code_still_reports_a_weight_read_off_the_current_scan(api_client):
    """Remembering is about the name/icon, not the weight — a second
    purchase of the same product can weigh differently, and the barcode's
    own (310n) field is the authority on that, every time."""
    api_client.post("/barcodes/29045580000076/remember", json={"name": "Nopal limpio"})
    raw = "01" + "29045580000076" + "3103" + "000750"

    response = api_client.post("/barcodes/lookup", json={"code": raw})

    body = response.json()
    assert body["name"] == "Nopal limpio"
    assert body["quantity"] == "0.75"


def test_remembering_twice_updates_rather_than_duplicates(api_client):
    api_client.post("/barcodes/123/remember", json={"name": "Primer nombre"})
    api_client.post("/barcodes/123/remember", json={"name": "Nombre corregido"})

    response = api_client.post("/barcodes/lookup", json={"code": "123"})

    assert response.json()["name"] == "Nombre corregido"


def test_remembering_again_without_an_icon_clears_the_previous_icon(api_client):
    api_client.post("/barcodes/123/remember", json={"name": "Algo", "icon": "\U0001F34C"})
    api_client.post("/barcodes/123/remember", json={"name": "Algo"})

    response = api_client.post("/barcodes/lookup", json={"code": "123"})

    assert response.json()["icon"] is None


def test_remembering_actually_commits_not_just_the_in_session_object(api_client, db_session, mocker):
    """Same reasoning as products' own reassign-commit test: api_client and
    db_session share one SQLAlchemy session in this fixture, so only a
    fresh read after expiring the identity map proves the write reached
    the database rather than just this test's in-memory object."""
    mocker.patch("app.routers.barcodes.lookup_product_name", return_value="Should not be used")

    api_client.post("/barcodes/123/remember", json={"name": "Nombre guardado"})
    db_session.expire_all()

    assert api_client.post("/barcodes/lookup", json={"code": "123"}).json()["name"] == "Nombre guardado"
