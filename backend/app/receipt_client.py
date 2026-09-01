"""A local Ollama call for reading a shopping receipt photo — see #84.

Same never-raise contract as app/vision_client.py, for the same reason: an
unconfigured URL, a refused connection, a timeout, an HTTP error, or a
response that doesn't parse are all reported as None, and the caller falls
back to manual entry rather than blocking on a model that might be down,
slow, or mid-restart.

A separate module rather than folded into vision_client.py: the request
shape (an array of lines, not one name/date/weight triple) and the failure
semantics (a single bad line is dropped, not the whole extraction) are
different enough that sharing one function would mean branching on which
call this actually is throughout.
"""

import base64
import json
import logging
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Same reasoning as vision_client.py's own budget: a downscaled real-photo
# request measured in the tens of seconds, not the sub-2s a tiny synthetic
# image suggested early on. A receipt has more lines to read than a single
# label, so it gets the same generous number rather than a tighter one.
TIMEOUT_SECONDS = 45.0

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

_PROMPT = (
    "Analiza esta foto de un recibo o ticket de compra de supermercado.\n\n"
    "Para cada línea de producto, extrae:\n"
    "- name: el nombre del producto, expandido y corregido a partir del "
    "texto impreso (los recibos abrevian y truncan nombres — por ejemplo "
    "'CHAMP CREMINI' es 'Champiñones cremini', 'HEB MILANESA DE PULPA NEG' "
    "es 'Milanesa de pulpa negra'). Usa el nombre más natural en español.\n"
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


@dataclass
class ReceiptItem:
    name: str
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

    return ReceiptItem(name=name, quantity=quantity, is_food=is_food)


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
