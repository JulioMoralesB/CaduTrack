"""Configuration and structured-logging tests."""

import io
import json
import logging

import pytest

from app.config import Settings
from app.logging_config import SERVICE_NAME, _AccessLogFilter, _JsonFormatter, configure_framework_loggers


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


def test_database_url_env_var_overrides_the_parts():
    """See #56: compose.yaml sets this to point at the bundled Postgres it
    also brings up, and it is also how someone points at a different
    instance entirely — a shared one, say — without a code change."""
    settings = Settings(DATABASE_URL="postgresql+psycopg://someone:else@elsewhere:5432/db", db_user="julio")
    assert settings.database_url == "postgresql+psycopg://someone:else@elsewhere:5432/db"


def test_database_url_env_var_gets_the_psycopg_driver_even_when_bare():
    """A bare "postgresql://" is what every DATABASE_URL convention outside
    this repo actually uses — SQLAlchemy would otherwise reach for psycopg2,
    which this app does not install."""
    settings = Settings(DATABASE_URL="postgresql://someone:else@elsewhere:5432/db")
    assert settings.database_url == "postgresql+psycopg://someone:else@elsewhere:5432/db"


def test_database_url_env_var_already_naming_the_driver_is_left_alone():
    settings = Settings(DATABASE_URL="postgresql+psycopg://someone:else@elsewhere:5432/db")
    assert settings.database_url == "postgresql+psycopg://someone:else@elsewhere:5432/db"


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


def _access_record(status: int, path: str = "/products") -> logging.LogRecord:
    """A record shaped like the one uvicorn's access logger emits."""
    return logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("172.19.0.7:36330", "GET", path, "1.1", status),
        exc_info=None,
    )


@pytest.mark.parametrize(
    "status,expected",
    [(200, "INFO"), (201, "INFO"), (304, "INFO"), (404, "WARNING"), (422, "WARNING"), (500, "ERROR"), (503, "ERROR")],
)
def test_access_log_severity_follows_the_status_code(status, expected):
    """Uvicorn logs every request at INFO, so a 500 would hide among the 200s."""
    record = _access_record(status)

    _AccessLogFilter().filter(record)

    assert record.levelname == expected


def test_access_log_gains_queryable_fields():
    record = _access_record(200, "/products?location=pantry&category_id=3")

    _AccessLogFilter().filter(record)

    assert record.http_status == 200
    assert record.http_method == "GET"
    # Query string dropped so grouping by endpoint is not fragmented.
    assert record.http_path == "/products"


def test_access_filter_leaves_unfamiliar_records_alone():
    """Guard against mangling records if uvicorn changes its access log shape."""
    record = logging.LogRecord(
        name="uvicorn.access", level=logging.INFO, pathname=__file__, lineno=1,
        msg="something else entirely", args=(), exc_info=None,
    )

    _AccessLogFilter().filter(record)

    assert record.levelname == "INFO"
    assert not hasattr(record, "http_status")


def test_uvicorn_and_alembic_loggers_route_through_our_handlers():
    """Half the output used to leave as plain text because these had their own."""
    for name in ("uvicorn", "uvicorn.access", "alembic"):
        logging.getLogger(name).addHandler(logging.StreamHandler())

    configure_framework_loggers()

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "alembic"):
        logger = logging.getLogger(name)
        assert logger.handlers == [], f"{name} still has its own handler"
        assert logger.propagate is True, f"{name} does not propagate"


def test_the_ansi_copy_uvicorn_attaches_is_dropped():
    """uvicorn passes color_message with escape codes; it is noise in a log store."""
    formatter = _JsonFormatter(fmt="%(message)s")
    record = logging.LogRecord(
        name="uvicorn.error", level=logging.INFO, pathname=__file__, lineno=1,
        msg="Started server process [1]", args=(), exc_info=None,
    )
    record.color_message = "Started server process [\x1b[36m%d\x1b[0m]"

    assert "color_message" not in json.loads(formatter.format(record))


def test_the_http_client_cannot_publish_the_bot_token():
    """Regression guard for #64.

    httpx logs every request URL at INFO, and the Telegram Bot API carries the
    token in the path — so a delivered alert used to write the credential into
    the log store. Nothing in this service's own code had to be wrong for that
    to happen, which is why it needs a test rather than care.

    Captured through a handler attached here rather than via capsys: the real
    handler holds the stderr it was given at setup, which pytest's capture does
    not intercept — an earlier version of this test passed with the fix removed.
    """
    configure_framework_loggers()

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(_JsonFormatter(fmt="%(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    previous_level = root.level
    root.setLevel(logging.DEBUG)

    # Built by concatenation, and never pasted as a literal. The value only
    # has to carry the *shape* of a bot token for this test to mean anything,
    # and a real one here would be published by the very test that exists to
    # keep it out of the logs. See CLAUDE.md.
    token_shaped_value = "1234567890:" + "A" * 35
    try:
        logging.getLogger("httpx").info(
            'HTTP Request: POST https://api.telegram.org/bot%s/sendMessage "HTTP/1.1 200 OK"',
            token_shaped_value,
        )
        logging.getLogger("httpcore").info("connect_tcp.started host='api.telegram.org'")
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)

    assert token_shaped_value not in stream.getvalue()
    # The mechanism, asserted directly: the record is never created at all.
    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)


def test_a_real_problem_from_the_http_client_still_gets_through():
    """Silencing INFO must not silence failures."""
    configure_framework_loggers()

    assert logging.getLogger("httpx").isEnabledFor(logging.WARNING)
    assert logging.getLogger("httpx").isEnabledFor(logging.ERROR)
