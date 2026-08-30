"""
Structured JSON logging configuration for CaduTrack.

Every entry is a single-line JSON object with consistent fields:
  - timestamp : ISO 8601 with timezone offset (e.g. "2026-04-28T10:00:00-06:00")
  - level     : log level string (INFO, WARNING, ERROR, DEBUG)
  - logger    : logger name (e.g. "app.routers.products")
  - message   : the log message
  - service   : always "cadutrack"

That shape is a **contract**, not a integration with one particular tool: the
home server's log pipeline promotes any JSON payload it receives into real,
queryable fields, with no per-service configuration. Emitting this format is the
whole of what CaduTrack has to do to be searchable and filterable by severity.

Deliberately not documented here: which collector and which store consume it.
That has already changed once — this file previously carried a Promtail config
example for a stack retired nineteen days before the file was written — and
naming the tool is exactly what goes stale. The current pipeline is described in
the server documentation, and that is where to look:

    https://server-documentation.apollox10.com

One consequence worth knowing, because it looks like a bug: Python's logging
writes to stderr by default, so a container runtime that infers severity from
the stream marks every line, including INFO, as an error. Severity lives in the
`level` field above, never in the stream.
"""

import logging
import logging.handlers
import os
from datetime import datetime

import pytz

try:
    from pythonjsonlogger.json import JsonFormatter as _JsonFormatterBase  # v3+
except ImportError:
    from pythonjsonlogger.jsonlogger import JsonFormatter as _JsonFormatterBase  # v2

SERVICE_NAME = "cadutrack"


class _JsonFormatter(_JsonFormatterBase):
    """JsonFormatter that adds standard fields and a timezone-aware timestamp."""

    def __init__(self, *args, tz: str = "UTC", **kwargs):
        super().__init__(*args, **kwargs)
        try:
            self._tz = pytz.timezone(tz)
        except pytz.exceptions.UnknownTimeZoneError:
            logging.getLogger(__name__).warning(
                "Unknown timezone %r for log formatter — falling back to UTC.", tz
            )
            self._tz = pytz.utc

    def add_fields(self, log_record: dict, record: logging.LogRecord, message_dict: dict):
        super().add_fields(log_record, record, message_dict)

        # Timezone-aware ISO 8601 timestamp
        log_record["timestamp"] = (
            datetime.fromtimestamp(record.created, tz=pytz.utc)
            .astimezone(self._tz)
            .isoformat()
        )
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["service"] = SERVICE_NAME

        # Remove redundant / noisy fields added by the base formatter
        for key in ("asctime", "name", "levelname"):
            log_record.pop(key, None)


def setup_logging(timezone: str = "UTC", log_file: str | None = None, level: str = "INFO") -> None:
    """
    Configure JSON structured logging for the application.

    Should be called once at startup before any loggers are used.
    Both the rotating file (when available) and stdout receive the same JSON format.

    Unlike the containerised services, CaduTrack is also run bare-metal during
    development, where /mnt/logs does not exist. The file handler is therefore
    attached only when its directory is writable; stdout always works.

    Args:
        timezone: IANA timezone string for log timestamps (e.g. "America/Mexico_City").
        log_file: Absolute path to the rotating log file, or None for stdout only.
        level: Root log level name.
    """
    formatter = _JsonFormatter(fmt="%(message)s", tz=timezone)
    log_level = logging.getLevelNamesMapping().get(level.upper(), logging.INFO)

    handlers: list[logging.Handler] = []

    if log_file:
        try:
            os.makedirs(os.path.dirname(log_file) or ".", exist_ok=True)
            file_handler = logging.handlers.TimedRotatingFileHandler(
                log_file, when="W1", interval=1, backupCount=4
            )
            file_handler.setLevel(log_level)
            file_handler.setFormatter(formatter)
            handlers.append(file_handler)
        except OSError:
            # Log directory unavailable (typical outside Docker) — stdout still covers us.
            pass

    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    root = logging.getLogger()
    root.setLevel(log_level)
    # Only add handlers if none are configured yet (same behaviour as basicConfig without force).
    # This prevents overriding pytest's log capture during test runs.
    if not root.handlers:
        for handler in handlers:
            root.addHandler(handler)
