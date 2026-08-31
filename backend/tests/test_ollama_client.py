"""Ollama client tests. No network — every case is a mocked httpx call.

Every scenario asserts resolve_icon_via_model degrades to None rather than
raising: a caller that let an exception through here would fail product
creation over a missing emoji, which is exactly what this module exists to
prevent.
"""

import httpx
import pytest

from app.config import settings
from app.ollama_client import resolve_icon_via_model

_REQUEST = httpx.Request("POST", "http://ollama.example:11434/api/generate")


@pytest.fixture(autouse=True)
def ollama_configured(monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "http://ollama.example:11434")
    monkeypatch.setattr(settings, "ollama_model", "qwen3.5:4b")


def _ok_response(icon: str) -> httpx.Response:
    """What Ollama sends back: `response` is a *string* holding JSON text
    that itself matches the requested schema — not a nested JSON object."""
    return httpx.Response(
        status_code=200,
        json={"model": "qwen3.5:4b", "response": f'{{"icon": "{icon}"}}', "done": True},
        request=_REQUEST,
    )


def test_returns_none_when_ollama_is_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ollama_url", "")

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_the_emoji_on_a_well_formed_response(mocker):
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("\U0001F944"))

    assert resolve_icon_via_model("Kombucha") == "\U0001F944"


def test_sends_think_false_and_the_configured_model(mocker):
    """The one setting that has already cost two other clients on this server
    a debugging session — see the module docstring."""
    post = mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("\U0001F944"))

    resolve_icon_via_model("Kombucha")

    _, kwargs = post.call_args
    assert kwargs["json"]["think"] is False
    assert kwargs["json"]["stream"] is False
    assert kwargs["json"]["model"] == "qwen3.5:4b"


def test_returns_none_on_a_connection_failure(mocker):
    mocker.patch("app.ollama_client.httpx.post", side_effect=httpx.ConnectError("refused"))

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_on_a_timeout(mocker):
    mocker.patch("app.ollama_client.httpx.post", side_effect=httpx.TimeoutException("slow"))

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_on_a_5xx_from_ollama(mocker):
    mocker.patch(
        "app.ollama_client.httpx.post",
        return_value=httpx.Response(status_code=503, text="model is loading", request=_REQUEST),
    )

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_when_the_response_field_is_not_json(mocker):
    """The model ignored the schema and returned plain text instead."""
    mocker.patch(
        "app.ollama_client.httpx.post",
        return_value=httpx.Response(
            status_code=200,
            json={"response": "¡Claro! Aquí tienes un emoji: 🥤"},
            request=_REQUEST,
        ),
    )

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_when_the_icon_key_is_missing(mocker):
    mocker.patch(
        "app.ollama_client.httpx.post",
        return_value=httpx.Response(status_code=200, json={"response": "{}"}, request=_REQUEST),
    )

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_for_an_empty_icon(mocker):
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response(""))

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_for_an_icon_too_long_to_store(mocker):
    """The schema constrains the *shape* of the JSON, not the length of the
    string inside it — a model that answered in a full sentence would still
    satisfy {"icon": "<string>"}. Product.icon is String(16)."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("a" * 20))

    assert resolve_icon_via_model("Kombucha") is None
