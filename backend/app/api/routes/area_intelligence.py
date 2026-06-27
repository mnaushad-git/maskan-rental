from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.models.area_intelligence import AreaIntelligence
from app.models.user import User
from app.schemas.area_intelligence import AreaIntelligenceOut, AreaIntelligenceSummary, AreaIntelligenceUpdate

router = APIRouter()


@router.get("/intelligence", response_model=list[AreaIntelligenceSummary])
def list_area_intelligence(db: Session = Depends(get_db)):
    """All tracked districts — lightweight summary for the /areas table."""
    return db.query(AreaIntelligence).order_by(AreaIntelligence.area_name).all()


@router.get("/{area_name}/intelligence", response_model=AreaIntelligenceOut)
def get_area_intelligence(area_name: str, city: str | None = None, db: Session = Depends(get_db)):
    """Full intelligence data for one district, including schools and hospitals."""
    q = db.query(AreaIntelligence).filter(AreaIntelligence.area_name.ilike(area_name))
    if city:
        q = q.filter(AreaIntelligence.city.ilike(city))
    row = q.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"No intelligence data found for '{area_name}'")
    return row


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
    return row


@router.post("/{area_name}/intelligence/refresh")
def refresh_area_intelligence(
    area_name: str,
    background_tasks: BackgroundTasks,
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

    from app.jobs.refresh_area_intelligence import refresh_single_district
    background_tasks.add_task(refresh_single_district, row.id)
    return {"status": "refresh_queued", "area_name": row.area_name, "city": row.city}
