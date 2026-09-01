"""Label-photo extraction endpoint tests. No DB, no network — the model call
itself is mocked; app/test_vision_client.py owns proving that call's own
behaviour."""

from datetime import date
from decimal import Decimal

from app.schemas.vision import LabelExtraction

_IMAGE = b"\x89PNG\r\n\x1a\n fake bytes, never actually decoded in these tests"


def test_returns_the_extracted_fields(client, mocker):
    mocker.patch(
        "app.routers.vision.extract_label",
        return_value=LabelExtraction(
            name="Nopal limpio", expires_at=date(2026, 9, 1), quantity=Decimal("0.59"), unit="kg"
        ),
    )

    response = client.post("/vision/label", files={"image": ("label.png", _IMAGE, "image/png")})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Nopal limpio"
    assert body["expires_at"] == "2026-09-01"
    assert body["quantity"] == "0.59"
    assert body["unit"] == "kg"


def test_a_field_the_model_could_not_read_arrives_null(client, mocker):
    mocker.patch("app.routers.vision.extract_label", return_value=LabelExtraction())

    response = client.post("/vision/label", files={"image": ("label.png", _IMAGE, "image/png")})

    assert response.status_code == 200
    assert response.json() == {"name": None, "expires_at": None, "quantity": None, "unit": None}


def test_a_total_extraction_failure_is_reported_as_service_unavailable(client, mocker):
    """None means "no usable answer at all" — see vision_client.extract_label
    — and must reach the client as a clear, distinguishable failure rather
    than a 200 full of nulls, so the UI can show its own message instead of
    silently rendering an empty form."""
    mocker.patch("app.routers.vision.extract_label", return_value=None)

    response = client.post("/vision/label", files={"image": ("label.png", _IMAGE, "image/png")})

    assert response.status_code == 503


def test_an_empty_file_is_rejected_without_calling_the_model(client, mocker):
    extract = mocker.patch("app.routers.vision.extract_label")

    response = client.post("/vision/label", files={"image": ("label.png", b"", "image/png")})

    assert response.status_code == 422
    extract.assert_not_called()


def test_an_oversized_file_is_rejected_without_calling_the_model(client, mocker):
    extract = mocker.patch("app.routers.vision.extract_label")
    oversized = b"x" * (10 * 1024 * 1024 + 1)

    response = client.post("/vision/label", files={"image": ("label.png", oversized, "image/png")})

    assert response.status_code == 413
    extract.assert_not_called()


def test_a_missing_file_is_rejected(client):
    response = client.post("/vision/label")

    assert response.status_code == 422
