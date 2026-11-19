"""Self-service customer account deletion (Google Play account-deletion policy).

Why the users row is never DELETEd
----------------------------------
Bookings, contracts, leads, negotiations, transactions and viewings reference
``users.id`` with ON DELETE RESTRICT; those are financial / contractual records
that must be retained. Other tables would CASCADE (e.g. ``mediators`` and every
property request with its partner responses). A hard delete therefore either
fails or silently destroys other parties' data. Instead, deletion:

1. refuses while the account has unresolved obligations (``find_blockers``);
2. hard-deletes rows that exist only for the user's own benefit (push devices,
   notifications, saved searches/properties, search history, digests, financing
   interest);
3. anonymizes the users row and the contact details copied into retained
   records (lead contact snapshot, public review author name), and detaches
   analytics / AI-usage rows;
4. deactivates the account — ``is_active=False`` makes ``deps.user_from_token``
   reject every token already issued, which is the session revocation (auth is
   stateless JWT; there is no session table to clear);
5. writes one audit entry, in the same transaction.

Everything happens in one DB transaction: any failure rolls back completely.

Decisions marked ``DECISION:`` below need legal / business confirmation
(see the release report); the defaults are the conservative choice.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.roles import is_admin_user
from app.models.ai_call_log import AICallLog
from app.models.analytics_event import AnalyticsEvent
from app.models.booking import Booking
from app.models.contract import Contract
from app.models.device import Device
from app.models.digest_run import DigestRun
from app.models.financing_interest import FinancingInterest
from app.models.home_finder_search import HomeFinderSearch
from app.models.lead import Lead
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.models.notification_preference import NotificationPreference
from app.models.payment import Payment
from app.models.property_negotiation import PropertyNegotiation
from app.models.property_request import PROPERTY_REQUEST_TERMINAL_STATUSES, PropertyRequest
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PROPERTY_VIEWING_INACTIVE_STATUSES, PropertyViewing
from app.models.review import Review
from app.models.saved_property import SavedProperty
from app.models.saved_search import SavedSearch
from app.models.saved_search_match import SavedSearchMatch
from app.models.user import User

DELETED_EMAIL_DOMAIN = "deleted.maskanai.invalid"  # RFC 2606 .invalid — can never receive mail
DELETED_DISPLAY_NAME = "Deleted user"

_TRANSACTION_CLOSED = ("completed", "cancelled")
_NEGOTIATION_OPEN = ("submitted", "countered", "accepted")
_CONTRACT_OPEN = ("draft", "pending_signature", "active")
_LEAD_OPEN = ("pending_review", "open", "assigned", "in_progress", "pending_closure")
_PAYMENT_OPEN = ("pending",)


@dataclass(frozen=True)
class Blocker:
    code: str
    count: int


@dataclass
class DeletionResult:
    deleted: dict[str, int] = field(default_factory=dict)
    anonymized: dict[str, int] = field(default_factory=dict)
    retained: dict[str, int] = field(default_factory=dict)


def _count(db: Session, stmt) -> int:
    return int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)


def find_blockers(db: Session, user: User) -> list[Blocker]:
    """Unresolved obligations that must be closed (by the customer, the partner
    or support) before the account can be deleted. Empty list = eligible."""
    uid = user.id
    today = date.today()
    checks: list[tuple[str, object]] = [
        # Partner (mediator) accounts own listings, leads and payouts on behalf
        # of other customers — never self-deletable from the customer app.
        ("partner_account", select(Mediator.id).where(Mediator.user_id == uid)),
        ("active_transactions", select(PropertyTransaction.id).where(
            PropertyTransaction.customer_user_id == uid,
            PropertyTransaction.status.not_in(_TRANSACTION_CLOSED))),
        ("active_negotiations", select(PropertyNegotiation.id).where(
            PropertyNegotiation.customer_user_id == uid,
            PropertyNegotiation.status.in_(_NEGOTIATION_OPEN))),
        ("upcoming_viewings", select(PropertyViewing.id).where(
            PropertyViewing.customer_user_id == uid,
            PropertyViewing.status.not_in(PROPERTY_VIEWING_INACTIVE_STATUSES))),
        ("upcoming_bookings", select(Booking.id).where(
            Booking.renter_user_id == uid,
            Booking.status != "cancelled",
            Booking.check_out >= today)),
        ("open_contracts", select(Contract.id).where(
            Contract.tenant_user_id == uid,
            Contract.status.in_(_CONTRACT_OPEN))),
        ("open_leads", select(Lead.id).where(
            Lead.customer_user_id == uid,
            Lead.status.in_(_LEAD_OPEN))),
        # DECISION: drafts are not blocking (nobody else has acted on them);
        # they are cancelled below. Any request partners can see blocks.
        ("active_property_requests", select(PropertyRequest.id).where(
            PropertyRequest.user_id == uid,
            PropertyRequest.status.not_in((*PROPERTY_REQUEST_TERMINAL_STATUSES, "draft")))),
        ("pending_payments", select(Payment.id).where(
            Payment.user_id == uid,
            Payment.status.in_(_PAYMENT_OPEN))),
    ]
    blockers = []
    for code, stmt in checks:
        n = _count(db, stmt)
        if n:
            blockers.append(Blocker(code=code, count=n))
    return blockers


def _retained_counts(db: Session, uid: int) -> dict[str, int]:
    return {
        "transactions": _count(db, select(PropertyTransaction.id).where(PropertyTransaction.customer_user_id == uid)),
        "bookings": _count(db, select(Booking.id).where(Booking.renter_user_id == uid)),
        "contracts": _count(db, select(Contract.id).where(Contract.tenant_user_id == uid)),
        "payments": _count(db, select(Payment.id).where(Payment.user_id == uid)),
        "negotiations": _count(db, select(PropertyNegotiation.id).where(PropertyNegotiation.customer_user_id == uid)),
        "viewings": _count(db, select(PropertyViewing.id).where(PropertyViewing.customer_user_id == uid)),
        "leads": _count(db, select(Lead.id).where(Lead.customer_user_id == uid)),
    }


def delete_account(db: Session, user: User, *, actor: User | None = None) -> DeletionResult:
    """Delete/anonymize ``user`` and commit.

    ``actor=None`` is customer self-service (the caller re-authenticated the
    user). ``actor=<admin>`` is admin-initiated deletion (the caller enforced
    admin authorization); it applies exactly the same blockers and retention
    rules, and is audited as ``account.admin_deleted`` attributed to the admin.
    Blockers are re-checked here, inside the same transaction, to close the
    race with the caller's own check."""
    if is_admin_user(user):
        raise PermissionError("admin accounts cannot be deleted")
    if actor is not None and actor.id == user.id:
        raise PermissionError("admins cannot delete their own account")
    if user.deleted_at is not None:
        raise ValueError("account already deleted")
    if find_blockers(db, user):
        raise ValueError("account has unresolved obligations")

    uid = user.id
    now = datetime.now(timezone.utc)
    result = DeletionResult()
    retained = _retained_counts(db, uid)
    result.retained = {k: v for k, v in retained.items() if v}

    # DECISION: when financial/contractual records are retained, a minimal
    # identity snapshot is kept in the (admin-only) audit entry so those
    # records stay attributable for legal/tax purposes. Customer details on
    # transactions are read live from users (no snapshot column), so without
    # this they would become unattributable once the row is anonymized.
    has_financial = any(retained[k] for k in ("transactions", "bookings", "contracts", "payments"))
    retained_identity = (
        {"full_name": user.full_name, "email": user.email, "phone": user.phone} if has_financial else None
    )

    # 1. Rows that exist only for the user's own benefit — hard delete.
    #    Children are removed first so nothing relies on FK cascade order.
    for label, model, col in (
        ("devices", Device, Device.user_id),
        ("saved_search_matches", SavedSearchMatch, SavedSearchMatch.user_id),
        ("notifications", Notification, Notification.user_id),  # deliveries cascade
        ("notification_preferences", NotificationPreference, NotificationPreference.user_id),
        ("saved_searches", SavedSearch, SavedSearch.user_id),
        ("saved_properties", SavedProperty, SavedProperty.user_id),
        ("home_finder_searches", HomeFinderSearch, HomeFinderSearch.user_id),
        ("digest_runs", DigestRun, DigestRun.user_id),
        ("financing_interests", FinancingInterest, FinancingInterest.renter_user_id),
    ):
        n = db.execute(delete(model).where(col == uid).execution_options(synchronize_session=False)).rowcount
        if n:
            result.deleted[label] = n

    # 2. Draft property requests nobody else has acted on → cancelled (not
    #    deleted: revisions/activities cascade from them and stay consistent).
    n = db.execute(update(PropertyRequest).where(
        PropertyRequest.user_id == uid, PropertyRequest.status == "draft",
    ).values(status="cancelled").execution_options(synchronize_session=False)).rowcount
    if n:
        result.anonymized["draft_property_requests_cancelled"] = n

    # 3. Contact details copied into retained records.
    # DECISION: lead contact snapshots are anonymized (every lead is closed by
    # now — open ones block). Bookings' guest_name/guest_phone and transaction
    # documents are retained unchanged as financial/contractual records.
    anon_email = f"deleted-user-{uid}-{secrets.token_hex(4)}@{DELETED_EMAIL_DOMAIN}"
    n = db.execute(update(Lead).where(Lead.customer_user_id == uid).values(
        customer_name=DELETED_DISPLAY_NAME, customer_phone="", customer_email=anon_email,
    ).execution_options(synchronize_session=False)).rowcount
    if n:
        result.anonymized["lead_contact_details"] = n
    # Reviews stay (they belong to the partner's public rating) without the author name.
    n = db.execute(update(Review).where(Review.user_id == uid).values(reviewer_name=None)
                   .execution_options(synchronize_session=False)).rowcount
    if n:
        result.anonymized["review_author_names"] = n
    # Usage telemetry is kept only in de-identified form.
    for label, model in (("analytics_events", AnalyticsEvent), ("ai_call_logs", AICallLog)):
        n = db.execute(update(model).where(model.user_id == uid).values(user_id=None)
                       .execution_options(synchronize_session=False)).rowcount
        if n:
            result.anonymized[label] = n

    # 4. The account itself.
    user.email = anon_email
    user.full_name = None
    user.phone = None
    # A random secret nobody knows — the account can never be logged into again.
    from app.api.routes.auth import hash_password  # local import: avoid route↔service cycle
    user.hashed_password = hash_password(secrets.token_urlsafe(48))
    user.verification_document_ref = None
    user.moyasar_card_token = None
    if user.subscription_status in ("active", "pending_payment"):
        # DECISION: premium access ends immediately; no automatic refund is
        # issued (renewal is manual-only, so nothing will charge again).
        user.subscription_status = "cancelled"
    user.is_active = False
    user.deleted_at = now
    result.anonymized["user_profile"] = 1

    metadata: dict = {
        "initiated_by": "admin" if actor is not None else "self",
        "deleted": result.deleted,
        "anonymized": result.anonymized,
        "retained": result.retained,
    }
    if actor is not None:
        metadata["admin_user_id"] = actor.id
    if retained_identity:
        metadata["retained_identity"] = retained_identity
    record_audit(
        db,
        user_id=actor.id if actor is not None else uid,
        action="account.admin_deleted" if actor is not None else "account.self_deleted",
        entity_type="user",
        entity_id=uid,
        metadata=metadata,
    )
    db.commit()
    return result
