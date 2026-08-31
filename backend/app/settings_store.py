"""Reading and writing the user-editable alert settings.

Kept out of app/config.py deliberately: that module holds deployment
configuration, read once from the environment. These are preferences, read from
the database on every use so a change takes effect without a restart.
"""

import logging
from datetime import time

from sqlalchemy.orm import Session

from app.config import settings as env_settings
from app.models import AlertSettings

logger = logging.getLogger(__name__)

SINGLETON_ID = 1


def parse_alert_time(value: str) -> time:
    """Parse an alert time as HH:MM.

    Raises rather than falling back to a default: a value that silently moves
    the alert to midnight is worse than a refusal.
    """
    try:
        hour, minute = (int(part) for part in value.split(":", 1))
        return time(hour=hour, minute=minute)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Alert time must be HH:MM, got {value!r}") from exc


def get_or_create(session: Session) -> AlertSettings:
    """Return the settings row, seeding it from the environment if absent.

    Seeding rather than defaulting in code means an existing deployment keeps
    behaving exactly as its .env said on the day this shipped, instead of
    silently jumping to a new default.
    """
    stored = session.get(AlertSettings, SINGLETON_ID)
    if stored is not None:
        return stored

    # Validate before inserting: a malformed ALERT_TIME would otherwise surface
    # as a CHECK constraint violation, which says nothing about which setting is
    # wrong or what it should look like.
    parse_alert_time(env_settings.alert_time)

    stored = AlertSettings(
        id=SINGLETON_ID,
        enabled=True,
        alert_time=env_settings.alert_time,
        days_ahead=env_settings.alert_days_ahead,
    )
    session.add(stored)
    session.commit()
    session.refresh(stored)
    logger.info(
        "Seeded alert settings from the environment: %s, %s days ahead",
        stored.alert_time,
        stored.days_ahead,
    )
    return stored


def update(session: Session, *, enabled: bool, alert_time: str, days_ahead: int) -> AlertSettings:
    """Replace the stored settings and return the new row."""
    stored = get_or_create(session)
    stored.enabled = enabled
    stored.alert_time = alert_time
    stored.days_ahead = days_ahead
    session.commit()
    session.refresh(stored)
    logger.info(
        "Alert settings updated: enabled=%s time=%s days_ahead=%s",
        stored.enabled,
        stored.alert_time,
        stored.days_ahead,
    )
    return stored


def read_only(session: Session) -> tuple[bool, str, int]:
    """Settings as plain values, for callers that must not hold the ORM object.

    The scheduler runs on another thread with its own session; handing it a
    detached instance would raise the moment it touched an attribute.
    """
    stored = get_or_create(session)
    return stored.enabled, stored.alert_time, stored.days_ahead
