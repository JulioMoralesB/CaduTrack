"""Alert settings tests."""

import pytest

from app.config import settings as env_settings
from app.scheduler import JOB_ID, shutdown_scheduler, start_scheduler
from app.settings_store import get_or_create, update


@pytest.fixture(autouse=True)
def stop_scheduler():
    yield
    shutdown_scheduler()


@pytest.fixture
def telegram_configured(monkeypatch):
    monkeypatch.setattr(env_settings, "telegram_bot_token", "token")
    monkeypatch.setattr(env_settings, "telegram_chat_id", "chat")


@pytest.mark.integration
def test_settings_seed_from_the_environment_on_first_read(db_session, monkeypatch):
    """An existing deployment must keep behaving as its .env said."""
    monkeypatch.setattr(env_settings, "alert_time", "09:15")
    monkeypatch.setattr(env_settings, "alert_days_ahead", 3)

    stored = get_or_create(db_session)

    assert stored.alert_time == "09:15"
    assert stored.days_ahead == 3
    assert stored.enabled is True


@pytest.mark.integration
def test_settings_are_not_reseeded_once_they_exist(db_session, monkeypatch):
    monkeypatch.setattr(env_settings, "alert_time", "09:15")
    get_or_create(db_session)

    monkeypatch.setattr(env_settings, "alert_time", "23:00")
    stored = get_or_create(db_session)

    # The database wins after seeding; the env is only the initial value.
    assert stored.alert_time == "09:15"


@pytest.mark.integration
def test_get_reports_settings_without_ever_exposing_the_token(api_client, monkeypatch):
    monkeypatch.setattr(env_settings, "telegram_bot_token", "super-secret-token")
    monkeypatch.setattr(env_settings, "telegram_chat_id", "chat")

    body = api_client.get("/settings").json()

    assert body["telegram_configured"] is True
    assert body["timezone"]
    assert "super-secret-token" not in str(body)
    assert "token" not in body["alerts"]


@pytest.mark.integration
def test_get_reports_telegram_as_unconfigured_when_it_is(api_client, monkeypatch):
    monkeypatch.setattr(env_settings, "telegram_bot_token", "")
    monkeypatch.setattr(env_settings, "telegram_chat_id", "")

    assert api_client.get("/settings").json()["telegram_configured"] is False


@pytest.mark.integration
def test_saving_persists_the_new_values(api_client):
    response = api_client.put(
        "/settings", json={"enabled": True, "alert_time": "07:45", "days_ahead": 5}
    )

    assert response.status_code == 200
    assert response.json()["alerts"]["alert_time"] == "07:45"
    assert api_client.get("/settings").json()["alerts"]["days_ahead"] == 5


@pytest.mark.integration
def test_saving_a_new_time_actually_reschedules_the_job(api_client, db_session, telegram_configured):
    """The failure this guards against looks like success.

    Storing a new time without rescheduling leaves the UI reporting the change
    while the alert keeps firing at the old one.
    """
    update(db_session, enabled=True, alert_time="08:00", days_ahead=7)
    scheduler = start_scheduler()
    assert scheduler.get_job(JOB_ID).next_run_time.hour == 8

    api_client.put("/settings", json={"enabled": True, "alert_time": "21:30", "days_ahead": 7})

    job = scheduler.get_job(JOB_ID)
    assert job.next_run_time.hour == 21
    assert job.next_run_time.minute == 30


@pytest.mark.integration
def test_disabling_removes_the_job(api_client, db_session, telegram_configured):
    """Turning alerts off must stop delivery without touching any env var."""
    update(db_session, enabled=True, alert_time="08:00", days_ahead=7)
    scheduler = start_scheduler()
    assert scheduler.get_job(JOB_ID) is not None

    api_client.put("/settings", json={"enabled": False, "alert_time": "08:00", "days_ahead": 7})

    assert scheduler.get_job(JOB_ID) is None


@pytest.mark.integration
def test_re_enabling_puts_the_job_back(api_client, db_session, telegram_configured):
    update(db_session, enabled=False, alert_time="08:00", days_ahead=7)
    scheduler = start_scheduler()
    assert scheduler.get_job(JOB_ID) is None

    api_client.put("/settings", json={"enabled": True, "alert_time": "10:00", "days_ahead": 7})

    assert scheduler.get_job(JOB_ID).next_run_time.hour == 10


@pytest.mark.integration
def test_next_run_at_reflects_the_scheduler_not_the_setting(api_client, db_session, monkeypatch):
    """With Telegram unconfigured nothing is scheduled, whatever the setting says."""
    monkeypatch.setattr(env_settings, "telegram_bot_token", "")
    update(db_session, enabled=True, alert_time="08:00", days_ahead=7)
    start_scheduler()

    body = api_client.get("/settings").json()

    assert body["alerts"]["enabled"] is True
    assert body["next_run_at"] is None


@pytest.mark.integration
@pytest.mark.parametrize(
    "payload",
    [
        {"enabled": True, "alert_time": "25:00", "days_ahead": 7},
        {"enabled": True, "alert_time": "8:00", "days_ahead": 7},
        {"enabled": True, "alert_time": "ocho", "days_ahead": 7},
        {"enabled": True, "alert_time": "08:00", "days_ahead": 0},
        {"enabled": True, "alert_time": "08:00", "days_ahead": -1},
    ],
)
def test_invalid_settings_are_rejected(api_client, payload):
    assert api_client.put("/settings", json=payload).status_code == 422


@pytest.mark.integration
def test_get_includes_icon_settings_and_ollama_configured(api_client):
    body = api_client.get("/settings").json()

    assert body["icons"]["ai_enabled"] is True
    assert body["ollama_configured"] is False


@pytest.mark.integration
def test_get_reports_ollama_configured_when_a_url_is_set(api_client, monkeypatch):
    monkeypatch.setattr(env_settings, "ollama_url", "http://ollama.example:11434")

    assert api_client.get("/settings").json()["ollama_configured"] is True


@pytest.mark.integration
def test_turning_off_the_icon_toggle_persists(api_client):
    response = api_client.put("/settings/icons", json={"ai_enabled": False})

    assert response.status_code == 200
    assert response.json()["icons"]["ai_enabled"] is False
    assert api_client.get("/settings").json()["icons"]["ai_enabled"] is False


@pytest.mark.integration
def test_the_icon_toggle_never_touches_alert_settings(api_client):
    api_client.put("/settings", json={"enabled": True, "alert_time": "21:30", "days_ahead": 7})

    api_client.put("/settings/icons", json={"ai_enabled": False})

    alerts = api_client.get("/settings").json()["alerts"]
    assert alerts["alert_time"] == "21:30"
    assert alerts["days_ahead"] == 7


@pytest.mark.integration
def test_saving_alert_settings_never_touches_the_icon_toggle(api_client):
    api_client.put("/settings/icons", json={"ai_enabled": False})

    api_client.put("/settings", json={"enabled": True, "alert_time": "09:00", "days_ahead": 3})

    assert api_client.get("/settings").json()["icons"]["ai_enabled"] is False
