"""SQLAlchemy engine and session management."""

import logging
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
    connect_args={
        "connect_timeout": settings.db_connect_timeout,
        # Pin the schema at connection setup rather than with a SET statement.
        # apollo-server-db is shared, so we never rely on the default
        # search_path — and a SET issued from a "connect" event runs inside a
        # transaction that SQLAlchemy later rolls back, silently losing it.
        "options": f"-c search_path={settings.db_schema},public",
    },
)


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_connection() -> bool:
    """Return True when the database answers a trivial query.

    Used by the /health endpoint so monitoring can tell a live service with a
    dead database apart from a service that is down entirely.
    """
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError as exc:
        # /health is polled continuously, so log a one-line reason rather than a
        # full traceback — otherwise every probe floods the log store while the
        # database is down.
        logger.error("Database health check failed: %s", exc.__class__.__name__)
        logger.debug("Database health check traceback", exc_info=exc)
        return False
