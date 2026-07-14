from fastapi import APIRouter, Query
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from fastapi import Depends

from app.api.deps import get_db
from app.models.property import Property
from app.schemas.property import PropertyOut

router = APIRouter()


@router.get("/")
def search_properties(
    q: str = Query(default="", description="Search keyword"),
    area: str | None = Query(default=None),
    city: str | None = Query(default=None),
    min_price: float | None = Query(default=None),
    max_price: float | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Search properties with optional filters."""
    filters = [Property.status == "Published"]

    if q:
        filters.append(
            (Property.title.ilike(f"%{q}%")) | (Property.description.ilike(f"%{q}%"))
        )
    if area:
        filters.append(Property.area.ilike(f"%{area}%"))
    if city:
        filters.append(Property.city.ilike(f"%{city}%"))
    if min_price is not None:
        filters.append(Property.monthly_rent >= min_price)
    if max_price is not None:
        filters.append(Property.monthly_rent <= max_price)

    stmt = select(Property).order_by(Property.id.desc()).limit(limit)
    if filters:
        stmt = stmt.where(and_(*filters))

    results = db.scalars(stmt).all()
    return {
        "query": q,
        "area": area,
        "city": city,
        "count": len(results),
        "results": [PropertyOut.model_validate(item).model_dump() for item in results],
    }
