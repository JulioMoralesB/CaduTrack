"""Health endpoint tests."""

import pytest

from app import activity, label_queue, routers
from app.config import settings


@pytest.fixture(autouse=True)
def no_label_queue(monkeypatch):
    """These run without a database; test_activity.py covers busy itself."""
    monkeypatch.setattr(label_queue, "has_pending", lambda: False)
    activity.reset()


def test_health_reports_ok_when_database_answers(client, monkeypatch):
    monkeypatch.setattr(routers.health, "check_connection", lambda: True)
    monkeypatch.setattr(settings, "app_version", "v0.11.0")

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "ok",
        "version": "v0.11.0",
        "last_user_activity_at": None,
        "started_at": activity.started_at().isoformat(),
        "busy": False,
    }


def test_health_reports_degraded_when_database_is_unreachable(client, monkeypatch):
    """A live API with a dead database must not look healthy to monitoring."""
    monkeypatch.setattr(routers.health, "check_connection", lambda: False)
    monkeypatch.setattr(settings, "app_version", "v0.11.0")

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "database": "unavailable",
        "version": "v0.11.0",
        "last_user_activity_at": None,
        "started_at": activity.started_at().isoformat(),
        "busy": False,
    }


def test_health_reports_dev_outside_the_release_pipeline(client, monkeypatch):
    """APP_VERSION is only ever set by the release workflow's build arg — a
    local build or a plain `python -m app` must say so plainly rather than
    silently claiming to be a numbered release it is not."""
    monkeypatch.setattr(routers.health, "check_connection", lambda: True)
    monkeypatch.setattr(settings, "app_version", "dev")

    assert client.get("/health").json()["version"] == "dev"
