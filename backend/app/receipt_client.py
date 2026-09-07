"""Local Ollama calls for reading a shopping receipt photo — see #84 and #126.

Same never-raise contract as app/vision_client.py, for the same reason: an
unconfigured URL, a refused connection, a timeout, an HTTP error, or a
response that doesn't parse are all reported as None (or, for expand_names,
an empty dict), and the caller falls back to manual entry rather than
blocking on a model that might be down, slow, or mid-restart.

A separate module rather than folded into vision_client.py: the request
shape (an array of lines, not one name/date/weight triple) and the failure
semantics (a single bad line is dropped, not the whole extraction) are
different enough that sharing one function would mean branching on which
call this actually is throughout.

Two functions, not one: extract_receipt reads the photo but deliberately
never expands or corrects a name — see #126. Only expand_names, a second,
text-only call, turns an unseen raw name into something natural, and the
caller (routers/trips.py) only ever asks it about names
app.receipt_name_cache doesn't already have an answer for.
"""

import base64
import json
import logging
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# A receipt's output scales with line count in a way a single label's never
# does: extracting one {name, date, weight} costs a roughly fixed number of
# output tokens regardless of the photo, but a receipt generates one
# {name, quantity, is_food} per line. Measured directly against the real
# server, cold: a 20-item receipt took 24.4s total, a 36-item receipt took
# 33.2s — generation alone ran 9.1s and 18.6s respectively, essentially
# linear at ~49 tokens/s. 45s — sized for #83's single-item case — is
# exactly what a real receipt hit in production (nginx logged
# request_time: 45.124 against this timeout, to the millisecond). 120s
# leaves real headroom for a large trip (60-80 lines) plus a cold load,
# without leaving a genuinely unreachable Ollama able to stall for long.
# nginx's own proxy_read_timeout for /api/ has to stay above this — see
# nginx.conf — or it becomes the new, blunter cutoff instead.
TIMEOUT_SECONDS = 120.0

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "quantity": {"type": "number"},
                    "is_food": {"type": "boolean"},
                },
                "required": ["name", "quantity", "is_food"],
            },
        },
        "stated_item_count": {"type": ["integer", "null"]},
    },
    "required": ["items", "stated_item_count"],
}

# OCR only — no expansion or correction. See #126: the raw printed text is
# app.receipt_name_cache's own key, and that only stays a stable key across
# two receipts from the same store if it is genuinely the same string both
# times, rather than a fresh guess the model is free to phrase differently
# on each read. expand_names below is what turns an unseen one of these into
# a natural name, once, the first time it shows up.
_PROMPT = (
    "Analiza esta foto de un recibo o ticket de compra de supermercado.\n\n"
    "Para cada línea de producto, extrae:\n"
    "- name: el texto EXACTO tal como aparece impreso en el recibo para "
    "ese producto — sin corregir, expandir ni traducir abreviaciones. "
    "Cópialo tal cual está impreso, truncado o abreviado.\n"
    "- quantity: la cantidad comprada de ese producto (la columna de "
    "cantidad, no el precio).\n"
    "- is_food: true si es algo que se come o se bebe — esto incluye "
    "frutas, verduras y otros productos frescos sin empaque (nopal, "
    "plátano, cilantro, etc.), carnes, lácteos, botanas y bebidas. false "
    "solo si es un producto de limpieza, higiene personal, ferretería u "
    "otro artículo que claramente no se come.\n\n"
    "Ignora líneas que no sean productos (subtotales, forma de pago, "
    "dirección de la tienda, etc.).\n\n"
    "Si el recibo muestra un total de artículos comprados (por ejemplo "
    "'ARTICULOS COMPRADOS: 19'), captúralo en stated_item_count. Si no "
    "aparece, usa null."
)

_EXPAND_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "name": {"type": "string"},
                },
                "required": ["index", "name"],
            },
        },
    },
    "required": ["items"],
}

# Text-only — no image, since the raw text is already known from
# extract_receipt. Kept well under extract_receipt's own timeout: this has
# no image tokens to read and only ever runs for names receipt_name_cache
# hasn't already learned, so it is both a smaller prompt and, over time, an
# increasingly rare call rather than one made on every receipt.
EXPAND_TIMEOUT_SECONDS = 30.0


def _expand_prompt(raw_names: list[str]) -> str:
    # Numbered, matched back by index rather than by asking the model to
    # echo the raw string — tried that first and it silently broke every
    # match: against the real model (not a mock), a bullet-prefixed list
    # came back with the "-" still attached to every "raw" field, which
    # looked like every single name had failed to expand rather than an
    # obviously wrong response. An index the model only has to copy a
    # single integer for is far less for it to get wrong.
    lines = "\n".join(f"{i + 1}. {raw}" for i, raw in enumerate(raw_names))
    return (
        "Estos son nombres de productos tal como aparecen impresos, "
        "abreviados y truncados, en un recibo de supermercado mexicano:\n\n"
        f"{lines}\n\n"
        "Para cada uno, da su nombre más natural y corregido en español — "
        "por ejemplo 'CHAMP CREMINI' es 'Champiñones cremini', 'HEB "
        "MILANESA DE PULPA NEG' es 'Milanesa de pulpa negra'. Responde con "
        "un item por cada número de la lista, en el mismo orden, con "
        "'index' igual al número de esa línea (1, 2, 3…) y 'name' el "
        "nombre corregido — no repitas el texto original."
    )


