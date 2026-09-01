"""Label-photo extraction endpoint — see #83."""

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.schemas.vision import LabelExtraction
from app.vision_client import extract_label

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vision", tags=["vision"])

# A phone photo is a few MB at most; this is a generous ceiling against a
# request that is either a mistake (wrong file picked) or abuse, not a limit
# meant to bind on a real label photo.
_MAX_IMAGE_BYTES = 10 * 1024 * 1024


@router.post("/label", response_model=LabelExtraction)
async def extract_label_from_photo(image: UploadFile = File(...)) -> LabelExtraction:
    """Read a name, expiry date, and weight from a photo of a product label.

    Side-effect free by design: nothing here touches the database. The
    result is meant to pre-fill the product form for the user to confirm or
    correct — see #83's acceptance criteria — never to be saved on its own.
    """
    contents = await image.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="La imagen está vacía")
    if len(contents) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="La imagen es demasiado grande"
        )

    result = extract_label(contents)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo leer la etiqueta. Ingresa los datos manualmente.",
        )
    return result
