"""Create the service's database on first start.

Alembic creates the schema; nothing creates the database that holds it. Without
this the container crash-loops on a fresh server until someone runs
CREATE DATABASE by hand.

The maintenance database is only touched when it is actually needed: if the
configured database already exists — the case on every start after the first —
this connects to it, finds it healthy and returns. That keeps a least-privilege
role viable, since the common path needs no rights beyond the app's own.
"""

import logging
import re
import sys
import time
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.config import settings
from app.logging_config import setup_logging

logger = logging.getLogger("app.db.bootstrap")

# On a shared Docker network the database container is often still starting when
# this runs — the nightly backup restarts everything at once. Waiting is the
# correct response, and it has to happen here: without it the process exits, the
# entrypoint's `set -e` stops the container, and the restart policy brings it
# back to try again. That worked, but it turned a five-second wait into four
# crashed starts, each logging an ERROR that no alert can distinguish from a
# real failure.
#
# The budget is bounded by elapsed time rather than by a count of attempts,
# because the question it answers is "how long may a cold start take", not "how
# many times should we ask". Five minutes clears any plausible one: the nightly
# backup stops Postgres after a full day of writes, so recovery replays WAL
# while a dozen other containers compete for the same disk. It costs nothing
# when the database is up — the budget is only spent while it is not — and it
# still leaves ERROR meaning a database that really is gone, which is the whole
# point of keeping the level.
#
# Delays grow 1, 2, 4, 8, 16 and then hold at 30. The cap earns its place as
# much as the growth does: doubling uncapped to five minutes would put a single
# 256-second wait in the middle, so a database that came back at second 40 would
# go unnoticed until second 256.
CONNECT_BUDGET_SECONDS = 300.0
FIRST_RETRY_SECONDS = 1.0
MAX_RETRY_SECONDS = 30.0


class DatabaseUnreachableError(RuntimeError):
    """The connect budget was spent without the server ever answering.

    Carries the measured attempt count and elapsed time so the caller reports
    what happened instead of deriving it from the constants. With delays that
    vary, attempts × interval is not the elapsed time, and a log line that
    computes one is simply wrong.
    """

    def __init__(self, attempts: int, elapsed: float, last_error: Exception) -> None:
        super().__init__(f"Database unreachable after {attempts} attempts over {elapsed:.0f}s")
        self.attempts = attempts
        self.elapsed = elapsed
        self.last_error = last_error


class DatabaseAuthenticationError(RuntimeError):
    """The server answered but rejected our credentials.

    Raised immediately instead of joining the retry loop: waiting cannot turn a
    wrong DB_USER or DB_PASSWORD into a right one, and retrying it for the full
    connect budget would misreport a credentials problem as the server being
    down.
    """

    def __init__(self, cause: OperationalError) -> None:
        super().__init__(f"Database rejected our credentials, check DB_USER/DB_PASSWORD: {cause}")


# psycopg does not attach a SQLSTATE to failures raised during connection setup
# (auth happens before the wire protocol can hand back a typed exception) — the
# server's message text is the only signal available. Verified against a live
# Postgres 16: an unknown role or wrong password produces "password
# authentication failed for user ..." under the default scram/md5 auth, or
# "role ... does not exist" under trust/peer auth; a missing database produces
# "database ... does not exist". The two must not be confused: the first is
# never worth retrying, the second always is.
_DATABASE_MISSING_RE = re.compile(r'database "[^"]*" does not exist')
_AUTH_FAILURE_RE = re.compile(r'password authentication failed|role "[^"]*" does not exist')


def _is_missing_database(exc: OperationalError) -> bool:
    """True when the server answered but the configured database isn't there."""
    return bool(_DATABASE_MISSING_RE.search(str(exc)))


def _is_authentication_failure(exc: OperationalError) -> bool:
    """True when the server rejected our credentials rather than being down."""
    return bool(_AUTH_FAILURE_RE.search(str(exc)))


