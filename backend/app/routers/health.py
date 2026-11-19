import logging

from fastapi import APIRouter, Response, status

from app import activity, label_queue
from app.config import settings
from app.db.session import check_connection

logger = logging.getLogger(__name__)

router = APIRouter()


def _busy(database_ok: bool) -> bool:
    """Whether a shutdown now would cut off work in progress — see #215."""
    if activity.receipt_being_read():
        return True
    if not database_ok:
        # Nothing to ask. Queued label photos survive a restart anyway
        # (label_queue resumes them on start), so this only costs a re-read.
        return False
    try:
        return label_queue.has_pending()
    except Exception:
        logger.warning("Could not check the label queue", exc_info=True)
        return False


@router.get("/health")
def health(response: Response):
    """Liveness/readiness probe.

    Reports the database separately so monitoring can tell a live service with
    an unreachable database apart from a service that is down entirely.

    Also what an idle-shutdown script needs — see #215 and app/activity.py:
    when a person last used the app (null if nobody has since the start),
    when the process started, and whether work is in progress. Two times and
    a boolean: nothing about who, so it stays as open as the rest of this.

    A plain def: it waits on the database, which must not stall the event
    loop for every other request.
    """
    database_ok = check_connection()
    if not database_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    last_activity = activity.last_user_activity_at()
    return {
        "status": "ok" if database_ok else "degraded",
        "database": "ok" if database_ok else "unavailable",
        "version": settings.app_version,
        "last_user_activity_at": last_activity.isoformat() if last_activity else None,
        "started_at": activity.started_at().isoformat(),
        "busy": _busy(database_ok),
    }
