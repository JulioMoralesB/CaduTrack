"""Database bootstrap tests."""

import pytest
from sqlalchemy import create_engine, text

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
