import logging

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db

logger = logging.getLogger("app.health")

router = APIRouter()


@router.get("")
@router.get("/")
def health_check():
    """Liveness — process is up. No external dependency checks (must stay cheap
    and always fast, so load balancers/orchestrators can call it frequently)."""
    return {"status": "ok"}


@router.get("/ready")
def readiness_check(response: Response, db: Session = Depends(get_db)):
    """Readiness — safe to receive traffic. Checks the dependencies the app
    actually needs to serve a request (currently just Postgres)."""
    checks: dict[str, str] = {}
    healthy = True

    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 — readiness probes must never raise
        logger.warning("Readiness check: database unavailable: %s", exc)
        checks["database"] = "error"
        healthy = False

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if healthy else "not_ready", "checks": checks}
