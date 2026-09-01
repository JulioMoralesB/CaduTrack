"""Receipt client tests. No network — every case is a mocked httpx call.

Every scenario asserts extract_receipt degrades gracefully — None on total
failure, a bad individual line simply dropped — rather than raising or
passing through an unvalidated value. See #84: a dropped line is meant to
surface through the reconciliation check, not silently.
"""

import json

import httpx
import pytest

from app.config import settings
from app.receipt_client import extract_receipt

_REQUEST = httpx.Request("POST", "http://ollama.example:11434/api/generate")
_IMAGE = b"\xff\xd8\xff fake bytes, never actually decoded in these tests"


@pytest.fixture(autouse=True)
def ollama_configured(monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "http://ollama.example:11434")
    monkeypatch.setattr(settings, "ollama_model", "qwen3.5:4b")


def _ok_response(items: list[dict], stated_item_count: int | None = None) -> httpx.Response:
    body = {"items": items, "stated_item_count": stated_item_count}
    return httpx.Response(
        status_code=200,
        json={"model": "qwen3.5:4b", "response": json.dumps(body), "done": True},
        request=_REQUEST,
    )


def _item(name="Nopal limpio", quantity=1, is_food=True) -> dict:
    return {"name": name, "quantity": quantity, "is_food": is_food}


def test_returns_none_when_ollama_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "")

    assert extract_receipt(_IMAGE) is None


def test_extracts_every_line_from_a_well_formed_response(mocker):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=_ok_response(
            [_item("Nopal limpio", 1, True), _item("Jabón Grisi", 2, False)],
            stated_item_count=3,
        ),
    )

    result = extract_receipt(_IMAGE)

    assert [(i.name, str(i.quantity), i.is_food) for i in result.items] == [
        ("Nopal limpio", "1.00", True),
        ("Jabón Grisi", "2.00", False),
    ]
    assert result.stated_item_count == 3


def test_a_missing_stated_item_count_is_none_not_a_mismatch(mocker):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=_ok_response([_item()], stated_item_count=None),
    )

    assert extract_receipt(_IMAGE).stated_item_count is None


@pytest.mark.parametrize(
    "bad_item",
    [
        {"name": "", "quantity": 1, "is_food": True},
        {"name": "   ", "quantity": 1, "is_food": True},
        {"name": "Algo", "quantity": 0, "is_food": True},
        {"name": "Algo", "quantity": -1, "is_food": True},
        {"name": "Algo", "quantity": "two", "is_food": True},
        {"name": "Algo", "quantity": 1, "is_food": "yes"},
        {"quantity": 1, "is_food": True},
        "not even an object",
    ],
)
def test_a_malformed_line_is_dropped_not_the_whole_receipt(mocker, bad_item):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=_ok_response([_item("Nopal limpio"), bad_item]),
    )

    result = extract_receipt(_IMAGE)

    assert [i.name for i in result.items] == ["Nopal limpio"]


def test_returns_none_when_every_line_is_malformed(mocker):
    """A "receipt" extraction with nothing usable on it is not a usable
    answer — the same judgement vision_client.py makes for an all-null
    label, applied to "all items invalid" here."""
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=_ok_response([{"name": "", "quantity": 1, "is_food": True}]),
    )

    assert extract_receipt(_IMAGE) is None


def test_returns_none_when_items_is_missing_entirely(mocker):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=httpx.Response(
            status_code=200,
            json={"model": "qwen3.5:4b", "response": json.dumps({"stated_item_count": 3}), "done": True},
            request=_REQUEST,
        ),
    )

    assert extract_receipt(_IMAGE) is None


def test_a_negative_or_zero_stated_item_count_is_treated_as_absent(mocker):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=_ok_response([_item()], stated_item_count=0),
    )

    assert extract_receipt(_IMAGE).stated_item_count is None


def test_sends_think_false_stream_false_and_temperature_zero(mocker):
    post = mocker.patch("app.receipt_client.httpx.post", return_value=_ok_response([_item()]))

    extract_receipt(_IMAGE)

    _, kwargs = post.call_args
    assert kwargs["json"]["think"] is False
    assert kwargs["json"]["stream"] is False
    assert kwargs["json"]["options"] == {"temperature": 0}


def test_returns_none_on_a_connection_failure(mocker):
    mocker.patch("app.receipt_client.httpx.post", side_effect=httpx.ConnectError("refused"))

    assert extract_receipt(_IMAGE) is None


def test_returns_none_on_a_timeout(mocker):
    mocker.patch("app.receipt_client.httpx.post", side_effect=httpx.TimeoutException("slow"))

    assert extract_receipt(_IMAGE) is None


def test_returns_none_on_an_http_error_status(mocker):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=httpx.Response(status_code=500, text="boom", request=_REQUEST),
    )

    assert extract_receipt(_IMAGE) is None


def test_returns_none_when_the_response_field_is_not_json(mocker):
    mocker.patch(
        "app.receipt_client.httpx.post",
        return_value=httpx.Response(
            status_code=200,
            json={"model": "qwen3.5:4b", "response": "not json", "done": True},
            request=_REQUEST,
        ),
    )

    assert extract_receipt(_IMAGE) is None
