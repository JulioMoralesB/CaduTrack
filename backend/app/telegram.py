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


def is_configured() -> bool:
    """True when both the token and the chat id are set."""
    return bool(settings.telegram_bot_token and settings.telegram_chat_id)


def escape(text: str) -> str:
    """Escape text for Telegram's HTML parse mode.

    Product names are user input: an apostrophe or an ampersand in one would
    otherwise make Telegram reject the whole message.
    """
    return html.escape(text, quote=False)


def send_message(text: str) -> None:
    """Send a message to the configured chat.

    Raises rather than returning a flag: a caller that ignores the result would
    report a delivered alert that never arrived.
    """
    if not is_configured():
        raise TelegramNotConfigured(
            "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set to send alerts"
        )

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
    # The token is in the URL, so never log the request itself.
    if response.status_code != httpx.codes.OK:
        logger.error(
            "Telegram rejected the message: HTTP %s %s",
            response.status_code,
            response.json().get("description", "") if response.text else "",
        )
        response.raise_for_status()

    logger.info("Expiry alert delivered to Telegram")
