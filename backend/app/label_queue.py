"""Reading queued label photos in the background — see #134.

One photo at a time, oldest first: every read goes to the same single
Ollama server, and firing several at once would only make each one wait
behind the others toward vision_client's own timeout instead of finishing
sooner. A single process-wide lock is enough for that because the API runs
as one uvicorn process — see app/scheduler.py's own note on the same
assumption.

Nothing is lost if the process stops mid-queue: a photo's status only
leaves "pending" once its read is saved, so whatever was still pending is
simply picked up again on the next start (see main.py's lifespan).
"""

import logging
import threading

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import LabelScan, LabelScanStatus
from app.vision_client import extract_label

logger = logging.getLogger(__name__)

_lock = threading.Lock()


def process_pending() -> None:
    """Read every pending photo, returning once none are left.

    Safe to call as often as anything likes — after every upload, on
    startup, on a retry. A call that finds another already running returns
    at once; the one already running re-checks for new photos after
    releasing the lock, so a photo queued just as it was finishing is never
    stranded between the two.
    """
    try:
        while _lock.acquire(blocking=False):
            try:
                _drain()
            finally:
                _lock.release()
            if _next_pending_id() is None:
                return
    except Exception:
        # A background thread's exception is otherwise only printed to
        # stderr, outside the JSON logs.
        logger.exception("Label queue processing failed")


def _next_pending_id() -> int | None:
    with SessionLocal() as session:
        return session.execute(
            select(LabelScan.id)
            .where(LabelScan.status == LabelScanStatus.pending, LabelScan.resolved_at.is_(None))
            .order_by(LabelScan.id)
            .limit(1)
        ).scalar_one_or_none()


def _drain() -> None:
    while (scan_id := _next_pending_id()) is not None:
        with SessionLocal() as session:
            image = session.get(LabelScan, scan_id).image

        # Outside any session: a cold model load takes tens of seconds (see
        # vision_client.TIMEOUT_SECONDS), far too long to hold a pooled
        # connection open doing nothing.
        try:
            extraction = extract_label(image) if image else None
        except Exception:
            # extract_label promises never to raise, but a photo that breaks
            # it anyway must be marked failed rather than left pending — the
            # oldest pending photo goes first, so it would block every photo
            # behind it on every future attempt.
            logger.exception("Reading label scan %s raised", scan_id)
            extraction = None

        with SessionLocal() as session:
            scan = session.get(LabelScan, scan_id)
            if extraction is None:
                scan.status = LabelScanStatus.failed
                logger.warning("Label scan %s could not be read", scan_id)
            else:
                scan.status = LabelScanStatus.read
                scan.name = extraction.name
                scan.expires_at = extraction.expires_at
                scan.quantity = extraction.quantity
                scan.unit = extraction.unit
                logger.info("Label scan %s read as %r", scan_id, extraction.name)
            session.commit()
