"""A local Ollama call for the icon-assignment fallback.

Only reached after app.icons's table and app.icon_cache both miss. Never
raises: an unconfigured URL, a refused connection, a timeout, an HTTP error,
or a response that doesn't parse are all reported as None, and the caller
falls back to the default icon. A missing icon is cosmetic; blocking product
creation on a model that might be down, slow, or mid-restart is not an
acceptable trade for avoiding it.

"think": false is not optional — without it the answer lands in a separate
reasoning field and `response` arrives empty, which has already cost two
other clients on this server a debugging session each.
"""

import json
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# A short text completion on an already-loaded model, not the multi-second
# image encode #83/#84 measured — but generous enough that a momentarily busy
# GPU doesn't manufacture a spurious miss. Long enough to be worth it, short
# enough that a genuinely unreachable Ollama does not stall product creation.
TIMEOUT_SECONDS = 8.0

# Structured output, not "please reply with just the emoji": a free-text
# prompt reliably came back wrapped in markdown fences or a sentence during
# #83/#84's testing. Forcing the schema is what made that reliable there.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {"icon": {"type": "string"}},
    "required": ["icon"],
}

_PROMPT_TEMPLATE = (
    "Da un solo emoji que represente mejor este producto de supermercado. "
    'Responde solo el emoji, sin texto adicional.\n\nProducto: "{name}"'
)


def resolve_icon_via_model(name: str) -> str | None:
    """An emoji for `name` from the local model, or None on any failure."""
    if not settings.ollama_url:
        return None

    try:
        response = httpx.post(
            f"{settings.ollama_url}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": _PROMPT_TEMPLATE.format(name=name),
                "stream": False,
                "think": False,
                "format": _RESPONSE_SCHEMA,
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning(
            "Ollama icon lookup failed for %r: %s", name, exc.__class__.__name__
        )
        return None

    try:
        raw = response.json()["response"]
        icon = json.loads(raw)["icon"].strip()
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Ollama returned an unparsable icon response for %r (%s): %r",
            name,
            exc.__class__.__name__,
            response.text[:200],
        )
        return None

    # Product.icon is String(16): a model that ignored the "one emoji"
    # instruction and returned a sentence is a malformed answer, not a
    # creative one, and must not reach the database as a truncated string.
    if not icon or len(icon) > 16:
        logger.warning("Ollama returned an unusable icon for %r: %r", name, icon)
        return None

    return icon
