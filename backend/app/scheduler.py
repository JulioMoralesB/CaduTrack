"""Daily scheduling of the expiry alert.

Runs inside the API process, per #20. That is fine for a single container and
is what the deployment runs today — but it does mean a second replica would
send a second alert. If CaduTrack is ever scaled out, this has to move to a
single external trigger calling POST /alerts/trigger instead.
"""

import logging
from datetime import time

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.alerts import send_expiry_alert
from app.config import settings
from app.db.session import SessionLocal
from app.telegram import is_configured

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

JOB_ID = "daily-expiry-alert"


def parse_alert_time(value: str) -> time:
    """Parse ALERT_TIME as HH:MM.

    Raises rather than falling back to a default: a typo that silently moves the
    alert to midnight is worse than a container that refuses to start.
    """
    try:
        hour, minute = (int(part) for part in value.split(":", 1))
        return time(hour=hour, minute=minute)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"ALERT_TIME must be HH:MM, got {value!r}") from exc


def run_daily_alert() -> None:
    """The scheduled job.

    Owns its own session: the request-scoped dependency does not exist here, and
    a session held open between daily runs would go stale.
    """
    try:
        with SessionLocal() as session:
            send_expiry_alert(session)
    except Exception:
        # A job that raises is dropped by APScheduler with only its own warning.
        # Log it as ours so the failure is visible under this service's name.
        logger.exception("Daily expiry alert failed")


def start_scheduler() -> BackgroundScheduler | None:
    """Start the daily job. Returns None when there is nothing to schedule."""
    global _scheduler

    if not is_configured():
        # Scheduling it anyway would raise TelegramNotConfigured once a day,
        # for ever, in a background thread nobody is reading.
        logger.info("Telegram is not configured, daily expiry alert not scheduled")
        return None

    alert_time = parse_alert_time(settings.alert_time)

    # Threaded rather than asyncio: send_expiry_alert does blocking database and
    # HTTP work, which on the event loop would stall every request in flight.
    scheduler = BackgroundScheduler(timezone=settings.timezone)
    scheduler.add_job(
        run_daily_alert,
        trigger=CronTrigger(hour=alert_time.hour, minute=alert_time.minute, timezone=settings.timezone),
        id=JOB_ID,
        # A restart spanning the alert time should still deliver, but an hour
        # late at most — a digest arriving at midnight helps nobody.
        misfire_grace_time=3600,
        # Several missed runs collapse into one rather than firing a burst.
        coalesce=True,
        max_instances=1,
    )
    scheduler.start()
    _scheduler = scheduler

    logger.info(
        "Daily expiry alert scheduled for %s %s", settings.alert_time, settings.timezone
    )
    return scheduler


def shutdown_scheduler() -> None:
    """Stop the scheduler, if one is running."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Daily expiry alert scheduler stopped")
