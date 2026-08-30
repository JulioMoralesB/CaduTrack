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
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.config import settings
from app.logging_config import setup_logging

logger = logging.getLogger("app.db.bootstrap")


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
        # psycopg maps SQLSTATE 3D000 (invalid_catalog_name) to this; anything
        # else is a genuine connection problem the caller should see.
        if "3D000" in str(exc) or "does not exist" in str(exc):
            return False
        raise
    finally:
        engine.dispose()


def _maintenance_url() -> str:
    """The same connection, pointed at the default `postgres` database."""
    return settings.database_url.rsplit("/", 1)[0] + "/postgres"


def ensure_database_exists() -> None:
    """Create the configured database if it is missing."""
    if _database_exists():
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
    except OperationalError as exc:
        logger.error("Could not reach the database server: %s", exc.__class__.__name__)
        sys.exit(1)


if __name__ == "__main__":
    main()
