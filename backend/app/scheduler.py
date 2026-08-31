"""Daily scheduling of the expiry alert.

Runs inside the API process, per #20. That is fine for a single container and
is what the deployment runs today — but it does mean a second replica would
send a second alert. If CaduTrack is ever scaled out, this has to move to a
single external trigger calling POST /alerts/trigger.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.alerts import send_expiry_alert
from app.config import settings
from app.db.session import SessionLocal
from app.settings_store import parse_alert_time, read_only
from app.telegram import is_configured

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None

JOB_ID = "daily-expiry-alert"


def run_daily_alert() -> None:
    """The scheduled job.

    Owns its own session: the request-scoped dependency does not exist on this
    thread, and a session held open between daily runs would go stale.
    """
    try:
        with SessionLocal() as session:
            send_expiry_alert(session)
    except Exception:
        # A job that raises is dropped by APScheduler with only its own warning.
        # Log it as ours so the failure is visible under this service's name.
        logger.exception("Daily expiry alert failed")


def _schedule_job(scheduler: BackgroundScheduler, alert_time: str) -> None:
    parsed = parse_alert_time(alert_time)
    scheduler.add_job(
        run_daily_alert,
        trigger=CronTrigger(hour=parsed.hour, minute=parsed.minute, timezone=settings.timezone),
        id=JOB_ID,
        replace_existing=True,
        # A restart spanning the alert time should still deliver, but an hour
        # late at most — a digest arriving at midnight helps nobody.
        misfire_grace_time=3600,
        # Several missed runs collapse into one rather than firing a burst.
        coalesce=True,
        max_instances=1,
    )
    logger.info("Daily expiry alert scheduled for %s %s", alert_time, settings.timezone)


def apply_settings(enabled: bool, alert_time: str) -> None:
    """Bring the running scheduler in line with the stored settings.

    Called after a settings change. Without this the UI would report a new time,
    and the job would keep firing at the old one — which looks like success and
    is worse than not offering the setting at all.
    """
    if _scheduler is None:
        return

    if not enabled:
        if _scheduler.get_job(JOB_ID) is not None:
            _scheduler.remove_job(JOB_ID)
            logger.info("Daily expiry alert disabled, job removed")
        return

    _schedule_job(_scheduler, alert_time)


def start_scheduler() -> BackgroundScheduler | None:
    """Start the daily job. Returns None when there is nothing to schedule."""
    global _scheduler

    if not is_configured():
        # Scheduling it anyway would raise once a day, for ever, in a background
        # thread nobody is reading.
        logger.info("Telegram is not configured, daily expiry alert not scheduled")
        return None

    with SessionLocal() as session:
        enabled, alert_time, _days_ahead = read_only(session)

    # Threaded rather than asyncio: send_expiry_alert does blocking database and
    # HTTP work, which on the event loop would stall every request in flight.
    scheduler = BackgroundScheduler(timezone=settings.timezone)
    scheduler.start()
    _scheduler = scheduler

    if enabled:
        _schedule_job(scheduler, alert_time)
    else:
        logger.info("Daily expiry alert is disabled in settings, not scheduled")

    return scheduler


def next_run_time() -> str | None:
    """ISO timestamp of the next scheduled run, or None when nothing is scheduled.

    Surfaced in the API so the UI can show when the next alert is actually due,
    rather than only what the setting says.
    """
    if _scheduler is None:
        return None
    job = _scheduler.get_job(JOB_ID)
    return job.next_run_time.isoformat() if job and job.next_run_time else None


def shutdown_scheduler() -> None:
    """Stop the scheduler, if one is running."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Daily expiry alert scheduler stopped")
