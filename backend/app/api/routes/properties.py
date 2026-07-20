from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.api.deps import get_admin_user, get_db, get_mediator_user, get_optional_admin_user
from app.core.geo import coords_for
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
    prop = Property(
        **payload.model_dump(),
        status="Pending Approval",
        mediator_id=mediator.id,
    )
    db.add(prop)
    db.flush()
    prop.latitude, prop.longitude = coords_for(prop.area, prop.city, prop.id)
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

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(prop, field, value)
    prop.status = "Pending Approval"  # Re-submit for approval after any edit

    db.commit()
    db.refresh(prop)
    return prop


@router.get("/{property_id}", response_model=PropertyOut)
def get_property(property_id: int, db: Session = Depends(get_db)):
    property_obj = db.get(Property, property_id)
    if not property_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    return property_obj


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
    db.commit()
    db.refresh(property_obj)
    return property_obj


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

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(property_obj, field, value)

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
