from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user, get_db, get_mediator_user
from app.core.config import settings
from app.models.lead import Lead, LeadAssignment, LeadMessage, LeadSuggestion
from app.models.mediator import Mediator, MediatorArea
from app.models.payment import Payment
from app.models.property import Property
from app.models.user import User
from app.schemas.lead import (
    LeadAvailableOut,
    LeadCreate,
    LeadDetailOut,
    LeadMessageCreate,
    LeadMessageOut,
    LeadStatusUpdate,
    LeadSummaryOut,
)

router = APIRouter()


# ── Assignment algorithm ──────────────────────────────────────────────────────

def _find_mediator_for_lead(lead: Lead, db: Session, exclude_ids: list[int] | None = None) -> Mediator | None:
    """
    Pick the best available mediator for a lead in the target area.
    Priority: fewest active assignments first, then most experienced, then earliest member.
    """
    exclude_ids = exclude_ids or []
    active_count = (
        db.query(LeadAssignment.mediator_id, func.count(LeadAssignment.id).label("cnt"))
        .filter(LeadAssignment.status.in_(["pending", "accepted"]))
        .group_by(LeadAssignment.mediator_id)
        .subquery()
    )
    candidate = (
        db.query(Mediator)
        .join(MediatorArea, MediatorArea.mediator_id == Mediator.id)
        .outerjoin(active_count, active_count.c.mediator_id == Mediator.id)
        .filter(
            MediatorArea.area_name.ilike(lead.area_name),
            MediatorArea.city.ilike(lead.city),
            Mediator.subscription_status == "active",
            Mediator.is_verified == True,
            Mediator.approval_status == "approved",
            Mediator.id.notin_(exclude_ids),
        )
        .order_by(
            func.coalesce(active_count.c.cnt, 0).asc(),
            Mediator.total_leads_accepted.desc(),
            Mediator.created_at.asc(),
        )
        .first()
    )
    return candidate


def _suggest_properties(lead: Lead, db: Session) -> list[LeadSuggestion]:
    """Find up to 10 matching published properties for a lead."""
    q = db.query(Property).filter(
        Property.area.ilike(lead.area_name),
        Property.status == "Published",
    )
    if lead.max_budget is not None:
        q = q.filter(Property.monthly_rent <= lead.max_budget)
    if lead.bedrooms_needed is not None:
        q = q.filter(Property.bedrooms == lead.bedrooms_needed)
    properties = q.order_by(Property.created_at.desc()).limit(10).all()

    suggestions = []
    for prop in properties:
        score = 100.0
        if lead.max_budget and prop.monthly_rent > lead.max_budget * 0.95:
            score -= 20
        if lead.bedrooms_needed and prop.bedrooms != lead.bedrooms_needed:
            score -= 15
        reason = f"Published in {prop.area}"
        if lead.bedrooms_needed and prop.bedrooms == lead.bedrooms_needed:
            reason += f" · {prop.bedrooms} BR match"
        suggestions.append(LeadSuggestion(lead_id=lead.id, property_id=prop.id, match_score=max(0.0, score), reason=reason))
    return suggestions


def _generate_suggestions_task(lead_id: int) -> None:
    """Background task: populate AI-matched property suggestions for a new lead."""
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        lead = db.get(Lead, lead_id)
        if not lead:
            return
        suggestions = _suggest_properties(lead, db)
        for s in suggestions:
            db.add(s)
        db.commit()
    finally:
        db.close()


# ── Customer: submit a lead ───────────────────────────────────────────────────

