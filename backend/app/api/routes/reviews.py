from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_admin_user, get_current_user, get_db
from app.core.outbox import EventType, record_event
from app.models.mediator import Mediator
from app.models.review import Review
from app.models.user import User
from app.schemas.review import ReviewAdminOut, ReviewCreate, ReviewOut, ReviewSummary

router = APIRouter()


# ── Public endpoints ──────────────────────────────────────────────────────────

@router.get("/mediator/{mediator_id}", response_model=list[ReviewOut])
def get_mediator_reviews(mediator_id: int, db: Session = Depends(get_db)):
    """Public — approved reviews for a mediator, newest first."""
    return db.scalars(
        select(Review)
        .options(joinedload(Review.user))
        .where(Review.mediator_id == mediator_id, Review.status == "approved")
        .order_by(Review.created_at.desc())
    ).all()


@router.get("/mediator/{mediator_id}/summary", response_model=ReviewSummary)
def get_mediator_summary(mediator_id: int, db: Session = Depends(get_db)):
    """Public — aggregate stats from approved reviews only."""
    rows = db.execute(
        select(Review.rating, func.count(Review.id).label("n"))
        .where(Review.mediator_id == mediator_id, Review.status == "approved")
        .group_by(Review.rating)
    ).all()

    distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    total, weighted = 0, 0
    for rating, count in rows:
        distribution[rating] = count
        total += count
        weighted += rating * count

    return ReviewSummary(
        avg_rating=round(weighted / total, 1) if total > 0 else None,
        review_count=total,
        distribution=distribution,
    )


# ── Authenticated user endpoints ──────────────────────────────────────────────

@router.post("/", response_model=ReviewOut, status_code=201)
def submit_review(
    body: ReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit or update a review. New/edited reviews go back to 'pending'."""
    if not db.get(Mediator, body.mediator_id):
        raise HTTPException(status_code=404, detail="Partner not found.")

    existing = db.scalars(
        select(Review).where(
            Review.mediator_id == body.mediator_id,
            Review.user_id == current_user.id,
        )
    ).first()

    if existing:
        existing.rating = body.rating
        existing.comment = body.comment
        existing.reviewer_name = current_user.full_name
        existing.status = "pending"   # re-moderate on edit
        db.commit()
        db.refresh(existing)
        return existing

    review = Review(
        mediator_id=body.mediator_id,
        user_id=current_user.id,
        rating=body.rating,
        comment=body.comment,
        reviewer_name=current_user.full_name,
        status="pending",
    )
    db.add(review)
    db.flush()
    record_event(
        db,
        event_type=EventType.REVIEW_SUBMITTED,
        aggregate_type="review",
        aggregate_id=review.id,
        payload={"review_id": review.id, "mediator_id": review.mediator_id, "rating": review.rating},
    )
    db.commit()
    db.refresh(review)
    return review


@router.get("/my/{mediator_id}", response_model=ReviewOut | None)
def get_my_review(
    mediator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.scalars(
        select(Review).where(
            Review.mediator_id == mediator_id,
            Review.user_id == current_user.id,
        )
    ).first()


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/pending", response_model=list[ReviewAdminOut])
def list_pending_reviews(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin — all reviews pending moderation, oldest first."""
    return db.scalars(
        select(Review)
        .options(joinedload(Review.mediator))
        .where(Review.status == "pending")
        .order_by(Review.created_at.asc())
    ).all()


@router.get("/admin/all", response_model=list[ReviewAdminOut])
def list_all_reviews(
    status: str | None = None,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin — all reviews with optional status filter."""
    stmt = select(Review).options(joinedload(Review.mediator)).order_by(Review.created_at.desc())
    if status:
        stmt = stmt.where(Review.status == status)
    return db.scalars(stmt).all()


@router.patch("/admin/{review_id}", response_model=ReviewAdminOut)
def moderate_review(
    review_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin — approve or reject a review. body: {status: 'approved'|'rejected'}"""
    new_status = body.get("status")
    if new_status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'.")
    review = db.get(Review, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")
    review.status = new_status
    if new_status == "approved":
        record_event(
            db,
            event_type=EventType.REVIEW_APPROVED,
            aggregate_type="review",
            aggregate_id=review.id,
            payload={"review_id": review.id, "mediator_id": review.mediator_id},
        )
    db.commit()
    db.refresh(review)
    # Ensure mediator is loaded for response
    _ = review.mediator
    return review
