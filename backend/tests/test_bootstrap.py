"""Database bootstrap tests."""

import logging

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.db.bootstrap import (
    DatabaseAuthenticationError,
    DatabaseUnreachableError,
    _maintenance_url,
    ensure_database_exists,
)

THROWAWAY = "cadutrack_bootstrap_pytest"


class FakeClock:
    """A clock that advances only when the code under test sleeps.

    The retry budget is measured in elapsed time, so stubbing sleep with a no-op
    would leave the clock at zero and spin forever. Advancing a fake clock keeps
    these tests instant while still exercising the real budget arithmetic.
    """

    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def _down() -> bool:
    raise OperationalError("connection failed", None, Exception())


def _operational_error(message: str) -> OperationalError:
    """Build an OperationalError carrying the given server-reported message.

    Message text is the only signal available to classify these: psycopg
    does not attach a SQLSTATE to failures raised during connection setup,
    where auth happens before the wire protocol can hand back a typed
    exception. These strings were captured against a live Postgres 16.
    """
    return OperationalError("connection failed", None, Exception(message))


@pytest.mark.parametrize(
    "message",
    [
        'FATAL:  database "cadutrack" does not exist',
        'FATAL:  database "cadutrack_bootstrap_pytest" does not exist',
    ],
)
def test_a_missing_database_is_classified_as_missing_not_an_auth_failure(message):
    import app.db.bootstrap as bootstrap

    exc = _operational_error(message)
    assert bootstrap._is_missing_database(exc) is True
    assert bootstrap._is_authentication_failure(exc) is False


@pytest.mark.parametrize(
    "message",
    [
        # The default scram/md5 auth path: Postgres deliberately gives this
        # same message for a wrong password and for a role that doesn't
        # exist, to avoid revealing which one it was.
        'FATAL:  password authentication failed for user "cadutrack"',
        # The trust/peer auth path: a role check happens up front, so the
        # message names the role directly — and it contains "does not
        # exist", which is exactly what the old substring check confused
        # with a missing database.
        'FATAL:  role "cadutrack" does not exist',
    ],
)
def test_a_credentials_failure_is_classified_as_auth_not_a_missing_database(message):
    import app.db.bootstrap as bootstrap

    exc = _operational_error(message)
    assert bootstrap._is_authentication_failure(exc) is True
    assert bootstrap._is_missing_database(exc) is False


def test_a_generic_connection_failure_is_classified_as_neither(monkeypatch):
    import app.db.bootstrap as bootstrap

    exc = _operational_error("connection refused")
    assert bootstrap._is_missing_database(exc) is False
    assert bootstrap._is_authentication_failure(exc) is False


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
            return _down()
        return True

    monkeypatch.setattr(bootstrap, "_database_exists", flaky)
    monkeypatch.setattr(bootstrap, "time", FakeClock())

    with caplog.at_level(logging.DEBUG, logger="app.db.bootstrap"):
        assert bootstrap._database_exists_once_reachable() is True

    levels = [record.levelname for record in caplog.records]
    assert levels == ["WARNING", "WARNING"]
    assert "attempt 1" in caplog.records[0].getMessage()
    assert "retrying in 1s" in caplog.records[0].getMessage()


def test_an_authentication_failure_is_not_retried(monkeypatch):
    """Bad credentials will never fix themselves, so don't spend the budget.

    Mirrors test_the_budget_is_spent_in_full_and_never_overrun, which proves a
    transient failure DOES retry for the full 300s — this proves a credentials
    failure does NOT: it must fail on the very first attempt, with no sleep.
    """
    import app.db.bootstrap as bootstrap

    def bad_credentials() -> bool:
        raise bootstrap.DatabaseAuthenticationError(_operational_error("irrelevant"))

    clock = FakeClock()
    monkeypatch.setattr(bootstrap, "_database_exists", bad_credentials)
    monkeypatch.setattr(bootstrap, "time", clock)

    with pytest.raises(DatabaseAuthenticationError):
        bootstrap._database_exists_once_reachable()

    assert clock.slept == []


def test_the_delays_grow_and_then_hold_at_the_cap(monkeypatch):
    """Growth alone is not enough; the cap is what bounds the overshoot.

    Doubling uncapped would put a single 256-second wait inside a five-minute
    budget, leaving a database that recovered at second 40 unnoticed until 256.
    """
    import app.db.bootstrap as bootstrap

    delays = bootstrap._retry_delays()
    assert [next(delays) for _ in range(8)] == [1, 2, 4, 8, 16, 30, 30, 30]


