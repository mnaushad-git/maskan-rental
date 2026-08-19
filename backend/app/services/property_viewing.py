"""Visit & Viewing Management domain logic. See
docs/implementation/mymakan-viewings.md.

Mirrors app/api/routes/leads.py's create_lead: write the row + emit the
outbox event in ONE transaction, db.flush() first so the event's
aggregate_id (the new row's id) is available before commit.
"""
from dataclasses import asdict
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.outbox import EventType, record_event
from app.models.lead import Lead, LeadSuggestion
from app.models.property import Property
from app.models.property_viewing import (
    PROPERTY_VIEWING_INACTIVE_STATUSES,
    PROPERTY_VIEWING_TRANSITIONS,
    PropertyViewing,
)
from app.models.user import User
from app.services import viewing_checklist, viewing_checklist_ai


class ViewingDomainError(Exception):
    """A business-rule violation the route layer translates into a specific
    HTTP status (never a generic 500)."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _find_linked_lead_id(db: Session, customer_user: User, property_id: int) -> int | None:
    """Attach lead_id only when an existing LeadSuggestion already links this
    customer's lead to this exact property — never auto-create a Lead (a
    Lead is area-wide, not per-property; see this doc's "Lead integration").
    """
    suggestion = (
        db.query(LeadSuggestion)
        .join(Lead, Lead.id == LeadSuggestion.lead_id)
        .filter(Lead.customer_user_id == customer_user.id, LeadSuggestion.property_id == property_id)
        .first()
    )
    return suggestion.lead_id if suggestion else None


def create_viewing(
    db: Session,
    customer_user: User,
    *,
    property_id: int,
    requested_start_at: datetime,
    requested_end_at: datetime,
    timezone_name: str,
    customer_note: str | None,
) -> PropertyViewing:
    prop = db.get(Property, property_id)
    if not prop or prop.status != "Published":
        raise ViewingDomainError(404, "Property not found")

    now = datetime.now(timezone.utc)
    start = requested_start_at if requested_start_at.tzinfo else requested_start_at.replace(tzinfo=timezone.utc)
    if start <= now:
        raise ViewingDomainError(422, "requested_start_at must be in the future")
    if requested_end_at <= requested_start_at:
        raise ViewingDomainError(422, "requested_end_at must be after requested_start_at")

    existing = (
        db.query(PropertyViewing)
        .filter(
            PropertyViewing.customer_user_id == customer_user.id,
            PropertyViewing.property_id == property_id,
            PropertyViewing.status.notin_(PROPERTY_VIEWING_INACTIVE_STATUSES),
        )
        .first()
    )
    if existing:
        raise ViewingDomainError(409, "You already have an active viewing request for this property")

    lead_id = _find_linked_lead_id(db, customer_user, property_id)

    viewing = PropertyViewing(
        property_id=property_id,
        customer_user_id=customer_user.id,
        mediator_id=prop.mediator_id,
        lead_id=lead_id,
        requested_start_at=requested_start_at,
        requested_end_at=requested_end_at,
        timezone=timezone_name,
        customer_note=customer_note,
        status="requested",
    )
    db.add(viewing)
    db.flush()  # assigns viewing.id, without committing, so the outbox event below is in the SAME transaction
    record_event(
        db,
        event_type=EventType.VIEWING_REQUESTED,
        aggregate_type="property_viewing",
        aggregate_id=viewing.id,
        payload={
            "viewing_id": viewing.id,
            "property_id": property_id,
            "customer_user_id": customer_user.id,
            "mediator_id": prop.mediator_id,
        },
    )
    db.commit()
    db.refresh(viewing)
    return viewing


def _transition(viewing: PropertyViewing, new_status: str) -> None:
    allowed = PROPERTY_VIEWING_TRANSITIONS.get(viewing.status, set())
    if new_status not in allowed:
        raise ViewingDomainError(409, f"Cannot move a viewing from '{viewing.status}' to '{new_status}'")
    viewing.status = new_status


def cancel_viewing(
    db: Session,
    viewing: PropertyViewing,
    *,
    reason: str,
    actor_role: str,
    actor_user_id: int | None = None,
) -> PropertyViewing:
    """actor_role: "customer" | "mediator". Ownership/authorization is the
    route layer's job (customer_user_id check in viewings.py, mediator
    prop.mediator_id check in partner_viewings.py) — this function only
    enforces the status-transition rule. `actor_user_id` is carried in the
    outbox payload purely so the notification handler can avoid
    self-notifying the actor — it has no authorization role here."""
    new_status = "cancelled_by_customer" if actor_role == "customer" else "cancelled_by_mediator"
    _transition(viewing, new_status)
    viewing.cancellation_reason = reason
    viewing.cancelled_by = actor_role
    viewing.cancelled_at = datetime.now(timezone.utc)
    db.flush()
    record_event(
        db,
        event_type=EventType.VIEWING_CANCELLED,
        aggregate_type="property_viewing",
        aggregate_id=viewing.id,
        payload={"viewing_id": viewing.id, "cancelled_by": actor_role, "reason": reason, "actor_user_id": actor_user_id},
    )
    db.commit()
    db.refresh(viewing)
    return viewing


def propose_new_time(
    db: Session,
    viewing: PropertyViewing,
    *,
    start_at: datetime,
    end_at: datetime,
    note: str | None,
    proposed_by: str,
    actor_user_id: int | None = None,
) -> PropertyViewing:
    """proposed_by: "customer" | "mediator". Sets status
    'reschedule_proposed'; requested_start_at/requested_end_at and any prior
    confirmed_start_at/confirmed_end_at are left untouched so history is
    preserved (brief §9)."""
    now = datetime.now(timezone.utc)
    start = start_at if start_at.tzinfo else start_at.replace(tzinfo=timezone.utc)
    if start <= now:
        raise ViewingDomainError(422, "start_at must be in the future")
    if end_at <= start_at:
        raise ViewingDomainError(422, "end_at must be after start_at")
    _transition(viewing, "reschedule_proposed")
    viewing.proposed_start_at = start_at
    viewing.proposed_end_at = end_at
    viewing.proposed_by = proposed_by
    if note:
        if proposed_by == "mediator":
            viewing.mediator_note = note
        else:
            viewing.customer_note = note
    db.flush()
    record_event(
        db,
        event_type=EventType.VIEWING_RESCHEDULE_PROPOSED,
        aggregate_type="property_viewing",
        aggregate_id=viewing.id,
        payload={"viewing_id": viewing.id, "proposed_by": proposed_by, "actor_user_id": actor_user_id},
    )
    db.commit()
    db.refresh(viewing)
    return viewing


def accept_reschedule(db: Session, viewing: PropertyViewing, *, actor_user_id: int | None = None) -> PropertyViewing:
    """Customer accepting a mediator's pending proposal only — a customer
    cannot accept their own proposal (they must propose-another-time or
    cancel instead; see the 409 raised below)."""
    if viewing.status != "reschedule_proposed" or viewing.proposed_by != "mediator":
        raise ViewingDomainError(409, "No mediator-proposed reschedule to accept")
    _transition(viewing, "confirmed")
    viewing.confirmed_start_at = viewing.proposed_start_at
    viewing.confirmed_end_at = viewing.proposed_end_at
    viewing.confirmed_at = datetime.now(timezone.utc)
    db.flush()
    record_event(
        db,
        event_type=EventType.VIEWING_CONFIRMED,
        aggregate_type="property_viewing",
        aggregate_id=viewing.id,
        payload={"viewing_id": viewing.id, "confirmed_by": "customer_accepted_reschedule", "actor_user_id": actor_user_id},
    )
    db.commit()
    db.refresh(viewing)
    return viewing


def confirm_viewing(
    db: Session,
    viewing: PropertyViewing,
    *,
    mediator_note: str | None = None,
    actor_user_id: int | None = None,
) -> PropertyViewing:
    """Mediator confirming a viewing. Valid from `requested` (confirms the
    customer's originally requested time) or from `reschedule_proposed`
    where `proposed_by == "customer"` (mediator accepting the customer's
    counter-proposal, using the customer's proposed time) — any other
    starting status raises a 409 before touching anything."""
    if viewing.status == "requested":
        start, end = viewing.requested_start_at, viewing.requested_end_at
    elif viewing.status == "reschedule_proposed" and viewing.proposed_by == "customer":
        start, end = viewing.proposed_start_at, viewing.proposed_end_at
    else:
        raise ViewingDomainError(409, f"Cannot confirm a viewing in status '{viewing.status}'")

    _transition(viewing, "confirmed")
    viewing.confirmed_start_at = start
    viewing.confirmed_end_at = end
    viewing.confirmed_at = datetime.now(timezone.utc)
    if mediator_note:
        viewing.mediator_note = mediator_note
    db.flush()
    record_event(
        db,
        event_type=EventType.VIEWING_CONFIRMED,
        aggregate_type="property_viewing",
        aggregate_id=viewing.id,
        payload={"viewing_id": viewing.id, "confirmed_by": "mediator", "actor_user_id": actor_user_id},
    )
    db.commit()
    db.refresh(viewing)
    return viewing


def complete_viewing(db: Session, viewing: PropertyViewing, *, actor_user_id: int | None = None) -> PropertyViewing:
    """Valid only from `confirmed`."""
    _transition(viewing, "completed")
    viewing.completed_at = datetime.now(timezone.utc)
    db.flush()
    record_event(
        db,
        event_type=EventType.VIEWING_COMPLETED,
        aggregate_type="property_viewing",
        aggregate_id=viewing.id,
        payload={"viewing_id": viewing.id, "actor_user_id": actor_user_id},
    )
    db.commit()
    db.refresh(viewing)
    return viewing


def mark_no_show(db: Session, viewing: PropertyViewing, *, who: str, actor_user_id: int | None = None) -> PropertyViewing:
    """who: "customer" | "mediator" — which party didn't show. Valid only
    from `confirmed`. No dedicated outbox event exists for a no-show (the
    brief's 5 named events don't include one) — a plain status update,
    surfaced to both sides only via their next viewing list/detail fetch."""
    new_status = "no_show_customer" if who == "customer" else "no_show_mediator"
    _transition(viewing, new_status)
    db.commit()
    db.refresh(viewing)
    return viewing


def to_viewing_out(viewing: PropertyViewing) -> dict:
    """Denormalizes property/mediator display fields onto the response dict,
    mirroring how PropertyOut denormalizes mediator fields — avoids N+1
    fetches on list/detail screens. `viewing.property`/`viewing.mediator`
    are the ORM relationships defined on PropertyViewing."""
    prop = viewing.property
    mediator = viewing.mediator
    return {
        "id": viewing.id,
        "property_id": viewing.property_id,
        "customer_user_id": viewing.customer_user_id,
        "mediator_id": viewing.mediator_id,
        "lead_id": viewing.lead_id,
        "requested_start_at": viewing.requested_start_at,
        "requested_end_at": viewing.requested_end_at,
        "confirmed_start_at": viewing.confirmed_start_at,
        "confirmed_end_at": viewing.confirmed_end_at,
        "timezone": viewing.timezone,
        "status": viewing.status,
        "customer_note": viewing.customer_note,
        "mediator_note": viewing.mediator_note,
        "cancellation_reason": viewing.cancellation_reason,
        "cancelled_by": viewing.cancelled_by,
        "proposed_start_at": viewing.proposed_start_at,
        "proposed_end_at": viewing.proposed_end_at,
        "proposed_by": viewing.proposed_by,
        "interest_level": viewing.interest_level,
        "feedback_reason": viewing.feedback_reason,
        "feedback_note": viewing.feedback_note,
        "created_at": viewing.created_at,
        "updated_at": viewing.updated_at,
        "confirmed_at": viewing.confirmed_at,
        "cancelled_at": viewing.cancelled_at,
        "completed_at": viewing.completed_at,
        "property_title": prop.title if prop else None,
        "property_image_url": prop.image_url if prop else None,
        "property_area": prop.area if prop else None,
        "property_city": prop.city if prop else None,
        "mediator_agent_name": mediator.agency_name if mediator else None,
    }


# ── AI Viewing Checklist (Prompt 5) ─────────────────────────────────────────
#
# Generate-once trigger: the checklist (item list + AI annotations) is
# generated the first time it's accessed — either the first GET
# /viewings/{id} (which now embeds it) or the first PATCH .../checklist —
# whichever happens first, via get_or_build_checklist()'s
# `if viewing.checklist_state is not None: return it unchanged` guard.
# Confirming a viewing does NOT itself trigger generation; the checklist is
# useful earlier, while a request is still pending (brief §11: visible for
# confirmed OR pending viewings). Repeated calls after the first only
# read/patch the stored state, never regenerate it — so AI wording (once
# accepted) stays stable across the customer's visits to the screen.

def get_or_build_checklist(db: Session, viewing: PropertyViewing) -> dict:
    if viewing.checklist_state is not None:
        return viewing.checklist_state

    prop = viewing.property
    deterministic = viewing_checklist.build_checklist(prop)
    enhanced = viewing_checklist_ai.enhance_checklist(deterministic)

    state = asdict(enhanced)
    state["checked"] = {}
    viewing.checklist_state = state
    db.commit()
    db.refresh(viewing)
    return viewing.checklist_state


def apply_checklist_patch(
    db: Session,
    viewing: PropertyViewing,
    *,
    checked: dict[str, bool] | None,
    note: str | None,
) -> PropertyViewing:
    """Persists checked-state updates for EXISTING items only (an unknown
    item id in `checked` is silently ignored, never added as a new item)
    and/or appends a new private note. Never regenerates the checklist."""
    state = get_or_build_checklist(db, viewing)

    if checked:
        known_ids = {item["id"] for section in state["sections"] for item in section["items"]}
        merged_checked = dict(state.get("checked") or {})
        for item_id, value in checked.items():
            if item_id in known_ids:
                merged_checked[item_id] = bool(value)
        # Reassign the whole dict (not an in-place mutation) so SQLAlchemy's
        # JSONB change-tracking actually notices the update.
        viewing.checklist_state = {**state, "checked": merged_checked}

    if note:
        notes = list(viewing.private_notes or [])
        notes.append({"text": note[:2000], "created_at": datetime.now(timezone.utc).isoformat()})
        viewing.private_notes = notes

    db.commit()
    db.refresh(viewing)
    return viewing


def submit_feedback(
    db: Session,
    viewing: PropertyViewing,
    *,
    interest_level: str,
    note: str | None,
    reason: str | None,
) -> PropertyViewing:
    """Feedback on an already-completed viewing — no status transition
    (brief §16). `reason` is only meaningful when interest_level ==
    "Not Interested"; stored as-is otherwise since the schema layer already
    restricts when a caller may send it (see
    PropertyViewingFeedbackRequest's validator)."""
    if viewing.status != "completed":
        raise ViewingDomainError(409, "Feedback can only be submitted for a completed viewing")
    viewing.interest_level = interest_level
    viewing.feedback_note = note
    viewing.feedback_reason = reason
    db.commit()
    db.refresh(viewing)
    return viewing


def to_viewing_detail_out(db: Session, viewing: PropertyViewing) -> dict:
    """Customer-facing detail view — adds the (lazily generated) checklist
    and private notes on top of to_viewing_out(). NEVER used for the
    mediator-facing PartnerPropertyViewingOut — private_notes are
    customer-only (brief §15)."""
    base = to_viewing_out(viewing)
    base["checklist"] = get_or_build_checklist(db, viewing)
    base["private_notes"] = viewing.private_notes or []
    return base


def to_partner_viewing_out(viewing: PropertyViewing) -> dict:
    """Mediator-facing variant of to_viewing_out() — adds denormalized
    customer contact fields. See PartnerPropertyViewingOut's docstring for
    the privacy-bar rationale (matches, not exceeds, the existing
    lead-visibility bar)."""
    base = to_viewing_out(viewing)
    customer = viewing.customer
    base.update(
        {
            "customer_name": customer.full_name if customer else None,
            "customer_phone": customer.phone if customer else None,
            "customer_email": customer.email if customer else None,
        }
    )
    return base
