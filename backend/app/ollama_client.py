"""A local Ollama call for the icon-assignment fallback.

Only reached after app.icons's table and app.icon_cache both miss. Never
raises: an unconfigured URL, a refused connection, a timeout, an HTTP error, a
response that doesn't parse, or an answer that is not actually usable as one
icon are all reported as None, and the caller falls back to the default icon.
A missing icon is cosmetic; blocking product creation on a model that might be
down, slow, or mid-restart is not an acceptable trade for avoiding it.

"think": false is not optional — without it the answer lands in a separate
reasoning field and `response` arrives empty, which has already cost two
other clients on this server a debugging session each.
"""

import json
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Measured directly against the real server, not guessed: a warm qwen3.5:4b
# answers this prompt in ~0.7-1.0s, but the model is shared with Karakeep and
# gets evicted after a few idle minutes — a cold reload alone took 6.7s in
# one measurement, 7.5s total for the same call that took under a second
# warm. 8s left under 500ms of margin over that single sample; 15s gives the
# reload real room without leaving a genuinely unreachable Ollama able to
# stall product creation for long.
TIMEOUT_SECONDS = 15.0

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

# Straight and curly quote marks, colons and backticks — the characters
# actually observed stuck to an otherwise-correct emoji in real responses.
_STRAY_CHARS = "\"'‘’“”`:"

# Codepoints that combine with a preceding pictograph rather than standing on
# their own — stripped before counting "how many symbols is this", so a
# legitimate "🌶️" (hot pepper + VS16) still counts as one.
_COMBINING_MODIFIERS = frozenset(
    [0x200D]  # ZERO WIDTH JOINER
    + [0xFE0E, 0xFE0F]  # variation selectors (text vs. emoji presentation)
    + list(range(0x1F3FB, 0x1F400))  # Fitzpatrick skin-tone modifiers
)

# Reserved by the Unicode standard for application-private glyphs — an icon
# font's own mapping, never a real emoji. A model answering from this range
# renders as a blank box in any normal font; observed directly, once, as the
# entire response for "Aceitunas kalamata".
_PRIVATE_USE_RANGES = ((0xE000, 0xF8FF), (0xF0000, 0xFFFFD), (0x100000, 0x10FFFD))


def _in_private_use_area(icon: str) -> bool:
    return any(low <= ord(ch) <= high for ch in icon for low, high in _PRIVATE_USE_RANGES)


def _is_one_symbol(icon: str) -> bool:
    """True when `icon` is a single pictograph, modifiers aside.

    Not full emoji validation — that needs a Unicode emoji-data table this
    project has deliberately chosen not to hand-maintain (see #90's PR
    description). This is narrower and cheaper: reject only what is provably
    *more than one thing* glued together, which is exactly the shape multiple
    real responses have taken — e.g. "🥤⚡️✨" for "Kombucha de jengibre",
    three symbols where the schema asked for one. Nothing in this project's
    domain (food and household product icons) legitimately needs a multi-base
    ZWJ sequence, so any base codepoint beyond the first is treated as
    evidence of exactly that failure, not a creative compound emoji.
    """
    base_codepoints = [ord(ch) for ch in icon if ord(ch) not in _COMBINING_MODIFIERS]
    return len(base_codepoints) == 1


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
        icon = json.loads(raw)["icon"]
        # Observed directly against the real server, not a defensive guess:
        # roughly one answer in eight arrived with a stray colon or curly
        # quote stuck to the emoji despite the schema — e.g. ':🥭' and
        # '🍖"\n'. .strip() alone only removes whitespace, so a first pass
        # strips it, then the punctuation, then whitespace again in case
        # that exposed more of it (e.g. "🍖 ” ").
        icon = icon.strip().strip(_STRAY_CHARS).strip()
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

    if _in_private_use_area(icon):
        logger.warning("Ollama returned a private-use codepoint for %r: %r", name, icon)
        return None

    if not _is_one_symbol(icon):
        logger.warning("Ollama returned more than one symbol for %r: %r", name, icon)
        return None

    return icon
