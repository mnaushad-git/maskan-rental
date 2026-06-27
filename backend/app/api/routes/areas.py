from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.property import Property

router = APIRouter()


@router.get("/")
def list_areas(db: Session = Depends(get_db)):
    """Return all rental areas derived from Published listings."""
    stmt = (
        select(
            Property.area.label("name"),
            Property.city.label("city"),
            func.count(Property.id).label("property_count"),
            func.avg(Property.monthly_rent).label("average_rent"),
        )
        .where(Property.status == "Published")
        .group_by(Property.area, Property.city)
        .order_by(func.count(Property.id).desc())
    )
    rows = db.execute(stmt).all()
    return [
        {
            "name": row.name,
            "city": row.city,
            "property_count": int(row.property_count),
            "average_rent": float(row.average_rent) if row.average_rent is not None else 0,
        }
        for row in rows
    ]


@router.get("/{area_id}")
def get_area(area_id: str, db: Session = Depends(get_db)):
    """Return details for a specific area."""
    stmt = select(Property).where(Property.area.ilike(area_id)).order_by(Property.id.desc()).limit(50)
    properties = db.scalars(stmt).all()
    if not properties:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Area not found")

    avg_rent = sum(p.monthly_rent for p in properties) / len(properties)
    return {
        "name": properties[0].area,
        "property_count": len(properties),
        "average_rent": avg_rent,
        "sample_properties": [
            {"id": p.id, "title": p.title, "city": p.city, "monthly_rent": p.monthly_rent}
            for p in properties
        ],
    }
