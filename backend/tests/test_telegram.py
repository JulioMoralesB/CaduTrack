"""Telegram delivery: a failed send must never carry the bot token — see #170.

The Bot API puts the token in the request path, and httpx puts the request
URL in the message of the exceptions it raises. #64 kept httpx's own request
log lines out of the logs; these cover the other way the same URL got there,
through the traceback of a failed send.
"""

import io
import logging
from unittest.mock import patch

import httpx
import pytest

from app.config import settings
from app.logging_config import _JsonFormatter
from app.telegram import TelegramDeliveryError, send_message

# Built by concatenation, and never pasted as a literal — see CLAUDE.md. It
# only has to carry the shape of a bot token for these tests to mean anything.
TOKEN_SHAPED_VALUE = "1234567890:" + "A" * 35


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", TOKEN_SHAPED_VALUE)
    monkeypatch.setattr(settings, "telegram_chat_id", "42")


def _request() -> httpx.Request:
    return httpx.Request("POST", f"https://api.telegram.org/bot{TOKEN_SHAPED_VALUE}/sendMessage")


def _logged_failure(**post) -> str:
    """Everything the JSON logs would hold for a send that fails this way,
    logged the way the daily job logs it — traceback included."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_JsonFormatter(fmt="%(message)s"))
    logger = logging.getLogger("tests.telegram")
    logger.addHandler(handler)
    logger.propagate = False
    try:
        with patch("app.telegram.httpx.post", **post):
            try:
                send_message("hola")
            except Exception:
                logger.exception("Daily expiry alert failed")
            else:
                pytest.fail("send_message did not raise")
    finally:
        logger.removeHandler(handler)
    return stream.getvalue()


def test_a_rejected_send_does_not_log_the_token(configured):
    rejected = httpx.Response(
        400, request=_request(), json={"ok": False, "description": "Bad Request: chat not found"}
    )

    logged = _logged_failure(return_value=rejected)

    assert TOKEN_SHAPED_VALUE not in logged
    # Still says what went wrong — the point is to drop the URL, not the reason.
    assert "chat not found" in logged


def test_a_send_that_never_connects_does_not_log_the_token(configured):
    # The URL in the message is the worst case, not what httpx usually writes
    # for a connection failure: whatever it says must not reach the logs.
    unreachable = httpx.ConnectError(f"All connection attempts failed for {_request().url}", request=_request())

    logged = _logged_failure(side_effect=unreachable)

    assert TOKEN_SHAPED_VALUE not in logged
    assert "ConnectError" in logged


def test_a_rejection_without_a_json_body_is_still_reported(configured):
    """A proxy's own error page, say — it must fail the same readable way,
    not with a JSON decoding error from trying to read a description."""
    gateway_error = httpx.Response(502, request=_request(), text="<html>Bad Gateway</html>")

    with patch("app.telegram.httpx.post", return_value=gateway_error):
        with pytest.raises(TelegramDeliveryError, match="HTTP 502"):
            send_message("hola")


def test_the_failure_is_not_chained_to_the_http_client_error(configured):
    """The mechanism, asserted directly: the httpx exception — the one whose
    message holds the URL — is not kept as the cause or the context, so no
    traceback formatter can print it."""
    with patch("app.telegram.httpx.post", side_effect=httpx.ReadTimeout("timed out", request=_request())):
        with pytest.raises(TelegramDeliveryError) as caught:
            send_message("hola")

    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__ is True
