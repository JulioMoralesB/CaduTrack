"""Health endpoint tests."""

from app import routers


def test_health_reports_ok_when_database_answers(client, monkeypatch):
    monkeypatch.setattr(routers.health, "check_connection", lambda: True)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_reports_degraded_when_database_is_unreachable(client, monkeypatch):
    """A live API with a dead database must not look healthy to monitoring."""
    monkeypatch.setattr(routers.health, "check_connection", lambda: False)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "unavailable"}
