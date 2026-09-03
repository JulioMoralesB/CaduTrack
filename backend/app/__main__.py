"""Run the API server.

Started this way rather than via the `uvicorn` CLI so logging is configured
before uvicorn is, and so uvicorn can be told not to install its own handlers.
The CLI applies its dictConfig before importing the application, which is why
its output stayed plain text no matter what the app did afterwards.
"""

from app.config import settings
from app.logging_config import setup_logging


def main() -> None:
    setup_logging(
        timezone=settings.timezone,
        log_file=settings.log_file or None,
        level=settings.log_level,
    )

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        # See config.py's own comment: only set in the container, where
        # nginx actually proxies under this prefix.
        root_path=settings.api_root_path,
        # log_config=None leaves the loggers alone, so uvicorn's records
        # propagate to the root handler set up above.
        log_config=None,
        access_log=True,
    )


if __name__ == "__main__":
    main()
