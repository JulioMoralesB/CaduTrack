from fastapi import APIRouter, Response, status

from app.config import settings
from app.db.session import check_connection

router = APIRouter()


@router.get("/health")
async def health(response: Response):
    """Liveness/readiness probe.

    Reports the database separately so monitoring can tell a live service with
    an unreachable database apart from a service that is down entirely.
    """
    database_ok = check_connection()
    if not database_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if database_ok else "degraded",
        "database": "ok" if database_ok else "unavailable",
        "version": settings.app_version,
    }
