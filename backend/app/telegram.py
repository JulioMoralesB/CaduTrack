"""Telegram delivery.

Only knows how to send a message. What to say and when to say it lives in
app/alerts.py, so the formatting can be tested without a network call.
"""

import html
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
TIMEOUT_SECONDS = 10


class TelegramNotConfigured(RuntimeError):
    """Raised when a send is attempted without a token and chat id."""


class TelegramDeliveryError(RuntimeError):
    """Raised when a send fails — Telegram rejected it, or never answered.

    Our own exception rather than httpx's, and never chained to it: the Bot
    API carries the token in the request path, and httpx puts the request URL
    in the message of what it raises. Letting that exception out put the
    token in the traceback of whatever logged the failure — see #170, the
    same leak as #64 by another road.

    status_code is None when Telegram never answered at all; reason is its
    own explanation of a rejection, when it gave one.
    """

    def __init__(self, message: str, *, status_code: int | None = None, reason: str = "") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason


def is_configured() -> bool:
    """True when both the token and the chat id are set."""
    return bool(settings.telegram_bot_token and settings.telegram_chat_id)


def escape(text: str) -> str:
    """Escape text for Telegram's HTML parse mode.

    Product names are user input: an apostrophe or an ampersand in one would
    otherwise make Telegram reject the whole message.
    """
    return html.escape(text, quote=False)


def _rejection_reason(response: httpx.Response) -> str:
    """Telegram's own explanation, or nothing when the body isn't its JSON —
    a proxy's error page, say."""
    try:
        return str(response.json().get("description", ""))
    except (ValueError, AttributeError):
        return ""


def send_message(text: str) -> None:
    """Send a message to the configured chat.

    Raises rather than returning a flag: a caller that ignores the result would
    report a delivered alert that never arrived.
    """
    if not is_configured():
        raise TelegramNotConfigured(
            "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set to send alerts"
        )

    try:
        response = httpx.post(
            f"{API_BASE}/bot{settings.telegram_bot_token}/sendMessage",
            json={
                "chat_id": settings.telegram_chat_id,
                "text": text,
                "parse_mode": "HTML",
                "disable_web_page_preview": True,
            },
            timeout=TIMEOUT_SECONDS,
        )
    except (httpx.HTTPError, httpx.InvalidURL) as exc:
        # Only the kind of failure, never its message, and `from None` so the
        # original isn't printed under ours — see TelegramDeliveryError.
        raise TelegramDeliveryError(f"Could not reach Telegram: {type(exc).__name__}") from None

    if response.status_code != httpx.codes.OK:
        # Never response.raise_for_status(): its message is the request URL.
        reason = _rejection_reason(response)
        raise TelegramDeliveryError(
            f"Telegram rejected the message: HTTP {response.status_code} {reason}".rstrip(),
            status_code=response.status_code,
            reason=reason,
        )

    logger.info("Expiry alert delivered to Telegram")