def _database_exists() -> bool:
    """True when the configured database can be connected to."""
    engine = create_engine(
        settings.database_url,
        connect_args={"connect_timeout": settings.db_connect_timeout},
    )
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except OperationalError as exc:
        if _is_missing_database(exc):
            return False
        if _is_authentication_failure(exc):
            raise DatabaseAuthenticationError(exc) from exc
        raise
    finally:
        engine.dispose()


def _retry_delays() -> Iterator[float]:
    """The wait before each retry: 1, 2, 4, 8, 16, 30, 30, … seconds."""
    delay = FIRST_RETRY_SECONDS
    while True:
        yield delay
        delay = min(delay * 2, MAX_RETRY_SECONDS)


def _database_exists_once_reachable() -> bool:
    """Wait for the database server, then report whether our database is there.

    Intermediate attempts are WARNING, not ERROR: they are worth seeing and they
    are not failures. Only exhausting the budget is an error, and the caller
    logs exactly one line for it.
    """
    started = time.monotonic()
    delays = _retry_delays()
    attempt = 0

    while True:
        attempt += 1
        try:
            return _database_exists()
        except OperationalError as exc:
            elapsed = time.monotonic() - started
            remaining = CONNECT_BUDGET_SECONDS - elapsed
            if remaining <= 0:
                raise DatabaseUnreachableError(attempt, elapsed, exc) from exc

            # Never sleep past the budget: trimming the last wait puts the final
            # attempt on the deadline rather than beyond it.
            delay = min(next(delays), remaining)
            logger.warning(
                "Database server not reachable yet (attempt %d, %.0fs of %.0fs), retrying in %.0fs",
                attempt,
                elapsed,
                CONNECT_BUDGET_SECONDS,
                delay,
            )
            time.sleep(delay)


def _maintenance_url() -> str:
    """The same connection, pointed at the default `postgres` database."""
    return settings.database_url.rsplit("/", 1)[0] + "/postgres"


def ensure_database_exists() -> None:
    """Create the configured database if it is missing."""
    if _database_exists_once_reachable():
        logger.info("Database %r is present", settings.db_name)
        return

    logger.info("Database %r not found, creating it", settings.db_name)
    engine = create_engine(
        _maintenance_url(),
        # CREATE DATABASE cannot run inside a transaction.
        isolation_level="AUTOCOMMIT",
        connect_args={"connect_timeout": settings.db_connect_timeout},
    )
    try:
        with engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{settings.db_name}"'))
        logger.info("Created database %r", settings.db_name)
    except ProgrammingError as exc:
        message = str(exc)
        if "already exists" in message or "42P04" in message:
            # Another container won the race. Nothing to do.
            logger.info("Database %r was created concurrently", settings.db_name)
            return
        if "permission denied" in message or "42501" in message:
            logger.error(
                "User %r may not create databases. Create it manually and restart:\n"
                '    CREATE DATABASE "%s";',
                settings.db_user,
                settings.db_name,
            )
            raise SystemExit(1) from exc
        raise
    finally:
        engine.dispose()


def main() -> None:
    """Entry point for `python -m app.db.bootstrap`."""
    setup_logging(
        timezone=settings.timezone,
        log_file=settings.log_file or None,
        level=settings.log_level,
    )
    try:
        ensure_database_exists()
    except DatabaseUnreachableError as exc:
        # The one ERROR this module may emit: the wait was exhausted and the
        # service genuinely cannot start. Both numbers are measured.
        logger.error(
            "Database server unreachable after %d attempts over %.0fs: %s",
            exc.attempts,
            exc.elapsed,
            exc.last_error.__class__.__name__,
        )
        sys.exit(1)
    except DatabaseAuthenticationError as exc:
        # Fails on the first attempt, not after the budget: the server was
        # reachable the whole time, so this must not be read as it being down.
        logger.error("%s", exc)
        sys.exit(1)
    except OperationalError as exc:
        # Only reachable from the CREATE DATABASE path, which runs after the
        # server has already answered once. Worded so it cannot be read as the
        # server being down, because it is not.
        logger.error("Database bootstrap could not connect: %s", exc.__class__.__name__)
        sys.exit(1)


if __name__ == "__main__":
    main()
