"""Push-device registration (Phase 2B/11). `push_token` is never returned in
any response body (not even to its owner) — devices are identified/managed
by their opaque `id` only, so a token can't leak back out through this API
once registered."""
import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user, get_db
from app.core.audit import record_audit
from app.core.metrics import device_registration_total
from app.core.rate_limit import rate_limit_dependency
from app.models.device import Device
from app.models.user import User as UserModel
from app.schemas.device import DeviceAdminOut, DeviceOut, DeviceRegister

router = APIRouter()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def register_device(
    payload: DeviceRegister,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("device_register", limit=20, window_seconds=3600, by_user=True)),
):
    now = datetime.now(timezone.utc)
    token_hash = _hash_token(payload.push_token)

    # "One token must not be actively assigned to multiple users" (Phase 2B):
    # if this exact token is currently enabled under a *different* user
    # (e.g. a shared/reused device, or a re-login as a different account
    # without an explicit logout call), disable that stale row before
    # (re)assigning it here — a token can only ever push-notify whoever most
    # recently proved ownership of it via a fresh registration call.
    stolen = db.scalars(
        select(Device).where(Device.push_token_hash == token_hash, Device.user_id != current_user.id, Device.enabled == True)  # noqa: E712
    ).all()
    for other in stolen:
        other.enabled = False
        other.invalidated_at = now
        record_audit(db, user_id=current_user.id, action="device.reassigned_from_other_user", entity_type="device", entity_id=other.id, metadata={"previous_user_id": other.user_id})

    # Upsert by (user_id, push_token): a reinstall/relaunch/token-rotation
    # re-registering the same physical device must not create duplicate
    # rows — this also covers "re-login on the same device", since the new
    # session's token registration call reactivates the existing row rather
    # than orphaning it.
    existing = db.scalar(
        select(Device).where(Device.user_id == current_user.id, Device.push_token == payload.push_token)
    )
    if existing:
        existing.platform = payload.platform
        existing.installation_id = payload.installation_id
        existing.device_id = payload.device_id
        existing.app_version = payload.app_version
        existing.os_version = payload.os_version
        existing.locale = payload.locale
        existing.device_timezone = payload.device_timezone
        existing.push_token_hash = token_hash
        existing.enabled = True
        existing.invalidated_at = None
        existing.failure_count = 0
        existing.last_active_at = now
        db.commit()
        db.refresh(existing)
        device_registration_total.labels(platform=payload.platform).inc()
        return existing

    device = Device(
        user_id=current_user.id,
        platform=payload.platform,
        push_token=payload.push_token,
        push_token_hash=token_hash,
        installation_id=payload.installation_id,
        device_id=payload.device_id,
        app_version=payload.app_version,
        os_version=payload.os_version,
        locale=payload.locale,
        device_timezone=payload.device_timezone,
    )
    db.add(device)
    record_audit(db, user_id=current_user.id, action="device.registered", entity_type="device", entity_id=None, metadata={"platform": payload.platform})
    db.commit()
    db.refresh(device)
    device_registration_total.labels(platform=payload.platform).inc()
    return device


@router.get("/", response_model=list[DeviceOut])
def list_devices(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Device).where(Device.user_id == current_user.id).order_by(Device.last_active_at.desc())).all()


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def unregister_device(device_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called on logout (or when the user disables notifications for that
    device). Never a plain global lookup — must be this user's device."""
    device = db.get(Device, device_id)
    if not device or device.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    record_audit(db, user_id=current_user.id, action="device.unregistered", entity_type="device", entity_id=device.id, metadata={})
    db.delete(device)
    db.commit()


# ── Admin device health (Phase 9D/9E) ───────────────────────────────────────

@router.get("/admin/all", response_model=list[DeviceAdminOut])
def admin_list_devices(
    platform: str | None = None,
    enabled: bool | None = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _admin: UserModel = Depends(get_admin_user),
):
    stmt = select(Device)
    if platform:
        stmt = stmt.where(Device.platform == platform)
    if enabled is not None:
        stmt = stmt.where(Device.enabled == enabled)
    stmt = stmt.order_by(Device.last_active_at.desc()).offset(skip).limit(min(limit, 200))
    rows = db.scalars(stmt).all()
    out = []
    for d in rows:
        item = DeviceAdminOut.model_validate(d, from_attributes=True)
        item.user_email = d.user.email if d.user else None
        out.append(item)
    return out


@router.post("/admin/{device_id}/disable", status_code=status.HTTP_200_OK)
def admin_disable_device(
    device_id: int,
    db: Session = Depends(get_db),
    admin: UserModel = Depends(get_admin_user),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    device.enabled = False
    device.invalidated_at = datetime.now(timezone.utc)
    record_audit(db, user_id=admin.id, action="device.admin_disabled", entity_type="device", entity_id=device.id, metadata={})
    db.commit()
    return {"status": "disabled", "device_id": device_id}
