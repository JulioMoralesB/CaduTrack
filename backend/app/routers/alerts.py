"""Manual alert trigger."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.alerts import send_expiry_alert
from app.db.session import get_db
from app.telegram import TelegramDeliveryError, TelegramNotConfigured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.post("/trigger")
def trigger_alert(db: Session = Depends(get_db)) -> dict[str, object]:
    """Send the expiry alert now, without waiting for the daily schedule.

    Exists for testing the delivery path — a scheduled job that has never run is
    a job nobody knows is broken.
    """
    try:
        count = send_expiry_alert(db)
    except TelegramNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except TelegramDeliveryError as exc:
        # Handled rather than left to become a 500: what Telegram said —
        # "chat not found", say — is what whoever pressed the button needs
        # to read, and none of it can hold the request URL. See #170.
        logger.error("Manual expiry alert failed: %s", exc)
        if exc.status_code is None:
            detail = "No se pudo conectar con Telegram. Inténtalo de nuevo."
        elif exc.reason:
            detail = f"Telegram rechazó la alerta: {exc.reason}"
        else:
            detail = f"Telegram rechazó la alerta (HTTP {exc.status_code})."
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc

    return {
        "sent": count > 0,
        "products": count,
        "detail": "Alerta enviada" if count else "No hay productos por caducar",
    }
