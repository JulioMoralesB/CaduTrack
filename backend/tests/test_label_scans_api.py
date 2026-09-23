"""Label photo queue tests — see #134.

The model itself is mocked (extract_label); the queue, the background
processing, and the database are all real. TestClient runs a response's
background tasks before returning it, so by the time a POST returns here,
the photo it queued has already been read.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app import label_queue
from app.schemas.vision import LabelExtraction

pytestmark = pytest.mark.integration


def _extraction(**overrides) -> LabelExtraction:
    fields = {
        "name": "Yogur natural",
        "expires_at": date.today() + timedelta(days=10),
        "quantity": Decimal("0.90"),
        "unit": "kg",
    }
    fields.update(overrides)
    return LabelExtraction(**fields)


def _queue(api_client, content: bytes = b"photo", content_type: str = "image/jpeg"):
    return api_client.post("/label-scans", files={"image": ("label.jpg", content, content_type)})


def _current(api_client) -> list[dict]:
    response = api_client.get("/label-scans/current")
    assert response.status_code == 200
    return response.json()


def _create_product(api_client) -> int:
    response = api_client.post(
        "/products",
        json={
            "name": "Yogur natural",
            "quantity": "1",
            "unit": None,
            "expires_at": str(date.today() + timedelta(days=10)),
            "location": "fridge",
            "notes": None,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_queuing_returns_before_the_read_and_the_read_lands_in_the_background(api_client, mocker):
    mocker.patch("app.label_queue.extract_label", return_value=_extraction())

    response = _queue(api_client)

    assert response.status_code == 201
    assert response.json()["status"] == "pending"
    [scan] = _current(api_client)
    assert scan["status"] == "read"
    assert scan["name"] == "Yogur natural"
    assert scan["expires_at"] == str(date.today() + timedelta(days=10))
    assert (scan["quantity"], scan["unit"]) == ("0.90", "kg")


def test_photos_are_read_in_the_order_they_were_queued(api_client, mocker):
    extract = mocker.patch(
        "app.label_queue.extract_label",
        side_effect=lambda image: _extraction(name=image.decode()),
    )

    for content in (b"primero", b"segundo", b"tercero"):
        _queue(api_client, content)

    assert [call.args[0] for call in extract.call_args_list] == [b"primero", b"segundo", b"tercero"]
    assert [scan["name"] for scan in _current(api_client)] == ["primero", "segundo", "tercero"]


def test_a_read_the_model_found_nothing_in_is_still_read_not_failed(api_client, mocker):
    """Same distinction extract_label itself draws: the model answered, it
    just wasn't confident about any field."""
    mocker.patch(
        "app.label_queue.extract_label",
        return_value=LabelExtraction(name=None, expires_at=None, quantity=None, unit=None),
    )

    _queue(api_client)

    [scan] = _current(api_client)
    assert scan["status"] == "read"
    assert scan["name"] is None


def test_a_failed_read_can_be_retried(api_client, mocker):
    mocker.patch("app.label_queue.extract_label", return_value=None)
    scan_id = _queue(api_client).json()["id"]
    assert _current(api_client)[0]["status"] == "failed"

    mocker.patch("app.label_queue.extract_label", return_value=_extraction())
    response = api_client.post(f"/label-scans/{scan_id}/retry")

    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    [scan] = _current(api_client)
    assert (scan["status"], scan["name"]) == ("read", "Yogur natural")


def test_only_a_failed_read_can_be_retried(api_client, mocker):
    mocker.patch("app.label_queue.extract_label", return_value=_extraction())
    scan_id = _queue(api_client).json()["id"]

    assert api_client.post(f"/label-scans/{scan_id}/retry").status_code == 409


def test_a_photo_that_breaks_the_reader_is_failed_without_blocking_the_rest(api_client, mocker):
    """The oldest pending photo always goes first — one left pending after
    an exception would be picked first again, forever."""

    def extract(image: bytes) -> LabelExtraction:
        if image == b"rota":
            raise ValueError("boom")
        return _extraction(name=image.decode())

    mocker.patch("app.label_queue.extract_label", side_effect=extract)

    _queue(api_client, b"rota")
    _queue(api_client, b"buena")

    assert [(scan["status"], scan["name"]) for scan in _current(api_client)] == [
        ("failed", None),
        ("read", "buena"),
    ]


