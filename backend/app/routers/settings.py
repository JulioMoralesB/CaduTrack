"""Alert settings endpoints."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings as env_settings
from app.db.session import get_db
from app.scheduler import apply_settings, next_run_time
from app.schemas.settings import AlertSettingsRead, AlertSettingsUpdate, SettingsResponse
from app.settings_store import get_or_create, update
from app.telegram import is_configured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


def _response(stored) -> SettingsResponse:
    return SettingsResponse(
        alerts=AlertSettingsRead.model_validate(stored),
        telegram_configured=is_configured(),
        next_run_at=next_run_time(),
        timezone=env_settings.timezone,
    )


@router.get("", response_model=SettingsResponse)
def read_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    """Current alert settings, plus whether delivery is actually possible."""
    return _response(get_or_create(db))


@router.put("", response_model=SettingsResponse)
def replace_settings(payload: AlertSettingsUpdate, db: Session = Depends(get_db)) -> SettingsResponse:
    """Change the alert settings and reschedule the running job.

    Rescheduling is the point: storing a new time without applying it would
    leave the UI reporting success while the alert kept firing at the old one.
    """
    stored = update(
        db,
        enabled=payload.enabled,
        alert_time=payload.alert_time,
        days_ahead=payload.days_ahead,
    )
    apply_settings(stored.enabled, stored.alert_time)
    return _response(stored)