@router.post("/", response_model=LeadDetailOut, status_code=201)
def create_lead(
    body: LeadCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = Lead(
        customer_user_id=current_user.id,
        customer_name=body.customer_name,
        customer_phone=body.customer_phone,
        customer_email=body.customer_email,
        area_name=body.area_name,
        city=body.city,
        min_budget=body.min_budget,
        max_budget=body.max_budget,
        bedrooms_needed=body.bedrooms_needed,
        move_in_date=body.move_in_date,
        requirements_note=body.requirements_note,
        source=body.source,
        status="pending_review",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    background_tasks.add_task(_generate_suggestions_task, lead.id)
    return lead


@router.get("/my", response_model=list[LeadSummaryOut])
def my_leads(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Lead)
        .filter(Lead.customer_user_id == current_user.id)
        .order_by(Lead.created_at.desc())
        .all()
    )


@router.get("/my/unread-count")
def my_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = (
        db.query(func.count(LeadMessage.id))
        .join(Lead, Lead.id == LeadMessage.lead_id)
        .filter(
            Lead.customer_user_id == current_user.id,
            LeadMessage.is_read == False,
            LeadMessage.sender_role != "customer",
        )
        .scalar()
    )
    return {"count": count or 0}


@router.get("/my/notifications")
def my_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subq = (
        db.query(
            LeadMessage.lead_id,
            func.count(LeadMessage.id).label("unread_count"),
            func.max(LeadMessage.created_at).label("latest_at"),
        )
        .filter(
            LeadMessage.is_read == False,
            LeadMessage.sender_role != "customer",
        )
        .group_by(LeadMessage.lead_id)
        .subquery()
    )
    rows = (
        db.query(Lead, subq.c.unread_count, subq.c.latest_at)
        .join(subq, subq.c.lead_id == Lead.id)
        .filter(Lead.customer_user_id == current_user.id)
        .order_by(subq.c.latest_at.desc())
        .all()
    )
    result = []
    for lead, unread_count, latest_at in rows:
        latest_msg = (
            db.query(LeadMessage)
            .filter(
                LeadMessage.lead_id == lead.id,
                LeadMessage.is_read == False,
                LeadMessage.sender_role != "customer",
            )
            .order_by(LeadMessage.created_at.desc())
            .first()
        )
        if latest_msg:
            result.append({
                "lead_id": lead.id,
                "area_name": lead.area_name,
                "city": lead.city,
                "unread_count": int(unread_count),
                "latest_message": latest_msg.content,
                "latest_message_at": latest_msg.created_at.isoformat(),
                "sender_role": latest_msg.sender_role,
            })
    return result


# ── Mediator: view and action on assigned leads ───────────────────────────────

@router.get("/mediator/assigned", response_model=list[LeadDetailOut])
def mediator_leads(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    _user, mediator = mediator_tuple
    q = (
        db.query(Lead)
        .join(LeadAssignment, LeadAssignment.lead_id == Lead.id)
        .filter(LeadAssignment.mediator_id == mediator.id)
    )
    if status_filter:
        q = q.filter(LeadAssignment.status == status_filter)
    return q.order_by(Lead.created_at.desc()).all()


@router.get("/available", response_model=list[LeadAvailableOut])
def available_leads(
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    """All open/assigned leads with no accepted assignment — visible to every active partner in masked form."""
    accepted_subq = (
        db.query(LeadAssignment.lead_id)
        .filter(LeadAssignment.status == "accepted")
        .scalar_subquery()
    )
    return (
        db.query(Lead)
        .filter(
            Lead.status == "open",
            Lead.id.notin_(accepted_subq),
        )
        .order_by(Lead.created_at.desc())
        .all()
    )


@router.get("/{lead_id}", response_model=LeadDetailOut)
def get_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    is_admin = current_user.email in settings.admin_emails
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    is_assigned_mediator = mediator and any(a.mediator_id == mediator.id and a.status in ("pending", "accepted") for a in lead.assignments)
    if lead.customer_user_id != current_user.id and not is_admin and not is_assigned_mediator:
        raise HTTPException(status_code=403, detail="Access denied.")
    return lead


@router.post("/{lead_id}/accept")
def accept_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    _user, mediator = mediator_tuple

    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if lead.status != "open":
        raise HTTPException(status_code=409, detail="This lead is not available for acceptance.")

    # Race-condition guard: reject if another partner already accepted
    already_accepted = (
        db.query(LeadAssignment)
        .filter(LeadAssignment.lead_id == lead_id, LeadAssignment.status == "accepted")
        .first()
    )
    if already_accepted:
        raise HTTPException(status_code=409, detail="This lead has already been accepted by another partner.")

    # Find or create a pending assignment for this mediator
    assignment = (
        db.query(LeadAssignment)
        .filter(
            LeadAssignment.lead_id == lead_id,
            LeadAssignment.mediator_id == mediator.id,
            LeadAssignment.status == "pending",
        )
        .first()
    )

    if not assignment:
        # Marketplace accept: no prior assignment, create one now
        assignment = LeadAssignment(
            lead_id=lead_id,
            mediator_id=mediator.id,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
        )
        db.add(assignment)
        db.flush()
    elif assignment.expires_at < datetime.now(timezone.utc):
        # Pre-assigned but since expired — create a fresh pending assignment
        assignment.status = "expired"
        assignment = LeadAssignment(
            lead_id=lead_id,
            mediator_id=mediator.id,
            status="pending",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
        )
        db.add(assignment)
        db.flush()

    # Charge the per-lead fee (mock — TODO: real Moyasar charge)
    payment = Payment(
        user_id=_user.id,
        mediator_id=mediator.id,
        payment_type="lead_pickup",
        amount=settings.LEAD_PICKUP_FEE_SAR,
        currency="SAR",
        status="paid",
        gateway="moyasar",
        gateway_payment_id=f"mock_lead_{lead_id}_mediator_{mediator.id}",
        description=f"Lead pickup: Lead #{lead_id}",
        paid_at=datetime.now(timezone.utc),
    )
    db.add(payment)
    db.flush()

    assignment.status = "accepted"
    assignment.accepted_at = datetime.now(timezone.utc)
    assignment.payment_id = payment.id

    lead.status = "in_progress"
    mediator.total_leads_accepted += 1
    db.commit()

    # TODO: send email to customer with mediator contact details
    return {"status": "accepted", "lead_id": lead_id, "payment_amount": settings.LEAD_PICKUP_FEE_SAR}


@router.post("/{lead_id}/reject")
def reject_lead(
    lead_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    _user, mediator = mediator_tuple
    assignment = (
        db.query(LeadAssignment)
        .filter(
            LeadAssignment.lead_id == lead_id,
            LeadAssignment.mediator_id == mediator.id,
            LeadAssignment.status == "pending",
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="No pending assignment found.")
    assignment.status = "rejected"
    assignment.rejected_at = datetime.now(timezone.utc)

    lead = db.get(Lead, lead_id)
    lead.status = "open"
    db.commit()

    # Re-assign to the next mediator
    already_tried = [a.mediator_id for a in lead.assignments if a.mediator_id]
    background_tasks.add_task(_reassign_lead, lead_id, already_tried)
    return {"status": "rejected", "lead_id": lead_id}


@router.patch("/{lead_id}/status", response_model=LeadDetailOut)
def request_lead_closure(
    lead_id: int,
    body: LeadStatusUpdate,
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    """Partner submits a closure request; admin reviews and approves/rejects it."""
    _user, mediator = mediator_tuple
    if body.status not in ("closed_won", "closed_lost"):
        raise HTTPException(status_code=400, detail="status must be 'closed_won' or 'closed_lost'.")
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if lead.status != "in_progress":
        raise HTTPException(status_code=400, detail="Only in-progress leads can have a closure requested.")
    is_assigned = any(a.mediator_id == mediator.id and a.status == "accepted" for a in lead.assignments)
    if not is_assigned:
        raise HTTPException(status_code=403, detail="You are not the accepted mediator for this lead.")
    lead.status = "pending_closure"
    lead.closure_outcome = body.status
    lead.closure_note = body.note
    lead.closure_requested_at = datetime.now(timezone.utc)
    lead.closure_requested_by_mediator_id = mediator.id
    db.commit()
    db.refresh(lead)
    return lead


# ── Re-assignment background task ──────────────────────────────────────────────

def _reassign_lead(lead_id: int, exclude_ids: list[int]) -> None:
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        lead = db.get(Lead, lead_id)
        if not lead or lead.status != "open":
            return
        mediator = _find_mediator_for_lead(lead, db, exclude_ids=exclude_ids)
        if mediator:
            assignment = LeadAssignment(
                lead_id=lead.id,
                mediator_id=mediator.id,
                status="pending",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
            )
            db.add(assignment)
            lead.status = "assigned"
            # TODO: send email to new mediator
        db.commit()
    finally:
        db.close()


# ── Messages ──────────────────────────────────────────────────────────────────

@router.get("/{lead_id}/messages", response_model=list[LeadMessageOut])
def get_messages(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    _check_lead_access(lead, current_user, db)
    return db.query(LeadMessage).filter(LeadMessage.lead_id == lead_id).order_by(LeadMessage.created_at).all()


@router.post("/{lead_id}/messages", response_model=LeadMessageOut, status_code=201)
def send_message(
    lead_id: int,
    body: LeadMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    role = _check_lead_access(lead, current_user, db)
    msg = LeadMessage(
        lead_id=lead_id,
        sender_user_id=current_user.id,
        sender_role=role,
        content=body.content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.post("/{lead_id}/messages/read", status_code=200)
def mark_messages_read(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    role = _check_lead_access(lead, current_user, db)
    other_role = "mediator" if role == "customer" else "customer"
    updated = (
        db.query(LeadMessage)
        .filter(LeadMessage.lead_id == lead_id, LeadMessage.sender_role == other_role, LeadMessage.is_read == False)
        .update({"is_read": True})
    )
    db.commit()
    return {"marked_read": updated}


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.get("/admin/all", response_model=list[LeadDetailOut])
def admin_list_leads(
    status_filter: str | None = None,
    area_name: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    q = db.query(Lead)
    if status_filter:
        q = q.filter(Lead.status == status_filter)
    if area_name:
        q = q.filter(Lead.area_name.ilike(area_name))
    return q.order_by(Lead.created_at.desc()).offset(skip).limit(limit).all()


@router.patch("/admin/{lead_id}/approve", response_model=LeadDetailOut)
def admin_approve_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin approves a pending_review lead — makes it visible to all partners."""
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if lead.status != "pending_review":
        raise HTTPException(status_code=400, detail="Lead is not pending review.")
    lead.status = "open"
    db.commit()
    db.refresh(lead)
    return lead


@router.patch("/admin/{lead_id}/reject", response_model=LeadDetailOut)
def admin_reject_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin rejects a pending_review lead — it is removed from the marketplace."""
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if lead.status != "pending_review":
        raise HTTPException(status_code=400, detail="Lead is not pending review.")
    lead.status = "rejected"
    db.commit()
    db.refresh(lead)
    return lead


@router.patch("/admin/{lead_id}/approve-closure", response_model=LeadDetailOut)
def admin_approve_closure(
    lead_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin approves a partner's closure request — finalises the lead outcome."""
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if lead.status != "pending_closure":
        raise HTTPException(status_code=400, detail="Lead has no pending closure request.")
    lead.status = lead.closure_outcome  # "closed_won" or "closed_lost"
    lead.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(lead)
    return lead


@router.patch("/admin/{lead_id}/reject-closure", response_model=LeadDetailOut)
def admin_reject_closure(
    lead_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin rejects a partner's closure request — returns lead to in_progress."""
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    if lead.status != "pending_closure":
        raise HTTPException(status_code=400, detail="Lead has no pending closure request.")
    lead.status = "in_progress"
    lead.closure_outcome = None
    lead.closure_note = None
    lead.closure_requested_at = None
    lead.closure_requested_by_mediator_id = None
    db.commit()
    db.refresh(lead)
    return lead


@router.patch("/admin/{lead_id}/close", response_model=LeadDetailOut)
def admin_force_close_lead(
    lead_id: int,
    body: LeadStatusUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin force-closes any lead regardless of its current state."""
    if body.status not in ("closed_won", "closed_lost"):
        raise HTTPException(status_code=400, detail="status must be 'closed_won' or 'closed_lost'.")
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    lead.status = body.status
    lead.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(lead)
    return lead


@router.patch("/admin/{lead_id}/assign")
def admin_assign_lead(
    lead_id: int,
    mediator_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    mediator = db.get(Mediator, mediator_id)
    if not mediator:
        raise HTTPException(status_code=404, detail="Mediator not found.")

    # Cancel any existing pending/accepted assignments
    db.query(LeadAssignment).filter(
        LeadAssignment.lead_id == lead_id,
        LeadAssignment.status.in_(["pending", "accepted"]),
    ).update({"status": "expired"})

    assignment = LeadAssignment(
        lead_id=lead_id,
        mediator_id=mediator_id,
        status="pending",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=48),
    )
    db.add(assignment)
    lead.status = "assigned"
    db.commit()
    return {"status": "assigned", "lead_id": lead_id, "mediator_id": mediator_id}


@router.post("/admin/{lead_id}/message", response_model=LeadMessageOut, status_code=201)
def admin_send_message(
    lead_id: int,
    body: LeadMessageCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    msg = LeadMessage(
        lead_id=lead_id,
        sender_user_id=admin.id,
        sender_role="admin",
        content=body.content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.get("/admin/{lead_id}/messages", response_model=list[LeadMessageOut])
def admin_get_messages(
    lead_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    return db.query(LeadMessage).filter(LeadMessage.lead_id == lead_id).order_by(LeadMessage.created_at).all()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_lead_access(lead: Lead, user: User, db: Session) -> str:
    """Returns the user's role ('customer' or 'mediator') or raises 403."""
    if lead.customer_user_id == user.id:
        return "customer"
    mediator = db.query(Mediator).filter(Mediator.user_id == user.id).first()
    if mediator and any(a.mediator_id == mediator.id and a.status in ("pending", "accepted") for a in lead.assignments):
        return "mediator"
    if user.email in settings.admin_emails:
        return "mediator"  # admin can read/write as mediator side
    raise HTTPException(status_code=403, detail="Access denied.")
