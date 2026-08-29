import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.logging_config import setup_logging
from app.routers import categories, health, products

# Configure structured logging before anything else emits a record.
setup_logging(
    timezone=settings.timezone,
    log_file=settings.log_file or None,
    level=settings.log_level,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="CaduTrack", version="0.1.0")

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

logger.info("CaduTrack API started")
