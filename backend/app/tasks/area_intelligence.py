"""Area-intelligence data refresh — fetches nearby-place data for a district
and recomputes its scores. Runs on the `data_ingestion` queue (see
app/core/celery_app.py) since it's an external-API-backed ingestion job, not
a user-facing request.
"""
import logging

from app.core.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.area_intelligence import AreaIntelligence

logger = logging.getLogger("app.tasks.area_intelligence")


@celery_app.task(
    name="app.tasks.area_intelligence.refresh_district",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    max_retries=3,
)
def refresh_district(self, area_intelligence_id: int) -> bool:
    """Refresh one district's intelligence scores. Idempotent: always
    recomputes from scratch and overwrites, so a retry after a partial
    failure (e.g. the places API timed out midway) is safe."""
    from app.jobs.refresh_area_intelligence import _refresh_district

    db = SessionLocal()
    try:
        row = db.get(AreaIntelligence, area_intelligence_id)
        if not row or row.center_lat is None:
            logger.warning("refresh_district(%s): not found or missing coordinates, skipping", area_intelligence_id)
            return False
        _refresh_district(row, db)
        return True
    finally:
        db.close()
