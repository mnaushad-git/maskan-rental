from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user, get_db
from app.core.outbox import EventType, record_event
from app.models.user import User
from app.schemas.verification import VerificationAdminOut, VerificationOut, VerificationSubmit

router = APIRouter()


# ── Renter-facing ────────────────────────────────────────────────────────────

@router.get("/me", response_model=VerificationOut)
def get_my_verification(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/me", response_model=VerificationOut, status_code=201)
def submit_verification(
    body: VerificationSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit (or resubmit) identity verification. Mock — captures a document
    reference only, no real Nafath call."""
    if current_user.verification_status in ("pending", "approved"):
        raise HTTPException(
            status_code=409,
            detail=f"Verification is already '{current_user.verification_status}'.",
        )
    current_user.verification_status = "pending"
    current_user.verification_document_ref = body.document_reference
    current_user.verification_submitted_at = datetime.now(timezone.utc)
    current_user.verification_reviewed_at = None
    db.flush()
    record_event(
        db,
        event_type=EventType.USER_VERIFICATION_SUBMITTED,
        aggregate_type="user",
        aggregate_id=current_user.id,
        payload={"user_id": current_user.id},
    )
    db.commit()
    db.refresh(current_user)
    return current_user


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/admin/pending", response_model=list[VerificationAdminOut])
def list_pending_verifications(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    return db.scalars(
        select(User).where(User.verification_status == "pending").order_by(User.verification_submitted_at.asc())
    ).all()


@router.post("/admin/{user_id}/approve", response_model=VerificationAdminOut)
def admin_approve_verification(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    was_verified = user.is_verified
    user.verification_status = "approved"
    user.is_verified = True
    user.verification_reviewed_at = datetime.now(timezone.utc)
    if not was_verified:
        record_event(
            db,
            event_type=EventType.USER_VERIFIED,
            aggregate_type="user",
            aggregate_id=user.id,
            payload={"user_id": user.id},
        )
    db.commit()
    db.refresh(user)
    return user


@router.post("/admin/{user_id}/reject", response_model=VerificationAdminOut)
def admin_reject_verification(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.verification_status = "rejected"
    user.is_verified = False
    user.verification_reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user
