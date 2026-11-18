"""Partner listing photo uploads, stored on the same local upload volume as
transaction documents (backend/uploads/…).

Storage & URLs
  * Files live at uploads/listings/{property_id}/{uuid}.{ext}; the DB stores
    the *relative* path  /api/media/listing-images/{uuid}.{ext}.
  * `resolve_image_url()` turns that into an absolute URL for API responses
    (works for the web portal and the mobile app without client changes).
  * Photos of a Published listing are public. Photos of any non-public
    listing are only served with a short-lived HMAC signature, which the API
    adds solely in responses that the property-visibility rule
    (app/api/property_access.py) already allowed — so an unreviewed or
    rejected listing's photos can't be fetched by guessing a URL.

Validation: JPEG / PNG / WebP only, detected from the file's own bytes (the
declared Content-Type is not trusted), max 8 MB, max 20 photos per listing.
"""

import hashlib
import hmac
import re
import time
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import settings

MEDIA_PREFIX = "/api/media/listing-images/"
LISTING_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "listings"
MAX_LISTING_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGES_PER_LISTING = 20
SIGNED_URL_TTL_SECONDS = 60 * 60
_KEY_RE = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")
_CONTENT_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


class ListingMediaError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def sniff_image_type(contents: bytes) -> str | None:
    if contents[:3] == b"\xff\xd8\xff":
        return "jpg"
    if contents[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        return "webp"
    return None


def is_local_media(url: str | None) -> bool:
    return bool(url) and url.startswith(MEDIA_PREFIX)


def media_key(url: str) -> str:
    return url[len(MEDIA_PREFIX):]


def disk_path(property_id: int, key: str) -> Path:
    return LISTING_UPLOAD_ROOT / str(property_id) / key


async def save_listing_image(property_id: int, current_count: int, file: UploadFile) -> str:
    if current_count >= MAX_IMAGES_PER_LISTING:
        raise ListingMediaError(409, f"A listing can have at most {MAX_IMAGES_PER_LISTING} photos.")
    contents = await file.read(MAX_LISTING_IMAGE_BYTES + 1)
    if not contents:
        raise ListingMediaError(422, "The file is empty.")
    if len(contents) > MAX_LISTING_IMAGE_BYTES:
        raise ListingMediaError(413, f"Photos must be {MAX_LISTING_IMAGE_BYTES // (1024 * 1024)} MB or smaller.")
    ext = sniff_image_type(contents)
    if ext is None:
        raise ListingMediaError(415, "Only JPEG, PNG or WebP photos can be uploaded.")
    key = f"{uuid.uuid4().hex}.{ext}"
    target = disk_path(property_id, key)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(contents)
    return MEDIA_PREFIX + key


def delete_listing_image_file(property_id: int, url: str | None) -> None:
    if not is_local_media(url):
        return
    key = media_key(url)
    if not _KEY_RE.match(key):
        return
    path = disk_path(property_id, key)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def content_type_for(key: str) -> str:
    return _CONTENT_TYPES[key.rsplit(".", 1)[1]]


def valid_key(key: str) -> bool:
    return bool(_KEY_RE.match(key))


def _signature(key: str, expires: int) -> str:
    msg = f"listing-image:{key}:{expires}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def verify_signature(key: str, expires: str | None, sig: str | None) -> bool:
    if not expires or not sig:
        return False
    try:
        exp = int(expires)
    except ValueError:
        return False
    if exp < int(time.time()):
        return False
    return hmac.compare_digest(_signature(key, exp), sig)


def public_api_origin() -> str:
    """Origin that serves /api for clients. In production the API is served
    from the same domain as the web app (Caddy routes /api/*)."""
    configured = getattr(settings, "PUBLIC_API_ORIGIN", None)
    if configured:
        return configured.rstrip("/")
    if (settings.ENV or "").lower() == "production":
        return settings.FRONTEND_ORIGIN.rstrip("/")
    return f"http://localhost:{settings.API_PORT}"


def resolve_image_url(url: str, property_status: str | None) -> str:
    """Absolute URL for an image; signed when the listing isn't public."""
    if not is_local_media(url):
        return url
    absolute = public_api_origin() + url
    if property_status == "Published":
        return absolute
    key = media_key(url)
    expires = int(time.time()) + SIGNED_URL_TTL_SECONDS
    return f"{absolute}?exp={expires}&sig={_signature(key, expires)}"
