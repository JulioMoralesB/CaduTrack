"""Open Food Facts lookup for a real, globally-issued barcode — see #30.

Never called for a GS1 prefix-2 (restricted circulation) code — see
app/barcode_parser.py's is_restricted_circulation — since those have no
meaning outside the store that printed them and Open Food Facts, a global
database, has nothing to say about them.

Same never-raise contract as the app's Ollama clients, for the same
reason: a network failure, a timeout, or a response that doesn't parse are
all reported as None, and the caller falls back to manual entry rather
than blocking product creation on a third-party API that might be down.
"""

import logging
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5.0

_BASE_URL = "https://world.openfoodfacts.org/api/v2/product"
# Required by Open Food Facts' own API usage policy — an unidentified
# client is the first thing rate-limited during an outage.
_USER_AGENT = "CaduTrack/1.0 (+https://github.com/JulioMoralesB/CaduTrack)"


def lookup_product_name(item_code: str) -> str | None:
    """The product's own name, in Spanish where Open Food Facts has a
    Spanish name and English/generic otherwise, or None when the code
    isn't in their database or the request failed outright."""
    try:
        response = httpx.get(
            # quote(), not an f-string alone: item_code is whatever the
            # payload's own scan came in as (BarcodeScanPayload places no
            # charset restriction on it), so it can contain characters that
            # would otherwise land unescaped in the URL path.
            f"{_BASE_URL}/{quote(item_code, safe='')}.json",
            params={"fields": "product_name,product_name_es"},
            timeout=TIMEOUT_SECONDS,
            headers={"User-Agent": _USER_AGENT},
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Open Food Facts lookup failed for %r: %s", item_code, exc.__class__.__name__)
        return None

    try:
        data = response.json()
        if data.get("status") != 1:
            return None
        product = data["product"]
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Open Food Facts returned an unparsable response for %r (%s): %r",
            item_code,
            exc.__class__.__name__,
            response.text[:200],
        )
        return None

    for field in ("product_name_es", "product_name"):
        name = product.get(field)
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None
