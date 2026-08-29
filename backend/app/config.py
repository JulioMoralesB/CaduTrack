"""
Application configuration for CaduTrack.

Values are read from environment variables (and a local .env file during
development). See .env.example for the full documented list.

Unlike the other apollo-server services, which parse os.getenv by hand, this one
uses pydantic-settings: FastAPI already pulls in Pydantic, and typed settings
give us validation and sane failure messages for free.
"""

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven settings, validated at startup."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ─────────────────────────────────────────────────────────────
    # Points at the shared apollo-server-db instance. CaduTrack owns the
    # database named by db_name and the schema named by db_schema inside it.
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "cadutrack"
    db_user: str = "postgres"
    db_password: str = ""
    db_schema: str = "cadutrack"
    # Seconds to wait for a connection before giving up. Kept short so the
    # /health probe fails fast instead of hanging the monitoring check.
    db_connect_timeout: int = Field(default=5, ge=1)

    # ── API ──────────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    # Not 8000: free-games-notifier already publishes that port on the host.
    api_port: int = 8001
    # When set, mutating endpoints require this value in the X-API-Key header.
    api_key: str = ""
    # Origins allowed to call the API from a browser (comma-separated in .env).
    cors_origins: str = "http://localhost:5173"

    # ── Alerts ───────────────────────────────────────────────────────────────
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    # Products expiring within this many days are included in the daily alert.
    alert_days_ahead: int = Field(default=7, ge=1)
    # Daily alert time, HH:MM in TIMEZONE.
    alert_time: str = "08:00"

    # ── Observability ────────────────────────────────────────────────────────
    timezone: str = "UTC"
    log_level: str = "INFO"
    # Absolute path to the rotating log file. Empty means stdout only, which is
    # what you want when running outside Docker.
    log_file: str = ""

    @property
    def database_url(self) -> str:
        """SQLAlchemy connection URL built from the DB_* settings."""
        auth = quote_plus(self.db_user)
        if self.db_password:
            auth = f"{auth}:{quote_plus(self.db_password)}"
        return (
            f"postgresql+psycopg://{auth}@{self.db_host}:{self.db_port}/{quote_plus(self.db_name)}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide Settings instance."""
    return Settings()


settings = get_settings()
