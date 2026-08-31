"""Daily alert scheduler tests."""

from datetime import time
from unittest.mock import patch

import pytest

from app.config import settings
from app.scheduler import JOB_ID, parse_alert_time, run_daily_alert, shutdown_scheduler, start_scheduler


@pytest.fixture(autouse=True)
def stop_scheduler():
    """Never leave a background thread running between tests."""
    yield
    shutdown_scheduler()


@pytest.mark.parametrize(
    "value,expected",
    [("08:00", time(8, 0)), ("00:00", time(0, 0)), ("23:59", time(23, 59)), ("7:05", time(7, 5))],
)
def test_parses_valid_times(value, expected):
    assert parse_alert_time(value) == expected


@pytest.mark.parametrize("value", ["8am", "08", "", "25:00", "08:61", "08:00:00"])
def test_rejects_an_unusable_time(value):
    """A typo that silently moves the alert to midnight is worse than a crash."""
    with pytest.raises(ValueError):
        parse_alert_time(value)


def test_nothing_is_scheduled_without_telegram(monkeypatch):
    """Otherwise the job raises once a day forever, in a thread nobody reads."""
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    monkeypatch.setattr(settings, "telegram_chat_id", "")

    assert start_scheduler() is None


def test_the_job_is_registered_at_the_configured_time(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    monkeypatch.setattr(settings, "telegram_chat_id", "chat")
    monkeypatch.setattr(settings, "alert_time", "06:30")
    monkeypatch.setattr(settings, "timezone", "America/Mexico_City")

    scheduler = start_scheduler()

    job = scheduler.get_job(JOB_ID)
    assert job is not None
    assert job.next_run_time.hour == 6
    assert job.next_run_time.minute == 30
    # Scheduled in the configured zone, not the host's.
    assert "Mexico_City" in str(job.next_run_time.tzinfo)


def test_a_bad_time_stops_startup_rather_than_guessing(monkeypatch):
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    monkeypatch.setattr(settings, "telegram_chat_id", "chat")
    monkeypatch.setattr(settings, "alert_time", "media noche")

    with pytest.raises(ValueError):
        start_scheduler()


def test_missed_runs_collapse_instead_of_firing_a_burst(monkeypatch):
    """A container down for a day should deliver once on return, not repeatedly."""
    monkeypatch.setattr(settings, "telegram_bot_token", "token")
    monkeypatch.setattr(settings, "telegram_chat_id", "chat")

    job = start_scheduler().get_job(JOB_ID)

    assert job.coalesce is True
    assert job.max_instances == 1
    assert job.misfire_grace_time == 3600


def test_a_failing_send_does_not_escape_the_job():
    """APScheduler drops a raising job with only its own warning."""
    with patch("app.scheduler.send_expiry_alert", side_effect=RuntimeError("telegram down")):
        run_daily_alert()  # must not raise


def test_the_job_sends_the_alert():
    with patch("app.scheduler.send_expiry_alert") as send:
        run_daily_alert()

    send.assert_called_once()
