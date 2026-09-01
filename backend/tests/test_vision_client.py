"""Vision client tests. No network — every case is a mocked httpx call.

Every scenario asserts extract_label degrades to None (or a
LabelExtraction with the offending field null) rather than raising or
passing through an unvalidated value: a caller that let a bad date through
here would save it as a fact about a real product, which is exactly what
#83's own description calls "worse than failing".
"""

import json
import logging

import httpx
import pytest

from app.config import settings
from app.vision_client import extract_label

_REQUEST = httpx.Request("POST", "http://ollama.example:11434/api/generate")
_IMAGE = b"\x89PNG\r\n\x1a\n fake bytes, never actually decoded in these tests"


@pytest.fixture(autouse=True)
def ollama_configured(monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "http://ollama.example:11434")
    monkeypatch.setattr(settings, "ollama_model", "qwen3.5:4b")


def _ok_response(**fields) -> httpx.Response:
    body = {"name": None, "expires_at": None, "weight_kg": None}
    body.update(fields)
    return httpx.Response(
        status_code=200,
        json={"model": "qwen3.5:4b", "response": json.dumps(body), "done": True},
        request=_REQUEST,
    )


def test_returns_none_when_ollama_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "")

    assert extract_label(_IMAGE) is None


def test_extracts_every_field_from_a_well_formed_response(mocker):
    mocker.patch(
        "app.vision_client.httpx.post",
        return_value=_ok_response(name="Nopal limpio", expires_at="2026-09-01", weight_kg=0.586),
    )

    result = extract_label(_IMAGE)

    assert result.name == "Nopal limpio"
    assert str(result.expires_at) == "2026-09-01"
    assert str(result.quantity) == "0.59"  # quantized to match NUMERIC(10, 2)
    assert result.unit == "kg"


def test_a_field_the_model_could_not_determine_arrives_null(mocker):
    mocker.patch("app.vision_client.httpx.post", return_value=_ok_response(name="Leche"))

    result = extract_label(_IMAGE)

    assert result.name == "Leche"
    assert result.expires_at is None
    assert result.quantity is None
    assert result.unit is None


def test_sends_think_false_stream_false_and_temperature_zero(mocker):
    """temperature 0 is not cosmetic here — see the module docstring: the
    model's configured default (tuned for varied icon picks) reproducibly
    returned a wrong date on the same label this test's siblings use as a
    reference, and temperature 0 did not, across repeated real calls."""
    post = mocker.patch("app.vision_client.httpx.post", return_value=_ok_response())

    extract_label(_IMAGE)

    _, kwargs = post.call_args
    assert kwargs["json"]["think"] is False
    assert kwargs["json"]["stream"] is False
    assert kwargs["json"]["model"] == "qwen3.5:4b"
    assert kwargs["json"]["options"] == {"temperature": 0}


def test_sends_the_image_base64_encoded(mocker):
    import base64

    post = mocker.patch("app.vision_client.httpx.post", return_value=_ok_response())

    extract_label(_IMAGE)

    _, kwargs = post.call_args
    assert kwargs["json"]["images"] == [base64.b64encode(_IMAGE).decode("ascii")]


@pytest.mark.parametrize(
    "bad_date",
    ["31/08/26", "2026-13-40", "not a date", "", 20260901],
)
def test_an_unparsable_date_arrives_null_rather_than_a_guess(mocker, bad_date):
    mocker.patch("app.vision_client.httpx.post", return_value=_ok_response(expires_at=bad_date))

    assert extract_label(_IMAGE).expires_at is None


def test_a_zero_or_negative_weight_arrives_null(mocker):
    mocker.patch("app.vision_client.httpx.post", return_value=_ok_response(weight_kg=0))

    result = extract_label(_IMAGE)
    assert result.quantity is None
    assert result.unit is None


def test_an_empty_name_arrives_null_rather_than_an_empty_string(mocker):
    mocker.patch("app.vision_client.httpx.post", return_value=_ok_response(name="   "))

    assert extract_label(_IMAGE).name is None


def test_returns_none_on_a_connection_failure(mocker):
    mocker.patch("app.vision_client.httpx.post", side_effect=httpx.ConnectError("refused"))

    assert extract_label(_IMAGE) is None


def test_returns_none_on_a_timeout(mocker):
    mocker.patch("app.vision_client.httpx.post", side_effect=httpx.TimeoutException("slow"))

    assert extract_label(_IMAGE) is None


def test_returns_none_on_an_http_error_status(mocker):
    mocker.patch(
        "app.vision_client.httpx.post",
        return_value=httpx.Response(status_code=500, text="boom", request=_REQUEST),
    )

    assert extract_label(_IMAGE) is None


def test_an_http_error_status_logs_the_status_and_ollamas_own_explanation(mocker, caplog):
    """Previously logged only the exception's class name — "HTTPStatusError"
    — with the actual status and Ollama's own error body thrown away, which
    is exactly the detail needed to tell "Ollama rejected this outright"
    apart from "Ollama crashed processing it" without shelling into the
    server to read its own logs. See #83's live bug report."""
    mocker.patch(
        "app.vision_client.httpx.post",
        return_value=httpx.Response(status_code=500, text="model crashed decoding image", request=_REQUEST),
    )

    with caplog.at_level(logging.WARNING, logger="app.vision_client"):
        extract_label(_IMAGE)

    assert "500" in caplog.records[0].getMessage()
    assert "model crashed decoding image" in caplog.records[0].getMessage()


def test_returns_none_when_the_response_field_is_not_json(mocker):
    mocker.patch(
        "app.vision_client.httpx.post",
        return_value=httpx.Response(
            status_code=200,
            json={"model": "qwen3.5:4b", "response": "not json", "done": True},
            request=_REQUEST,
        ),
    )

    assert extract_label(_IMAGE) is None