@dataclass
class ReceiptItem:
    raw_name: str
    quantity: Decimal
    is_food: bool


@dataclass
class ReceiptExtraction:
    items: list[ReceiptItem]
    stated_item_count: int | None


def _parse_item(raw: object) -> ReceiptItem | None:
    """One line of the model's own response, or None if it doesn't hold
    together — dropped rather than failing the whole receipt, so one bad
    line costs one line, not the trip. #84's reconciliation check is what
    surfaces that a line went missing this way, rather than it happening
    silently."""
    if not isinstance(raw, dict):
        return None

    name = raw.get("name")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        return None

    quantity = raw.get("quantity")
    if not isinstance(quantity, (int, float)) or isinstance(quantity, bool):
        return None
    try:
        quantity = Decimal(str(quantity)).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    if quantity <= 0:
        return None

    is_food = raw.get("is_food")
    if not isinstance(is_food, bool):
        return None

    return ReceiptItem(raw_name=name, quantity=quantity, is_food=is_food)


def _parse_stated_item_count(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value > 0 else None


def extract_receipt(image_bytes: bytes) -> ReceiptExtraction | None:
    """Best-effort line items read from a receipt photo, or None on total
    failure — see the module docstring for what "total failure" means here
    versus a single dropped line."""
    if not settings.ollama_url:
        return None

    try:
        response = httpx.post(
            f"{settings.ollama_url}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": _PROMPT,
                "images": [base64.b64encode(image_bytes).decode("ascii")],
                "stream": False,
                "think": False,
                "format": _RESPONSE_SCHEMA,
                # Same reasoning as vision_client.py: the model's configured
                # defaults are tuned for varied icon picks, not consequential
                # extraction. Determinism over variety here too.
                "options": {"temperature": 0},
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Ollama receipt extraction returned %s: %r",
            exc.response.status_code,
            exc.response.text[:500],
        )
        return None
    except httpx.HTTPError as exc:
        logger.warning("Ollama receipt extraction failed: %s", exc.__class__.__name__)
        return None

    try:
        raw = json.loads(response.json()["response"])
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Ollama returned an unparsable receipt response (%s): %r",
            exc.__class__.__name__,
            response.text[:200],
        )
        return None

    raw_items = raw.get("items")
    if not isinstance(raw_items, list):
        return None

    items = [parsed for entry in raw_items if (parsed := _parse_item(entry)) is not None]
    if not items:
        # Every line failed to parse, or the model found none — a "receipt"
        # extraction with nothing on it is not a usable answer, the same
        # judgement vision_client.py makes for an all-null label.
        logger.warning("Ollama receipt extraction returned no usable line items")
        return None

    return ReceiptExtraction(
        items=items,
        stated_item_count=_parse_stated_item_count(raw.get("stated_item_count")),
    )


def expand_names(raw_names: list[str]) -> dict[str, str]:
    """A natural Spanish name for each of `raw_names`, keyed by the exact
    string passed in — best-effort, never raising.

    Text-only, unlike extract_receipt: the raw text is already known, so
    this never re-sends the photo. Call it only with names
    app.receipt_name_cache doesn't already have an answer for — that is
    what keeps a repeat purchase to one model call, not two.

    A name the model dropped, or any failure at all (unconfigured, network,
    unparsable), is simply absent from the result — not an exception and
    not a null placeholder. The caller falls back to the raw text itself
    rather than letting a naming nicety block a trip that already has
    usable items and quantities, the same judgement extract_receipt makes
    for a single bad line.
    """
    if not raw_names or not settings.ollama_url:
        return {}

    try:
        response = httpx.post(
            f"{settings.ollama_url}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": _expand_prompt(raw_names),
                "stream": False,
                "think": False,
                "format": _EXPAND_RESPONSE_SCHEMA,
                "options": {"temperature": 0},
            },
            timeout=EXPAND_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Ollama name expansion returned %s: %r",
            exc.response.status_code,
            exc.response.text[:500],
        )
        return {}
    except httpx.HTTPError as exc:
        logger.warning("Ollama name expansion failed: %s", exc.__class__.__name__)
        return {}

    try:
        raw = json.loads(response.json()["response"])
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Ollama returned an unparsable name-expansion response (%s): %r",
            exc.__class__.__name__,
            response.text[:200],
        )
        return {}

    raw_items = raw.get("items")
    if not isinstance(raw_items, list):
        return {}

    expanded: dict[str, str] = {}
    for entry in raw_items:
        if not isinstance(entry, dict):
            continue
        index = entry.get("index")
        name = entry.get("name")
        name = name.strip() if isinstance(name, str) else ""
        # 1-based, matching _expand_prompt's own numbering; bool is an int
        # subclass in Python, so it is excluded explicitly the same way
        # _parse_item excludes it from quantity.
        if isinstance(index, int) and not isinstance(index, bool) and name and 1 <= index <= len(raw_names):
            expanded[raw_names[index - 1]] = name
    return expanded
