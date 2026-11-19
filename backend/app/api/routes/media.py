"""Serves uploaded listing photos (see app/services/listing_media.py)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.listing_image import ListingImage
from app.models.property import Property
from app.services import listing_media

router = APIRouter()


@router.get("/listing-images/{key}")
def get_listing_image(
    key: str,
    exp: str | None = Query(default=None),
    sig: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    not_found = HTTPException(status_code=404, detail="Image not found")
    if not listing_media.valid_key(key):
        raise not_found
    image = db.scalar(select(ListingImage).where(ListingImage.url == listing_media.MEDIA_PREFIX + key))
    if image is None:
        raise not_found
    prop = db.get(Property, image.property_id)
    if prop is None:
        raise not_found
    public = prop.status == "Published"
    if not public and not listing_media.verify_signature(key, exp, sig):
        raise not_found
    path = listing_media.disk_path(prop.id, key)
    if not path.is_file():
        raise not_found
    headers = {"Cache-Control": "public, max-age=86400" if public else "private, no-store"}
    return FileResponse(path, media_type=listing_media.content_type_for(key), headers=headers)
