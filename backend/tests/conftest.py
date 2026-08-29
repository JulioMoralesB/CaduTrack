"""Shared pytest fixtures."""

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

    from app.db.session import SessionLocal, check_connection

    if not check_connection():
        pytest.skip("no reachable database")

    session = SessionLocal()
    session.execute(text("TRUNCATE products, categories RESTART IDENTITY CASCADE"))
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
