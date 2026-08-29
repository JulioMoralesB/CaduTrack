"""Shared pytest fixtures."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    """FastAPI test client for the CaduTrack app."""
    return TestClient(app)


@pytest.fixture
def db_session():
    """Session against a live database, skipping when one is not reachable.

    Used by tests marked `integration`; CI excludes that marker.
    """
    from sqlalchemy.exc import SQLAlchemyError

    from app.db.session import SessionLocal, check_connection

    if not check_connection():
        pytest.skip("no reachable database")

    session = SessionLocal()
    try:
        yield session
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()
