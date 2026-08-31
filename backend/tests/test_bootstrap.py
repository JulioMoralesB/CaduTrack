"""Database bootstrap tests."""

import logging

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.db.bootstrap import _maintenance_url, ensure_database_exists

THROWAWAY = "cadutrack_bootstrap_pytest"


def test_maintenance_url_keeps_the_credentials_and_swaps_the_database():
    url = _maintenance_url()
    assert url.endswith("/postgres")
    assert url.rsplit("/", 1)[0] == settings.database_url.rsplit("/", 1)[0]


@pytest.fixture
def maintenance_engine():
    engine = create_engine(_maintenance_url(), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{THROWAWAY}"'))
        yield engine
        with engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{THROWAWAY}"'))
    finally:
        engine.dispose()


def _exists(engine, name: str) -> bool:
    with engine.connect() as connection:
        return (
            connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
            ).scalar()
            is not None
        )


@pytest.mark.integration
def test_creates_the_database_when_missing(maintenance_engine, monkeypatch):
    monkeypatch.setattr(settings, "db_name", THROWAWAY)
    assert not _exists(maintenance_engine, THROWAWAY)

    ensure_database_exists()

    assert _exists(maintenance_engine, THROWAWAY)


@pytest.mark.integration
def test_is_a_no_op_when_the_database_already_exists(maintenance_engine, monkeypatch):
    """Every start after the first takes this path."""
    monkeypatch.setattr(settings, "db_name", THROWAWAY)
    ensure_database_exists()

    # Must not raise, and must leave the database alone.
    ensure_database_exists()

    assert _exists(maintenance_engine, THROWAWAY)


def test_a_transient_outage_produces_warnings_and_no_error(monkeypatch, caplog):
    """A normal restart must not look like a failure.

    An ERROR here is what an error-rate alert would fire on, every night, for a
    condition that already recovered — and an alert that cries wolf nightly gets
    muted within a fortnight.
    """
    import app.db.bootstrap as bootstrap

    attempts = {"n": 0}

    def flaky() -> bool:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise OperationalError("connection failed", None, Exception())
        return True

    monkeypatch.setattr(bootstrap, "_database_exists", flaky)
    monkeypatch.setattr(bootstrap, "RETRY_SECONDS", 0)

    with caplog.at_level(logging.DEBUG, logger="app.db.bootstrap"):
        assert bootstrap._database_exists_once_reachable() is True

    levels = [record.levelname for record in caplog.records]
    assert levels == ["WARNING", "WARNING"]
    assert "attempt 1/10" in caplog.records[0].getMessage()


def test_giving_up_raises_so_the_caller_can_log_one_error(monkeypatch):
    """Exhausting the budget is the only thing that deserves an ERROR."""
    import app.db.bootstrap as bootstrap

    def always_down() -> bool:
        raise OperationalError("connection failed", None, Exception())

    monkeypatch.setattr(bootstrap, "_database_exists", always_down)
    monkeypatch.setattr(bootstrap, "RETRY_SECONDS", 0)

    with pytest.raises(OperationalError):
        bootstrap._database_exists_once_reachable()


def test_it_waits_rather_than_letting_the_container_crash_loop(monkeypatch):
    """Sleeping between attempts is the point.

    Without it the process exits, the entrypoint stops the container, and the
    restart policy retries — which works, but logs a failure each time.
    """
    import app.db.bootstrap as bootstrap

    slept: list[float] = []
    calls = {"n": 0}

    def twice_down() -> bool:
        calls["n"] += 1
        if calls["n"] < 3:
            raise OperationalError("connection failed", None, Exception())
        return True

    monkeypatch.setattr(bootstrap, "_database_exists", twice_down)
    monkeypatch.setattr(bootstrap.time, "sleep", lambda seconds: slept.append(seconds))

    bootstrap._database_exists_once_reachable()

    assert slept == [bootstrap.RETRY_SECONDS, bootstrap.RETRY_SECONDS]
