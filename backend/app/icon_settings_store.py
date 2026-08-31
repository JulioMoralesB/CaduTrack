"""Reading and writing the icon-assignment toggle.

Same shape as app/settings_store.py, and deliberately not merged into it:
that module's docstring and every function in it are about alert
preferences. This is a different single-row setting that happens to look
alike.
"""

import logging

from sqlalchemy.orm import Session

from app.models import IconSettings

logger = logging.getLogger(__name__)

SINGLETON_ID = 1


def get_or_create(session: Session) -> IconSettings:
    """Return the settings row, creating it with the column default if absent."""
    stored = session.get(IconSettings, SINGLETON_ID)
    if stored is not None:
        return stored

    stored = IconSettings(id=SINGLETON_ID, ai_enabled=True)
    session.add(stored)
    session.commit()
    session.refresh(stored)
    logger.info("Seeded icon settings: ai_enabled=True")
    return stored


def update(session: Session, *, ai_enabled: bool) -> IconSettings:
    """Replace the stored setting and return the new row."""
    stored = get_or_create(session)
    stored.ai_enabled = ai_enabled
    session.commit()
    session.refresh(stored)
    logger.info("Icon settings updated: ai_enabled=%s", ai_enabled)
    return stored


def ai_enabled(session: Session) -> bool:
    """The setting as a plain bool, for a caller that only needs the flag."""
    return get_or_create(session).ai_enabled
