"""Configuration and structured-logging tests."""

import json
import logging

from app.config import Settings
from app.logging_config import SERVICE_NAME, _JsonFormatter


def test_database_url_is_built_from_parts():
    settings = Settings(
        db_host="apollo-server-db",
        db_port=5432,
        db_name="cadutrack",
        db_user="julio",
        db_password="s3cr3t",
    )
    assert settings.database_url == "postgresql+psycopg://julio:s3cr3t@apollo-server-db:5432/cadutrack"


def test_database_url_escapes_special_characters():
    settings = Settings(db_user="ju lio", db_password="p@ss/word")
    assert "ju+lio:p%40ss%2Fword@" in settings.database_url


def test_database_url_omits_empty_password():
    settings = Settings(db_user="julio", db_password="")
    assert "postgresql+psycopg://julio@" in settings.database_url


def test_cors_origins_are_split_and_trimmed():
    settings = Settings(cors_origins="http://localhost:5173, https://cadutrack.example.com ,")
    assert settings.cors_origin_list == ["http://localhost:5173", "https://cadutrack.example.com"]


def test_log_record_matches_the_shared_json_shape():
    """Logs must carry the fields the shared structured-log contract promotes."""
    formatter = _JsonFormatter(fmt="%(message)s", tz="America/Mexico_City")
    record = logging.LogRecord(
        name="app.routers.products",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="something happened",
        args=(),
        exc_info=None,
    )

    payload = json.loads(formatter.format(record))

    assert payload["level"] == "WARNING"
    assert payload["logger"] == "app.routers.products"
    assert payload["message"] == "something happened"
    assert payload["service"] == SERVICE_NAME
    assert payload["timestamp"].endswith(("-06:00", "-05:00"))
    # Noisy duplicates from the base formatter must not leak through.
    assert not {"asctime", "name", "levelname"} & payload.keys()


def test_unknown_timezone_falls_back_to_utc():
    formatter = _JsonFormatter(fmt="%(message)s", tz="Mars/Olympus_Mons")
    record = logging.LogRecord(
        name="app", level=logging.INFO, pathname=__file__, lineno=1,
        msg="hi", args=(), exc_info=None,
    )
    assert json.loads(formatter.format(record))["timestamp"].endswith("+00:00")