def test_a_second_call_while_one_is_running_returns_without_reading(api_client, mocker):
    extract = mocker.patch("app.label_queue.extract_label", return_value=_extraction())
    mocker.patch("app.routers.label_scans.process_pending")
    _queue(api_client)

    assert label_queue._lock.acquire(blocking=False)
    try:
        label_queue.process_pending()
    finally:
        label_queue._lock.release()

    extract.assert_not_called()
    assert _current(api_client)[0]["status"] == "pending"

    label_queue.process_pending()

    assert _current(api_client)[0]["status"] == "read"


def test_resolving_links_the_product_and_takes_the_photo_off_the_list(api_client, mocker):
    mocker.patch("app.label_queue.extract_label", return_value=_extraction())
    scan_id = _queue(api_client).json()["id"]
    product_id = _create_product(api_client)

    response = api_client.post(f"/label-scans/{scan_id}/resolve", json={"product_id": product_id})

    assert response.status_code == 200
    assert response.json()["product_id"] == product_id
    assert response.json()["resolved_at"] is not None
    assert _current(api_client) == []
    # The photo is only kept while the scan is on the checklist.
    assert api_client.get(f"/label-scans/{scan_id}/image").status_code == 404


def test_resolving_into_a_product_that_does_not_exist_is_rejected(api_client, mocker):
    mocker.patch("app.label_queue.extract_label", return_value=_extraction())
    scan_id = _queue(api_client).json()["id"]

    response = api_client.post(f"/label-scans/{scan_id}/resolve", json={"product_id": 9999})

    assert response.status_code == 422
    assert len(_current(api_client)) == 1


def test_a_resolved_scan_cannot_be_resolved_or_dropped_again(api_client, mocker):
    mocker.patch("app.label_queue.extract_label", return_value=_extraction())
    scan_id = _queue(api_client).json()["id"]
    product_id = _create_product(api_client)
    api_client.post(f"/label-scans/{scan_id}/resolve", json={"product_id": product_id})

    assert api_client.post(f"/label-scans/{scan_id}/resolve", json={"product_id": product_id}).status_code == 409
    assert api_client.post(f"/label-scans/{scan_id}/drop").status_code == 409


def test_a_photo_can_be_dropped_even_before_it_is_read(api_client, mocker):
    mocker.patch("app.routers.label_scans.process_pending")
    scan_id = _queue(api_client).json()["id"]

    response = api_client.post(f"/label-scans/{scan_id}/drop")

    assert response.status_code == 200
    assert response.json()["product_id"] is None
    assert _current(api_client) == []


def test_the_photo_is_served_back_for_the_thumbnail(api_client, mocker):
    mocker.patch("app.routers.label_scans.process_pending")
    scan_id = _queue(api_client, b"\xff\xd8jpeg bytes", "image/jpeg").json()["id"]

    response = api_client.get(f"/label-scans/{scan_id}/image")

    assert response.status_code == 200
    assert response.content == b"\xff\xd8jpeg bytes"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_a_type_a_browser_would_not_treat_as_a_plain_image_is_never_served_as_one(api_client, mocker):
    """An SVG can carry script — it's stored and read like any other photo,
    just never served back under its own type."""
    mocker.patch("app.routers.label_scans.process_pending")
    scan_id = _queue(api_client, b"<svg></svg>", "image/svg+xml").json()["id"]

    response = api_client.get(f"/label-scans/{scan_id}/image")

    assert response.headers["content-type"] == "application/octet-stream"


def test_an_empty_photo_is_rejected(api_client):
    assert _queue(api_client, b"").status_code == 422
    assert _current(api_client) == []


def test_unknown_scans_are_404(api_client):
    assert api_client.post("/label-scans/9999/drop").status_code == 404
    assert api_client.post("/label-scans/9999/retry").status_code == 404
    assert api_client.get("/label-scans/9999/image").status_code == 404
