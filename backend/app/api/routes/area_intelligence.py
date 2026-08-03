from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.cache import CacheService
from app.core.jobs import enqueue
from app.models.area_intelligence import AreaIntelligence
from app.models.user import User
from app.schemas.area_intelligence import AreaIntelligenceOut, AreaIntelligenceSummary, AreaIntelligenceUpdate
from app.tasks.area_intelligence import refresh_district

router = APIRouter()

_CACHE_NAMESPACE = "area-intel"
_CACHE_TTL_SECONDS = 3600  # data only changes via admin PATCH or the nightly refresh job


def _invalidate_area_cache(area_name: str, city: str | None) -> None:
    cache = CacheService()
    cache.delete(_CACHE_NAMESPACE, "list")
    cache.delete(f"{_CACHE_NAMESPACE}-detail", f"{area_name.lower()}:{(city or '').lower()}")


@router.get("/intelligence", response_model=list[AreaIntelligenceSummary])
def list_area_intelligence(db: Session = Depends(get_db)):
    """All tracked districts — lightweight summary for the /areas table."""
    cache = CacheService()

    def _load():
        rows = db.query(AreaIntelligence).order_by(AreaIntelligence.area_name).all()
        return [AreaIntelligenceSummary.model_validate(r, from_attributes=True).model_dump(mode="json") for r in rows]

    return cache.get_or_set(_CACHE_NAMESPACE, "list", _CACHE_TTL_SECONDS, _load)


@router.get("/{area_name}/intelligence", response_model=AreaIntelligenceOut)
def get_area_intelligence(area_name: str, city: str | None = None, db: Session = Depends(get_db)):
    """Full intelligence data for one district, including schools and hospitals."""
    cache = CacheService()
    cache_key = f"{area_name.lower()}:{(city or '').lower()}"

    def _load():
        q = db.query(AreaIntelligence).filter(AreaIntelligence.area_name.ilike(area_name))
        if city:
            q = q.filter(AreaIntelligence.city.ilike(city))
        row = q.first()
        if not row:
            return None
        return AreaIntelligenceOut.model_validate(row, from_attributes=True).model_dump(mode="json")

    cached = cache.get_or_set(f"{_CACHE_NAMESPACE}-detail", cache_key, _CACHE_TTL_SECONDS, _load)
    if cached is None:
        raise HTTPException(status_code=404, detail=f"No intelligence data found for '{area_name}'")
    return cached


@router.patch("/{area_name}/intelligence", response_model=AreaIntelligenceOut)
def update_area_intelligence(
    area_name: str,
    body: AreaIntelligenceUpdate,
    city: str | None = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin: manually update overview, tags, rent_trend, market_notes, or coordinates."""
    q = db.query(AreaIntelligence).filter(AreaIntelligence.area_name.ilike(area_name))
    if city:
        q = q.filter(AreaIntelligence.city.ilike(city))
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"No intelligence data found for '{area_name}'")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    _invalidate_area_cache(row.area_name, row.city)
    return row


@router.post("/{area_name}/intelligence/refresh")
def refresh_area_intelligence(
    area_name: str,
    city: str | None = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin: trigger an on-demand area intelligence data refresh for one district."""
    q = db.query(AreaIntelligence).filter(AreaIntelligence.area_name.ilike(area_name))
    if city:
        q = q.filter(AreaIntelligence.city.ilike(city))
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"No intelligence data found for '{area_name}'")
    if row.center_lat is None or row.center_lng is None:
        raise HTTPException(status_code=400, detail="Cannot refresh: district coordinates (center_lat, center_lng) not set. Update them first via PATCH.")

    enqueue(refresh_district, row.id)
    return {"status": "refresh_queued", "area_name": row.area_name, "city": row.city}
