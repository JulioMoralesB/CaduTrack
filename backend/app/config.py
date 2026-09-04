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
    # CaduTrack owns the database named by db_name and the schema named by
    # db_schema inside it.
    #
    # Set directly by compose.yaml, pointed at the bundled Postgres it also
    # brings up — see #56. Overriding DATABASE_URL in .env points the app at
    # a different instance entirely (a shared one, say) with no code change;
    # the db_* fields below are then only a convenience for running the API
    # directly on your machine, without Docker.
    database_url_override: str | None = Field(default=None, alias="DATABASE_URL")
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
    # Set to "/api" by compose.yaml only — nginx proxies /api/* to this
    # service, stripping the prefix before the request ever reaches here
    # (see frontend/nginx.conf). Without telling FastAPI about that prefix,
    # /api/docs loads fine but its Swagger UI then fetches /openapi.json
    # (absolute, no prefix) for the actual spec — a path nginx does not
    # proxy, so it falls through to the SPA's index.html, which Swagger UI
    # then fails to parse as JSON. Left empty for a direct `uvicorn` run
    # (see the readme's own Getting Started), where there is no proxy and
    # no prefix to account for.
    api_root_path: str = ""
    # One of two ways to satisfy RequireAuthOnMutations (main.py) on a
    # mutating request — the other is a valid Cloudflare Access session,
    # see cf_access_team_domain/cf_access_aud below. Leaving all three of
    # these unset disables the check entirely — see #114 — rather than
    # locking a fresh, unconfigured deployment out of its own product list.
    api_key: str = ""
    # Cloudflare Access team domain (just the subdomain — "apollox10" for
    # apollox10.cloudflareaccess.com, not the full URL) and the target
    # Access Application's own Audience (AUD) tag, from that application's
    # Overview page in the Zero Trust dashboard. Both are required together
    # to validate a request's Cf-Access-Jwt-Assertion header — see #114.
    cf_access_team_domain: str = ""
    cf_access_aud: str = ""
    # A dedicated shared secret for the dashboard summary endpoint — see #93
    # and ADR 012. Deliberately separate from api_key above: unlike the
    # mutation check, unset here does not mean "disabled" — this endpoint
    # sits on a published port with nothing else standing in front of it.
    # See routers/summary.py's own require_summary_api_key.
    summary_api_key: str = ""
    # Origins allowed to call the API from a browser (comma-separated in .env).
    cors_origins: str = "http://localhost:5173"

    # ── Alerts ───────────────────────────────────────────────────────────────
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    # Products expiring within this many days are included in the daily alert.
    alert_days_ahead: int = Field(default=7, ge=1)
    # Daily alert time, HH:MM in TIMEZONE.
    alert_time: str = "08:00"

    # ── Icons ────────────────────────────────────────────────────────────────
    # The homelab's local Ollama instance. Empty disables the model fallback
    # entirely — the local lookup table and the default icon still work,
    # exactly as an unset Telegram token disables alerts rather than erroring.
    # Never a public model API: the whole point is that this stays free and
    # offline-capable, and product names never leave the LAN.
    ollama_url: str = ""
    ollama_model: str = "qwen3.5:4b"

    # ── Observability ────────────────────────────────────────────────────────
    timezone: str = "UTC"
    log_level: str = "INFO"
    # Absolute path to the rotating log file. Empty means stdout only, which is
    # what you want when running outside Docker.
    log_file: str = ""

    # ── Meta ─────────────────────────────────────────────────────────────────
    # The release tag this image was built from, e.g. "v0.11.0" — baked in by
    # the Dockerfile's VERSION build arg, which only the release workflow sets.
    # "dev" everywhere else: a local build, `docker compose up -d --build`,
    # running the app directly. Exposed via /health and /settings so a running
    # instance can be checked against what was actually deployed, rather than
    # assumed — nothing in the UI said which version was running until this.
    app_version: str = "dev"

    @property
    def database_url(self) -> str:
        """SQLAlchemy connection URL — DATABASE_URL verbatim when set,
        otherwise built from the DB_* settings.

        A bare "postgresql://" is rewritten to "postgresql+psycopg://":
        that scheme is what every DATABASE_URL convention outside this repo
        actually uses (Heroku-style envs, other tools' own docs), and
        SQLAlchemy would otherwise reach for psycopg2, which this app does
        not install — see #56, where DATABASE_URL first became something
        someone other than this repo's own compose.yaml might set.
        """
        if self.database_url_override:
            url = self.database_url_override
            if url.startswith("postgresql://"):
                url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
            return url

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
