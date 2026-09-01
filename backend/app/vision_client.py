"""A local Ollama call for reading a product label photo — see #83.

Same never-raise contract as app/ollama_client.py, for the same reason: an
unconfigured URL, a refused connection, a timeout, an HTTP error, or a
response that doesn't parse are all reported as None, and the caller falls
back to manual entry rather than blocking product creation on a model that
might be down, slow, or mid-restart.

A wrong date is a worse failure than no date — see #83's own description —
so this is deliberately more cautious than the icon client in two ways: the
model is asked for null on anything it isn't sure of instead of its best
guess, and every field is still independently validated after parsing before
being trusted, null or not.
"""

import base64
import json
import logging
from datetime import date
from decimal import Decimal, InvalidOperation

import httpx

from app.config import settings
from app.schemas.vision import LabelExtraction

logger = logging.getLogger(__name__)

# Measured directly against the real server: a warm qwen3.5:4b answers a
# ~700x500 test label in 1.5-2s. A real phone photo is larger and a cold
# model load has measured at 6.7s for the (much cheaper) icon prompt alone —
# 30s leaves real room for both without leaving a genuinely unreachable
# Ollama able to stall product creation for long.
TIMEOUT_SECONDS = 30.0

# Grammar-constrained decoding, same as the icon client — a free-text prompt
# is not reliable enough to parse for a field this consequential.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": ["string", "null"]},
        "expires_at": {"type": ["string", "null"]},
        "weight_kg": {"type": ["number", "null"]},
    },
    "required": ["name", "expires_at", "weight_kg"],
}

_PROMPT = (
    "Analiza esta foto de la etiqueta de un producto de supermercado.\n\n"
    "Extrae:\n"
    "- name: el nombre del producto, tal como aparece impreso (corrígelo si "
    "está truncado o abreviado, usando el nombre más natural).\n"
    "- expires_at: la fecha en la que el producto deja de ser seguro o "
    "recomendable consumir, en formato YYYY-MM-DD. Busca las palabras "
    "'Fecha de Caducidad' o 'Consumo preferente'. IGNORA cualquier fecha "
    "etiquetada como 'Fecha de Empacado', 'Fecha de Preparación' o 'Fecha "
    "de Elaboración' — esas son cuándo se preparó el producto, no cuándo "
    "caduca.\n"
    "- weight_kg: el peso neto en kilogramos, solo si aparece impreso "
    "explícitamente en la etiqueta (por ejemplo '0.586 kg'). Si no aparece, "
    "usa null.\n\n"
    "Si no puedes determinar un campo con confianza, usa null para ese "
    "campo en vez de adivinar."
)


def _parse_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _parse_weight_kg(value: object) -> Decimal | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        # Two decimal places to match Product.quantity's NUMERIC(10, 2) — a
        # third decimal from the model (labels print up to three, see #30)
        # would otherwise be rejected downstream instead of just rounded.
        quantized = Decimal(str(value)).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    return quantized if quantized > 0 else None


def extract_label(image_bytes: bytes) -> LabelExtraction | None:
    """Best-effort fields read from a label photo, or None on any failure.

    None means "could not get a usable answer at all" — network down, bad
    response shape. A LabelExtraction with every field null means the model
    itself came back and found nothing it was confident about; the caller
    treats both the same way (fall back to a blank, manually-filled form),
    but they are logged differently since only the first is a real failure.
    """
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
                # The model's configured defaults (temperature 1, tuned for
                # picking a varied emoji) measurably produce a wrong date on
                # this prompt — reproduced directly: the same label, same
                # schema, temperature 1 returned a date matching neither
                # printed one, on 4 consecutive tries at temperature 0 it
                # matched the correct one every time. Determinism is worth
                # more than variety for a field this consequential.
                "options": {"temperature": 0},
            },
            timeout=TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("Ollama label extraction failed: %s", exc.__class__.__name__)
        return None

    try:
        raw = json.loads(response.json()["response"])
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning(
            "Ollama returned an unparsable label response (%s): %r",
            exc.__class__.__name__,
            response.text[:200],
        )
        return None

    name = raw.get("name")
    name = name.strip() if isinstance(name, str) and name.strip() else None

    weight_kg = _parse_weight_kg(raw.get("weight_kg"))

    return LabelExtraction(
        name=name,
        expires_at=_parse_date(raw.get("expires_at")),
        quantity=weight_kg,
        unit="kg" if weight_kg is not None else None,
    )
