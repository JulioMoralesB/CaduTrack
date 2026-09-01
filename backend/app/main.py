import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.logging_config import setup_logging
from app.routers import alerts, categories, health, products, vision
from app.routers import settings as settings_router
from app.scheduler import shutdown_scheduler, start_scheduler

# Configure structured logging before anything else emits a record.
setup_logging(
    timezone=settings.timezone,
    log_file=settings.log_file or None,
    level=settings.log_level,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Run the daily alert job for as long as the API is up."""
    start_scheduler()
    try:
        yield
    finally:
        shutdown_scheduler()


app = FastAPI(title="CaduTrack", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(categories.router)
app.include_router(products.router)
app.include_router(alerts.router)
app.include_router(settings_router.router)
app.include_router(vision.router)

logger.info("CaduTrack API started")
