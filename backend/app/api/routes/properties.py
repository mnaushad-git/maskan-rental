from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.api.deps import get_admin_user, get_db, get_mediator_user, get_optional_admin_user
from app.api.routes.reviews import get_mediator_summary
from app.core.config import settings
from app.core.geo import coords_for
from app.core.metrics import properties_published_total
from app.core.outbox import EventType, record_event
from app.models.booking import Booking
from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User
from app.schemas.property import ListingImageOut, PartnerPropertyCreate, PartnerPropertyUpdate, PropertyCreate, PropertyOut, PropertyUpdate

router = APIRouter()


@router.get("/", response_model=list[PropertyOut])
def list_properties(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=1000),
    area: str | None = Query(default=None),
    city: str | None = Query(default=None),
    mediator_id: int | None = Query(default=None),
    listing_type: str | None = Query(default=None),
    property_type: str | None = Query(default=None),
    furnished: str | None = Query(default=None),
    min_bedrooms: int | None = Query(default=None, ge=0),
    min_bathrooms: int | None = Query(default=None, ge=0),
    min_monthly_rent: float | None = Query(default=None, ge=0),
    max_monthly_rent: float | None = Query(default=None, ge=0),
    min_sale_price: float | None = Query(default=None, ge=0),
    max_sale_price: float | None = Query(default=None, ge=0),
    min_lat: float | None = Query(default=None),
    max_lat: float | None = Query(default=None),
    min_lng: float | None = Query(default=None),
    max_lng: float | None = Query(default=None),
    is_bookable: bool | None = Query(default=None),
    check_in: date | None = Query(default=None),
    check_out: date | None = Query(default=None),
    include_all: bool = Query(default=False),
    admin: User | None = Depends(get_optional_admin_user),
    db: Session = Depends(get_db),
):
    # Build filters first, then paginate — WHERE must be resolved before LIMIT
    filters = []
    if not include_all or admin is None:
        filters.append(Property.status == "Published")
    if area:
        filters.append(Property.area.ilike(f"%{area}%"))
    if city:
        filters.append(Property.city.ilike(f"%{city}%"))
    if mediator_id is not None:
        filters.append(Property.mediator_id == mediator_id)
    if listing_type:
        filters.append(Property.listing_type == listing_type)
    if property_type:
        filters.append(Property.property_type == property_type)
    if furnished:
        filters.append(Property.furnished == furnished)
    if min_bedrooms is not None:
        filters.append(Property.bedrooms >= min_bedrooms)
    if min_bathrooms is not None:
        filters.append(Property.bathrooms >= min_bathrooms)
    if min_monthly_rent is not None:
        filters.append(Property.monthly_rent >= min_monthly_rent)
    if max_monthly_rent is not None:
        filters.append(Property.monthly_rent <= max_monthly_rent)
    if min_sale_price is not None:
        filters.append(Property.sale_price >= min_sale_price)
    if max_sale_price is not None:
        filters.append(Property.sale_price <= max_sale_price)
    if min_lat is not None and max_lat is not None and min_lng is not None and max_lng is not None:
        filters.append(Property.latitude.between(min_lat, max_lat))
        filters.append(Property.longitude.between(min_lng, max_lng))
    if is_bookable is not None:
        filters.append(Property.is_bookable == is_bookable)
    if check_in is not None and check_out is not None:
        # Half-open range overlap ([) — mirrors bookings.py's _overlap_filter
        # so a date-filtered browse list agrees with the actual availability
        # check a renter would run on the property's own detail page.
        conflicting_booking = (
            select(Booking.id)
            .where(
                and_(
                    Booking.property_id == Property.id,
                    Booking.status != "cancelled",
                    Booking.check_in < check_out,
                    Booking.check_out > check_in,
                )
            )
            .exists()
        )
        filters.append(~conflicting_booking)

    total = db.scalar(select(func.count()).select_from(Property).where(*filters)) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = select(Property).where(*filters).order_by(Property.id.desc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.get("/stats")
def property_stats(db: Session = Depends(get_db)):
    count = db.execute(
        select(func.count()).select_from(Property).where(Property.status == "Published")
    ).scalar_one()
    return {"listing_count": int(count)}


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
def bulk_import_properties(
    payload: list[PropertyCreate],
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    inserted = 0
    skipped = 0
    for p in payload:
        if p.external_id:
            exists = db.scalars(
                select(Property).where(Property.external_id == p.external_id)
            ).first()
            if exists:
                skipped += 1
                continue
        prop = Property(**p.model_dump())
        db.add(prop)
        db.flush()
        if prop.latitude is None or prop.longitude is None:
            prop.latitude, prop.longitude = coords_for(prop.area, prop.city, prop.id)
        inserted += 1
    db.commit()
    return {"inserted": inserted, "skipped": skipped, "total": len(payload)}


@router.get("/partner/mine", response_model=list[PropertyOut])
def list_partner_properties(
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    return db.scalars(
        select(Property).where(Property.mediator_id == mediator.id).order_by(Property.id.desc())
    ).all()


@router.post("/partner/", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_partner_property(
    payload: PartnerPropertyCreate,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    data = payload.model_dump()
    if not data.get("license_number"):
        data["license_number"] = mediator.license_number
    prop = Property(
        **data,
        status="Pending Approval",
        mediator_id=mediator.id,
    )
    db.add(prop)
    db.flush()
    prop.latitude, prop.longitude = coords_for(prop.area, prop.city, prop.id)
    record_event(
        db,
        event_type=EventType.PROPERTY_CREATED,
        aggregate_type="property",
        aggregate_id=prop.id,
        payload={"property_id": prop.id, "mediator_id": mediator.id, "status": prop.status},
    )
    db.commit()
    db.refresh(prop)
    return prop


@router.patch("/partner/{property_id}", response_model=PropertyOut)
def update_partner_property(
    property_id: int,
    payload: PartnerPropertyUpdate,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if prop.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    if prop.status != "Published":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only published listings can be edited")

    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(prop, field, value)
    prop.status = "Pending Approval"  # Re-submit for approval after any edit

    record_event(
        db,
        event_type=EventType.PROPERTY_UPDATED,
        aggregate_type="property",
        aggregate_id=prop.id,
        payload={"property_id": prop.id, "status": prop.status, "changed_fields": list(changed_fields.keys())},
    )
    record_event(
        db,
        event_type=EventType.PROPERTY_UNPUBLISHED,
        aggregate_type="property",
        aggregate_id=prop.id,
        payload={"property_id": prop.id},
    )

    db.commit()
    db.refresh(prop)
    return prop


@router.get("/{property_id}", response_model=PropertyOut)
def get_property(property_id: int, db: Session = Depends(get_db)):
    property_obj = db.get(Property, property_id)
    if not property_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    property_obj.views_count = (property_obj.views_count or 0) + 1
    db.commit()
    db.refresh(property_obj)

    result = PropertyOut.model_validate(property_obj)
    if property_obj.mediator_id:
        summary = get_mediator_summary(property_obj.mediator_id, db)
        result.mediator_rating = summary.avg_rating
        result.mediator_review_count = summary.review_count
    return result


@router.get("/{property_id}/similar", response_model=list[PropertyOut])
def get_similar_properties(
    property_id: int,
    limit: int = Query(default=6, ge=1, le=20),
    db: Session = Depends(get_db),
):
    base = db.get(Property, property_id)
    if not base:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    base_price = base.monthly_rent if base.listing_type != "sale" else base.sale_price
    price_col = Property.sale_price if base.listing_type == "sale" else Property.monthly_rent

    stmt = (
        select(Property)
        .where(
            Property.id != base.id,
            Property.status == "Published",
            Property.city == base.city,
        )
        .order_by(
            case((Property.area == base.area, 0), else_=1),
            func.abs(func.coalesce(price_col, 0) - (base_price or 0)),
        )
        .limit(limit)
    )
    return db.scalars(stmt).all()


@router.post("/", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_property(
    payload: PropertyCreate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    property_obj = Property(**payload.model_dump())
    db.add(property_obj)
    db.flush()
    if property_obj.latitude is None or property_obj.longitude is None:
        property_obj.latitude, property_obj.longitude = coords_for(property_obj.area, property_obj.city, property_obj.id)
    record_event(
        db,
        event_type=EventType.PROPERTY_CREATED,
        aggregate_type="property",
        aggregate_id=property_obj.id,
        payload={"property_id": property_obj.id, "status": property_obj.status},
    )
    if property_obj.status == "Published":
        record_event(
            db,
            event_type=EventType.PROPERTY_PUBLISHED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id},
        )
        properties_published_total.inc()
    db.commit()
    db.refresh(property_obj)
    return property_obj


_MEANINGFUL_DETAIL_FIELDS = ("bedrooms", "bathrooms", "property_type", "furnished", "size_sq_m")


@router.patch("/{property_id}", response_model=PropertyOut)
def update_property(
    property_id: int,
    payload: PropertyUpdate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    property_obj = db.get(Property, property_id)
    if not property_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    previous_status = property_obj.status
    previous_monthly_rent = property_obj.monthly_rent
    previous_sale_price = property_obj.sale_price
    previous_details = {f: getattr(property_obj, f) for f in _MEANINGFUL_DETAIL_FIELDS}
    was_ever_published = previous_status == "Published"

    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(property_obj, field, value)

    detail_changed = any(previous_details[f] != getattr(property_obj, f) for f in _MEANINGFUL_DETAIL_FIELDS)
    record_event(
        db,
        event_type=EventType.PROPERTY_UPDATED,
        aggregate_type="property",
        aggregate_id=property_obj.id,
        payload={
            "property_id": property_obj.id,
            "status": property_obj.status,
            "changed_fields": list(changed_fields.keys()),
            "previous_details": previous_details,
            "detail_changed": detail_changed,
        },
    )
    if previous_status != "Published" and property_obj.status == "Published":
        record_event(
            db,
            event_type=EventType.PROPERTY_PUBLISHED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id, "republished": was_ever_published},
        )
        properties_published_total.inc()
    elif previous_status == "Published" and property_obj.status != "Published":
        record_event(
            db,
            event_type=EventType.PROPERTY_UNPUBLISHED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id},
        )
        record_event(
            db,
            event_type=EventType.PROPERTY_AVAILABILITY_CHANGED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id, "available": False},
        )

    # Price-change detection: only meaningful (and only alert-worthy) once
    # the property is actually visible to searchers.
    if property_obj.status == "Published":
        old_price = previous_sale_price if property_obj.listing_type == "sale" else previous_monthly_rent
        new_price = property_obj.sale_price if property_obj.listing_type == "sale" else property_obj.monthly_rent
        if old_price is not None and new_price is not None and old_price != new_price:
            pct_change = abs(new_price - old_price) / old_price * 100 if old_price else 100
            abs_change = abs(new_price - old_price)
            if pct_change >= settings.PRICE_CHANGE_THRESHOLD_PERCENT and abs_change >= settings.PRICE_CHANGE_THRESHOLD_ABS_SAR:
                record_event(
                    db,
                    event_type=EventType.PROPERTY_PRICE_CHANGED,
                    aggregate_type="property",
                    aggregate_id=property_obj.id,
                    payload={
                        "property_id": property_obj.id,
                        "old_price": old_price,
                        "new_price": new_price,
                        "direction": "down" if new_price < old_price else "up",
                    },
                )

    db.commit()
    db.refresh(property_obj)
    return property_obj


class ImagePayload(BaseModel):
    url: str


@router.get("/{property_id}/images", response_model=list[ListingImageOut])
def list_property_images(property_id: int, db: Session = Depends(get_db)):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    return prop.listing_images


@router.post("/{property_id}/images", response_model=ListingImageOut, status_code=status.HTTP_201_CREATED)
def add_property_image(
    property_id: int,
    payload: ImagePayload,
    db: Session = Depends(get_db),
    admin: User | None = Depends(get_optional_admin_user),
):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if admin is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")
    next_order = len(prop.listing_images)
    img = ListingImage(property_id=property_id, url=payload.url.strip(), display_order=next_order)
    db.add(img)
    db.commit()
    db.refresh(img)
    return img


@router.post("/partner/{property_id}/images", response_model=ListingImageOut, status_code=status.HTTP_201_CREATED)
def add_partner_property_image(
    property_id: int,
    payload: ImagePayload,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if prop.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    next_order = len(prop.listing_images)
    img = ListingImage(property_id=property_id, url=payload.url.strip(), display_order=next_order)
    db.add(img)
    db.commit()
    db.refresh(img)
    return img


@router.delete("/{property_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property_image(
    property_id: int,
    image_id: int,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    img = db.get(ListingImage, image_id)
    if not img or img.property_id != property_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    db.delete(img)
    db.commit()


@router.delete("/partner/{property_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_partner_property_image(
    property_id: int,
    image_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    prop = db.get(Property, property_id)
    if not prop or prop.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    img = db.get(ListingImage, image_id)
    if not img or img.property_id != property_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    db.delete(img)
    db.commit()


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(
    property_id: int,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    property_obj = db.get(Property, property_id)
    if not property_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    db.delete(property_obj)
    db.commit()
