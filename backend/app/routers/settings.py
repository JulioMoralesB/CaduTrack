"""Alert and icon-assignment settings endpoints."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import icon_settings_store, settings_store
from app.config import settings as env_settings
from app.db.session import get_db
from app.scheduler import apply_settings, next_run_time
from app.schemas.settings import (
    AlertSettingsRead,
    AlertSettingsUpdate,
    IconSettingsRead,
    IconSettingsUpdate,
    SettingsResponse,
)
from app.telegram import is_configured

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


def _response(db: Session) -> SettingsResponse:
    """Reads both settings rows fresh rather than taking one as a parameter:
    every call site needs both, and a caller that just wrote one of them would
    otherwise have to remember to re-fetch the other to avoid returning it
    stale."""
    return SettingsResponse(
        alerts=AlertSettingsRead.model_validate(settings_store.get_or_create(db)),
        icons=IconSettingsRead.model_validate(icon_settings_store.get_or_create(db)),
        telegram_configured=is_configured(),
        next_run_at=next_run_time(),
        timezone=env_settings.timezone,
        ollama_configured=bool(env_settings.ollama_url),
    )


@router.get("", response_model=SettingsResponse)
def read_settings(db: Session = Depends(get_db)) -> SettingsResponse:
    """Current settings, plus whether delivery/the model are actually reachable."""
    return _response(db)


@router.put("", response_model=SettingsResponse)
def replace_settings(payload: AlertSettingsUpdate, db: Session = Depends(get_db)) -> SettingsResponse:
    """Change the alert settings and reschedule the running job.

    Rescheduling is the point: storing a new time without applying it would
    leave the UI reporting success while the alert kept firing at the old one.
    """
    stored = settings_store.update(
        db,
        enabled=payload.enabled,
        alert_time=payload.alert_time,
        days_ahead=payload.days_ahead,
    )
    apply_settings(stored.enabled, stored.alert_time)
    return _response(db)


@router.put("/icons", response_model=SettingsResponse)
def replace_icon_settings(payload: IconSettingsUpdate, db: Session = Depends(get_db)) -> SettingsResponse:
    """Turn the icon-assignment model fallback on or off.

    A separate endpoint from PUT /settings on purpose, the same way the
    product icon override is separate from PUT /products/{id}: this setting
    has nothing to do with alert preferences, and folding it into that
    payload would mean every alert-settings save has to also know and resend
    this value or risk resetting it.
    """
    icon_settings_store.update(db, ai_enabled=payload.ai_enabled)
    return _response(db)
