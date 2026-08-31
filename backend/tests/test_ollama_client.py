"""Ollama client tests. No network — every case is a mocked httpx call.

Every scenario asserts resolve_icon_via_model degrades to None rather than
raising: a caller that let an exception through here would fail product
creation over a missing emoji, which is exactly what this module exists to
prevent.
"""

import json

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
    that itself matches the requested schema — not a nested JSON object.

    Built with a real json.dumps for that inner layer, not an f-string: a
    raw newline embedded via string interpolation produces literally invalid
    JSON (control characters must be escaped inside a JSON string), which a
    real, correctly-behaving Ollama would never emit — grammar-constrained
    decoding is what makes `format` reliable in the first place. An f-string
    version of this fixture failed on exactly that case, for a reason that
    was about the fixture, not app/ollama_client.py.
    """
    return httpx.Response(
        status_code=200,
        json={"model": "qwen3.5:4b", "response": json.dumps({"icon": icon}), "done": True},
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


def test_strips_a_stray_leading_colon(mocker):
    """Reproduced directly against the real server: ':🥭' for "Papaya
    deshidratada", the schema notwithstanding. .strip() alone leaves the
    colon in place — only whitespace is whitespace."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response(":🥭"))

    assert resolve_icon_via_model("Papaya deshidratada") == "🥭"


def test_strips_a_stray_trailing_curly_quote_and_newline(mocker):
    """Also reproduced directly: '🍖”\n' for the same prompt on a different
    sample — the newline .strip() catches, the curly quote it does not."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("🍖”\n"))

    assert resolve_icon_via_model("Milanesa") == "🍖"


def test_returns_none_for_an_icon_too_long_to_store(mocker):
    """The schema constrains the *shape* of the JSON, not the length of the
    string inside it — a model that answered in a full sentence would still
    satisfy {"icon": "<string>"}. Product.icon is String(16)."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("a" * 20))

    assert resolve_icon_via_model("Kombucha") is None


def test_returns_none_for_a_private_use_area_codepoint(mocker):
    """Reproduced directly against the real server: the entire answer for
    "Aceitunas kalamata" was U+F774, a Private Use Area codepoint. It passes
    every prior check — non-empty, one character, well under the length
    ceiling — and renders as a blank box in any normal font, which is worse
    than the default icon: a visible gap looks like the app is broken, not
    like a product with no icon."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response(""))

    assert resolve_icon_via_model("Aceitunas kalamata") is None


def test_returns_none_for_multiple_symbols_glued_together(mocker):
    """Reproduced directly: "🥤⚡️✨" for "Kombucha de jengibre" — three
    symbols, not one, despite the schema asking for a single emoji."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("\U0001F964⚡️✨"))

    assert resolve_icon_via_model("Kombucha de jengibre") is None


def test_accepts_a_single_emoji_with_a_variation_selector(mocker):
    """The guard above must not overreach: "🌶️" is hot pepper + VS16, two
    codepoints and one symbol — already a real entry in app/icons.py's own
    table, so rejecting it would break a legitimate case to catch a bad one."""
    mocker.patch("app.ollama_client.httpx.post", return_value=_ok_response("\U0001F336\uFE0F"))

    assert resolve_icon_via_model("Chile") == "\U0001F336\uFE0F"


def test_returns_none_for_unrelated_symbols_from_an_earlier_real_case(mocker):
    """The astrological/geometric garbage from #90's PR description
    ("☍️△" for "Mermelada de higo") — documented there as an accepted,
    unchased residual. This guard turns out to catch it anyway: two base
    symbols survive stripping the variation selector, which is exactly what
    _is_one_symbol is for. A pleasant side effect, not the reason it exists —
    the multi-symbol and private-use cases above are."""
    mocker.patch(
        "app.ollama_client.httpx.post",
        return_value=_ok_response("\u260D\uFE0F\u25B3"),
    )

    assert resolve_icon_via_model("Mermelada de higo") is None