def test_the_budget_is_spent_in_full_and_never_overrun(monkeypatch):
    """The last wait is trimmed so the final attempt lands on the deadline."""
    import app.db.bootstrap as bootstrap

    clock = FakeClock()
    monkeypatch.setattr(bootstrap, "_database_exists", _down)
    monkeypatch.setattr(bootstrap, "time", clock)

    with pytest.raises(DatabaseUnreachableError):
        bootstrap._database_exists_once_reachable()

    assert clock.slept == [1, 2, 4, 8, 16] + [30] * 8 + [29]
    assert sum(clock.slept) == bootstrap.CONNECT_BUDGET_SECONDS


def test_it_reaches_far_enough_for_the_cold_start_that_defeated_the_old_budget(monkeypatch):
    """The regression under test: the old ~18s reach missed by 260 milliseconds.

    Nothing here asserts 300 seconds specifically — the point is that the budget
    outlasts a cold start by a wide margin rather than by a coin flip.
    """
    import app.db.bootstrap as bootstrap

    clock = FakeClock()
    ready_at = 60.0

    def up_after_a_cold_start() -> bool:
        if clock.now < ready_at:
            return _down()
        return True

    monkeypatch.setattr(bootstrap, "_database_exists", up_after_a_cold_start)
    monkeypatch.setattr(bootstrap, "time", clock)

    assert bootstrap._database_exists_once_reachable() is True
    assert clock.now < bootstrap.CONNECT_BUDGET_SECONDS


def test_giving_up_raises_so_the_caller_can_log_one_error(monkeypatch):
    """Exhausting the budget is the only thing that deserves an ERROR."""
    import app.db.bootstrap as bootstrap

    monkeypatch.setattr(bootstrap, "_database_exists", _down)
    monkeypatch.setattr(bootstrap, "time", FakeClock())

    with pytest.raises(DatabaseUnreachableError) as excinfo:
        bootstrap._database_exists_once_reachable()

    assert excinfo.value.attempts == 15
    assert excinfo.value.elapsed == 300.0


def test_the_error_reports_measured_time_rather_than_a_computed_product(monkeypatch, caplog):
    """`attempts × interval` stopped being the elapsed time when delays varied.

    Fifteen attempts here span 300 seconds, not 15 × any constant, so a line
    that multiplies would report a number that never happened.
    """
    import app.db.bootstrap as bootstrap

    monkeypatch.setattr(bootstrap, "_database_exists", _down)
    monkeypatch.setattr(bootstrap, "time", FakeClock())
    monkeypatch.setattr(bootstrap, "setup_logging", lambda **kwargs: None)

    with caplog.at_level(logging.ERROR, logger="app.db.bootstrap"):
        with pytest.raises(SystemExit):
            bootstrap.main()

    errors = [record for record in caplog.records if record.levelname == "ERROR"]
    assert len(errors) == 1
    assert "15 attempts over 300s" in errors[0].getMessage()


def test_main_exits_non_zero_when_the_budget_is_exhausted(monkeypatch):
    """The restart policy is the outer loop, and it needs a failing exit code."""
    import app.db.bootstrap as bootstrap

    monkeypatch.setattr(bootstrap, "_database_exists", _down)
    monkeypatch.setattr(bootstrap, "time", FakeClock())
    monkeypatch.setattr(bootstrap, "setup_logging", lambda **kwargs: None)

    with pytest.raises(SystemExit) as excinfo:
        bootstrap.main()

    assert excinfo.value.code == 1


def test_main_reports_bad_credentials_instead_of_a_server_that_never_came_up(monkeypatch, caplog):
    """The wrong error message here sends troubleshooting at the wrong system.

    A misclassified auth failure used to burn the full 300s and then log
    "server unreachable" — pointing at Postgres/network when the fix was
    always in the .env. This must fail on the first attempt, with no WARNING
    retries, and say to check the credentials.
    """
    import app.db.bootstrap as bootstrap

    def bad_credentials() -> bool:
        raise bootstrap.DatabaseAuthenticationError(
            _operational_error('FATAL:  password authentication failed for user "cadutrack"')
        )

    monkeypatch.setattr(bootstrap, "_database_exists", bad_credentials)
    monkeypatch.setattr(bootstrap, "time", FakeClock())
    monkeypatch.setattr(bootstrap, "setup_logging", lambda **kwargs: None)

    with caplog.at_level(logging.DEBUG, logger="app.db.bootstrap"):
        with pytest.raises(SystemExit) as excinfo:
            bootstrap.main()

    assert excinfo.value.code == 1
    assert [record.levelname for record in caplog.records] == ["ERROR"]
    assert "DB_USER/DB_PASSWORD" in caplog.records[0].getMessage()
