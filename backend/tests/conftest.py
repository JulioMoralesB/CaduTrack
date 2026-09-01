"""Shared pytest fixtures."""

import os

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    """FastAPI test client with no database wiring."""
    return TestClient(app)


@pytest.fixture
def db_session():
    """Session against a live database, skipping when one is not reachable.

    Tables are emptied before each test rather than after, so a failing test
    leaves its rows behind for inspection.

    Used by tests marked `integration`.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import SQLAlchemyError

    from app.config import settings
    from app.db.session import SessionLocal, check_connection

    # This fixture TRUNCATEs. Pointing it at a real database — a developer's
    # own instance, or worse the server's — destroys data, and nothing in the
    # command makes that obvious. Refuse loudly unless the target is clearly
    # disposable.
    if not settings.db_name.endswith("_test") and os.getenv("PYTEST_ALLOW_DESTRUCTIVE") != "1":
        pytest.fail(
            f"Refusing to TRUNCATE {settings.db_name!r}: integration tests wipe the "
            "products and categories tables.\n"
            "Point DB_NAME at a disposable database whose name ends in '_test' "
            "(the API creates it on first start), or set PYTEST_ALLOW_DESTRUCTIVE=1 "
            "if you really mean this one.",
            pytrace=False,
        )

    if not check_connection():
        pytest.skip("no reachable database")

    session = SessionLocal()
    session.execute(
        text(
            "TRUNCATE products, categories, alert_settings, icon_settings, icon_name_cache, "
            "shopping_trips, shopping_trip_items "
            "RESTART IDENTITY CASCADE"
        )
    )
    session.commit()
    try:
        yield session
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()


@pytest.fixture
def api_client(db_session) -> TestClient:
    """Test client whose requests share the test's database session."""
    from app.db.session import get_db

    app.dependency_overrides[get_db] = lambda: db_session
    yield TestClient(app)
    app.dependency_overrides.clear()
