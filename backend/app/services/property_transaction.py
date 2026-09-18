"""Rental/Buy Transaction Workspace domain logic (Prompt 2 — auto-creation;
Prompt 4 — customer-facing mutations: document upload/delete, customer info
edit, information confirmation, cancellation, and the status/progress
recompute-and-persist glue around Prompt 3's deterministic engine). See
docs/implementation/mymakan-transaction-workspace.md.

`create_transaction_for_negotiation()` is called inline from
`app/services/property_negotiation.py::accept_offer()`, in the SAME
transaction as the negotiation's `accepted` status flip — mirrors how
`create_negotiation()` writes its first `NegotiationOffer` row alongside the
negotiation itself. Deliberately NOT an outbox-handler side effect: that
would run later (whenever the async publisher next ticks), and this feature
needs "negotiation accepted" and "transaction exists" to be atomic so a
caller reading the negotiation's `accepted_at` can always find its
transaction immediately. The unique constraint on
`PropertyTransaction.negotiation_id` is the real duplicate-prevention
backstop under a concurrent-accept race — see that column's docstring.
"""
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.core.outbox import EventType, record_event
from app.models.mediator import Mediator
from app.models.property_negotiation import PropertyNegotiation
from app.models.property_transaction import (
    DOCUMENT_TEMPLATES,
    PROPERTY_TRANSACTION_TRANSITIONS,
    PropertyTransaction,
    TransactionDocument,
)
from app.models.user import User
from app.services import transaction_progress
from app.services.transaction_progress import TransactionProgress

# Zero-padded digit width for `PropertyTransaction.reference` (e.g.
# "MYM-00042") — matches the brief's "MYM-XXXXX" example (5 X's).
_REFERENCE_DIGITS = 5

# Local-disk store under an authenticated download route — never a public
# static URL (transaction documents are private, unlike listing photos; see
# tracking doc's "Document/file-upload reality" inspection note, which
# confirmed no upload endpoint exists anywhere in this codebase to reuse).
# Resolved relative to this file so it's independent of the process's
# working directory: services/ -> app/ -> backend/ -> uploads/transactions.
UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "transactions"

# Conservative, demo-grade caps — identity/income documents are scans or
# PDFs, never large files.
ALLOWED_DOCUMENT_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
_EXTENSION_BY_CONTENT_TYPE = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}


class TransactionDomainError(Exception):
    """A business-rule violation the route layer translates into a specific
    HTTP status (never a generic 500) — mirrors
    property_negotiation.NegotiationDomainError exactly."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _generate_reference(transaction_id: int) -> str:
    """Deterministic (derived from the primary key, never random) — same
    "display id from the row's own id" convention as
    property_negotiation.build_agreement_summary()'s `NEG-{id:06d}`, just
    persisted as a real column here since the brief lists it as one."""
    return f"MYM-{transaction_id:0{_REFERENCE_DIGITS}d}"


def _seed_documents(db: Session, transaction: PropertyTransaction) -> None:
    """Seeds TransactionDocument rows from DOCUMENT_TEMPLATES, keyed by the
    transaction's own transaction_type ("rent"/"sale"). Falls back to the
    rent template for any unrecognized type rather than seeding zero
    documents — should never actually trigger since transaction_type is
    always copied from a validated Property.listing_type."""
    template = DOCUMENT_TEMPLATES.get(transaction.transaction_type, DOCUMENT_TEMPLATES["rent"])
    for entry in template:
        db.add(
            TransactionDocument(
                transaction_id=transaction.id,
                document_type=entry["document_type"],
                label=entry["label"],
                required=entry["required"],
                status="not_uploaded",
            )
        )


def create_transaction_for_negotiation(db: Session, negotiation: PropertyNegotiation) -> PropertyTransaction:
    """Auto-creates the single `PropertyTransaction` row for a just-accepted
    negotiation. Caller (accept_offer()) is responsible for having already
    flipped `negotiation.status` to "accepted" and flushed, so
    `negotiation.id` is available. Does NOT commit — same "write in the
    caller's transaction" convention as record_event()."""
    transaction = PropertyTransaction(
        reference="",  # placeholder — replaced below once transaction.id is assigned
        property_id=negotiation.property_id,
        transaction_type=negotiation.transaction_type,
        customer_user_id=negotiation.customer_user_id,
        mediator_id=negotiation.mediator_id,
        lead_id=negotiation.lead_id,
        negotiation_id=negotiation.id,
        viewing_id=negotiation.viewing_id,
        agreed_amount=negotiation.current_offer_amount,
        status="initiated",
        progress_percentage=0,
    )
    db.add(transaction)
    db.flush()  # assigns transaction.id, without committing

    transaction.reference = _generate_reference(transaction.id)
    _seed_documents(db, transaction)
    db.flush()

    # Transaction Workspace notifications (Prompt 6): notifies BOTH customer
    # and mediator, no `actor_user_id` — a new workspace for both, not an
    # actor-performed action (see app/tasks/transaction_notifications.py's
    # module docstring for the full trigger-point design).
    record_event(
        db,
        event_type=EventType.TRANSACTION_CREATED,
        aggregate_type="property_transaction",
        aggregate_id=transaction.id,
        payload={
            "transaction_id": transaction.id,
            "property_id": transaction.property_id,
            "customer_user_id": transaction.customer_user_id,
            "mediator_id": transaction.mediator_id,
        },
    )
    return transaction


def customer_info_snapshot(customer: User) -> dict:
    """Reuses existing User fields verbatim for the transaction's "My
    Information" checklist step (Prompt 3) — no new DB columns needed for
    the content itself (see PropertyTransaction.customer_info_confirmed_at's
    docstring for the one field that IS genuinely transaction-specific).
    `email` is always present (User.email is NOT NULL); `full_name`/`phone`
    are optional, matching User's own nullable columns — a customer with an
    incomplete profile genuinely has nothing to reuse there yet."""
    return {
        "email": customer.email,
        "full_name": customer.full_name,
        "phone": customer.phone,
    }


def to_document_out(document: TransactionDocument) -> dict:
    return {
        "id": document.id,
        "transaction_id": document.transaction_id,
        "document_type": document.document_type,
        "label": document.label,
        "required": document.required,
        "status": document.status,
        "file_reference": document.file_reference,
        "uploaded_at": document.uploaded_at,
        "reviewed_at": document.reviewed_at,
        "review_note": document.review_note,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


def to_transaction_out(transaction: PropertyTransaction, progress: TransactionProgress | None = None) -> dict:
    """Base field set + denormalized property/mediator display fields
    (mirrors property_negotiation.to_negotiation_out's own "avoid N+1
    fetches on list/detail screens" convention) + the deterministic engine's
    live-computed next_best_action/readiness_label (Prompt 3). `progress` may
    be passed in by a caller that already computed it (e.g. a mutating route
    that just called sync_progress_and_status()) to avoid recomputing twice;
    otherwise it's computed fresh here."""
    if progress is None:
        progress = transaction_progress.compute_transaction_progress(transaction)
    prop = transaction.property
    mediator = transaction.mediator
    return {
        "id": transaction.id,
        "reference": transaction.reference,
        "property_id": transaction.property_id,
        "transaction_type": transaction.transaction_type,
        "customer_user_id": transaction.customer_user_id,
        "mediator_id": transaction.mediator_id,
        "lead_id": transaction.lead_id,
        "negotiation_id": transaction.negotiation_id,
        "viewing_id": transaction.viewing_id,
        "agreed_amount": transaction.agreed_amount,
        "currency": transaction.currency,
        "status": transaction.status,
        "progress_percentage": transaction.progress_percentage,
        "customer_info_confirmed_at": transaction.customer_info_confirmed_at,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
        "ready_at": transaction.ready_at,
        "completed_at": transaction.completed_at,
        "cancelled_at": transaction.cancelled_at,
        "cancellation_reason": transaction.cancellation_reason,
        "cancelled_by": transaction.cancelled_by,
        "mediator_info_confirmed_at": transaction.mediator_info_confirmed_at,
        "property_title": prop.title if prop else None,
        "property_image_url": prop.image_url if prop else None,
        "property_area": prop.area if prop else None,
        "mediator_agent_name": mediator.agency_name if mediator else None,
        "next_best_action": {"key": progress.next_best_action.key, "message": progress.next_best_action.message},
        "readiness_label": progress.readiness_label,
    }


def _terms_snapshot(transaction: PropertyTransaction) -> dict | None:
    """Reuses property_negotiation.build_agreement_summary() verbatim rather
    than re-deriving the same facts a second way — see tracking doc's
    Prompt 1 inspection notes, bullet 1."""
    from app.services import property_negotiation as negotiation_service

    negotiation = transaction.negotiation
    if negotiation is None:
        return None
    return negotiation_service.build_agreement_summary(negotiation, list(negotiation.offers), transaction.property)


def to_transaction_detail_out(transaction: PropertyTransaction) -> dict:
    progress = transaction_progress.compute_transaction_progress(transaction)
    base = to_transaction_out(transaction, progress=progress)
    base["checklist"] = [
        {"key": s.key, "label": s.label, "status": s.status, "detail": s.detail} for s in progress.checklist
    ]
    base["documents"] = [to_document_out(d) for d in transaction.documents]
    base["customer_info"] = customer_info_snapshot(transaction.customer)
    base["terms_snapshot"] = _terms_snapshot(transaction)
    return base


# ── Status/progress recompute-and-persist (Prompt 4) ─────────────────────

def _status_reachable(current: str, target: str) -> bool:
    """BFS over PROPERTY_TRANSACTION_TRANSITIONS — the recompute below may
    want to jump straight from e.g. "initiated" to "ready_for_next_step" in
    one call (a customer whose profile/documents were already complete the
    moment the transaction was created), which isn't a *direct* edge in the
    transitions dict even though it's a legitimate multi-hop forward move.
    Guards against infinite loops via `seen` since the graph has a cycle
    among information_required/documents_required/under_review."""
    if current == target:
        return True
    seen = {current}
    frontier = [current]
    while frontier:
        nxt_frontier = []
        for node in frontier:
            for nxt in PROPERTY_TRANSACTION_TRANSITIONS.get(node, set()):
                if nxt == target:
                    return True
                if nxt not in seen:
                    seen.add(nxt)
                    nxt_frontier.append(nxt)
        frontier = nxt_frontier
    return False


def _recompute_status(transaction: PropertyTransaction, progress: TransactionProgress) -> str:
    """Maps the checklist's step-completion state onto one of
    PROPERTY_TRANSACTION_STATUSES's 8 values — documented in the tracking
    doc's "Checklist methodology". Never touches a terminal status
    (completed/cancelled are only ever set by their own dedicated actions,
    never by this recompute)."""
    if transaction.status in ("completed", "cancelled"):
        return transaction.status
    steps = {s.key: s.status for s in progress.checklist}
    if steps["customer_info"] != "done":
        return "information_required"
    if steps["documents_submitted"] != "done":
        return "documents_required"
    if steps["mediator_review"] != "done" or steps["terms_reconfirmed"] != "done":
        # Both "awaiting mediator review" and "awaiting customer
        # confirmation" map onto the same coarse-grained "under_review"
        # status — there is no dedicated status value for the latter (only
        # 8 statuses exist total, not one per checklist step).
        return "under_review"
    return "ready_for_next_step"


def sync_progress_and_status(db: Session, transaction: PropertyTransaction) -> TransactionProgress:
    """Recomputes the checklist/progress via Prompt 3's deterministic engine
    and persists `progress_percentage` + `status` (+ `ready_at`) onto the
    transaction row, so those stored columns never drift from the
    computation. Every mutating transaction route (document upload/delete,
    confirm-information, customer-information edit) MUST call this after
    changing any input the engine reads — this is the single place that
    decides when PROPERTY_TRANSACTION_TRANSITIONS actually gets applied (see
    tracking doc's "Known limitations": Prompt 3 deliberately left this to
    Prompt 4/5). Does NOT commit — caller's responsibility, same convention
    as create_transaction_for_negotiation()."""
    progress = transaction_progress.compute_transaction_progress(transaction)
    transaction.progress_percentage = progress.progress_percentage

    target = _recompute_status(transaction, progress)
    if target != transaction.status and _status_reachable(transaction.status, target):
        transaction.status = target
        if target == "ready_for_next_step" and transaction.ready_at is None:
            transaction.ready_at = datetime.now(timezone.utc)
            # Fires exactly once per transaction (guarded by ready_at being
            # freshly set here) — notifies BOTH parties, no actor_user_id,
            # same "shared milestone" rationale as TRANSACTION_CREATED. Body
            # embeds progress.readiness_label verbatim (the exact "Ready for
            # Rental Contract Process"/"Ready for Sale Process" string) —
            # never re-worded, per the feature's non-negotiable wording rule.
            record_event(
                db,
                event_type=EventType.TRANSACTION_READY,
                aggregate_type="property_transaction",
                aggregate_id=transaction.id,
                payload={
                    "transaction_id": transaction.id,
                    "customer_user_id": transaction.customer_user_id,
                    "mediator_id": transaction.mediator_id,
                    "readiness_label": progress.readiness_label,
                },
            )
    return progress


# ── Customer-facing lookups (Prompt 4) ────────────────────────────────────

def list_transactions_for_customer(db: Session, customer: User, status_filter: str | None = None) -> list[PropertyTransaction]:
    q = db.query(PropertyTransaction).filter(PropertyTransaction.customer_user_id == customer.id)
    if status_filter == "active":
        q = q.filter(~PropertyTransaction.status.in_(("completed", "cancelled")))
    elif status_filter == "completed":
        q = q.filter(PropertyTransaction.status == "completed")
    elif status_filter == "cancelled":
        q = q.filter(PropertyTransaction.status == "cancelled")
    return q.order_by(PropertyTransaction.updated_at.desc()).all()


def get_owned_transaction(db: Session, transaction_id: int, customer: User) -> PropertyTransaction:
    """Shared 404/403 lookup for every customer-side transaction route —
    same ownership rule as negotiations.py's _get_own_negotiation(). Never
    trusts a user id from the request body; the owner check is always
    against the authenticated `customer`."""
    transaction = db.get(PropertyTransaction, transaction_id)
    if not transaction:
        raise TransactionDomainError(404, "Transaction not found")
    if transaction.customer_user_id != customer.id:
        raise TransactionDomainError(403, "Not your transaction")
    return transaction


# ── Customer information (Prompt 4) ───────────────────────────────────────

def update_customer_information(db: Session, transaction: PropertyTransaction, *, full_name: str | None, phone: str | None) -> None:
    """Edits the underlying `User` row (not a transaction-specific table —
    see CustomerInformationUpdate's docstring). `None` means "leave
    unchanged"; an already-terminal transaction can still have its profile
    edited (this is account-level data, not transaction state) but the
    resulting recompute is a no-op for a terminal transaction either way."""
    customer = transaction.customer
    if full_name is not None:
        customer.full_name = full_name
    if phone is not None:
        customer.phone = phone
    db.flush()
    sync_progress_and_status(db, transaction)


# ── Information Confirmation (Prompt 4) ───────────────────────────────────

def confirm_information(db: Session, transaction: PropertyTransaction) -> None:
    """Sets the customer confirmation timestamp — NOT a signature (wording
    rule: this step is labeled "Information Confirmation", never "Sign
    Contract"). Blocked once the transaction is terminal."""
    if transaction.status in ("completed", "cancelled"):
        raise TransactionDomainError(409, f"Transaction is already {transaction.status}")
    transaction.customer_info_confirmed_at = datetime.now(timezone.utc)
    db.flush()
    sync_progress_and_status(db, transaction)


# ── Cancellation (Prompt 4) ───────────────────────────────────────────────

def cancel_transaction(db: Session, transaction: PropertyTransaction, *, reason: str, cancelled_by: str = "customer") -> None:
    if "cancelled" not in PROPERTY_TRANSACTION_TRANSITIONS.get(transaction.status, set()):
        raise TransactionDomainError(409, f"Cannot cancel a transaction that is already {transaction.status}")
    transaction.status = "cancelled"
    transaction.cancelled_at = datetime.now(timezone.utc)
    transaction.cancellation_reason = reason
    transaction.cancelled_by = cancelled_by
    db.flush()

    # Notifies whichever party did NOT cancel — resolved from cancelled_by
    # since this function isn't handed the acting User object directly.
    actor_user_id = (
        transaction.customer_user_id
        if cancelled_by == "customer"
        else (transaction.mediator.user_id if transaction.mediator else None)
    )
    record_event(
        db,
        event_type=EventType.TRANSACTION_CANCELLED,
        aggregate_type="property_transaction",
        aggregate_id=transaction.id,
        payload={
            "transaction_id": transaction.id,
            "customer_user_id": transaction.customer_user_id,
            "mediator_id": transaction.mediator_id,
            "reason": reason,
            "cancelled_by": cancelled_by,
            "actor_user_id": actor_user_id,
        },
    )


# ── Documents (Prompt 4) ──────────────────────────────────────────────────

def _require_non_terminal(transaction: PropertyTransaction) -> None:
    """Shared guard for every document-review mutation below — mirrors the
    identical check already enforced by upload_document()/confirm_information()/
    confirm_information_mediator(). A cancelled/completed transaction is
    terminal and must accept no further state changes from either side,
    including a mediator's own review actions on a document that happened
    to be `uploaded` at the moment of cancellation (P12 finding: accept/
    request-update/delete previously had no such guard, letting a mediator
    accept or bounce a document — and a customer delete one — on a
    transaction that was already dead)."""
    if transaction.status in ("completed", "cancelled"):
        raise TransactionDomainError(409, f"Transaction is already {transaction.status}")


def _document_editable(document: TransactionDocument) -> bool:
    """A document can only be (re)uploaded or removed while it's not yet
    locked in the mediator's queue — "under mediator review" (status
    "uploaded", awaiting a decision) and "accepted" (final) both block
    edits; "needs_update" (mediator flagged it) re-opens editing so the
    customer can fix and resubmit. Mirrors the brief's own DELETE
    constraint ("only where the document isn't yet accepted/under mediator
    review") — POST (upload/re-upload) uses the identical gate for
    consistency."""
    return document.status in ("not_uploaded", "needs_update")


def _get_owned_document(transaction: PropertyTransaction, document_id: int) -> TransactionDocument:
    document = next((d for d in transaction.documents if d.id == document_id), None)
    if document is None:
        raise TransactionDomainError(404, "Document not found")
    return document


def _document_disk_path(transaction_id: int, document_id: int, content_type: str) -> Path:
    ext = _EXTENSION_BY_CONTENT_TYPE.get(content_type, "")
    return UPLOAD_ROOT / str(transaction_id) / f"{document_id}_{uuid.uuid4().hex}{ext}"


def upload_document(db: Session, transaction: PropertyTransaction, document_id: int, file: UploadFile) -> TransactionDocument:
    document = _get_owned_document(transaction, document_id)
    if not _document_editable(document):
        raise TransactionDomainError(409, f"Document cannot be uploaded while it is {document.status}")
    if transaction.status in ("completed", "cancelled"):
        raise TransactionDomainError(409, f"Transaction is already {transaction.status}")

    content_type = file.content_type or ""
    if content_type not in ALLOWED_DOCUMENT_CONTENT_TYPES:
        raise TransactionDomainError(422, f"Unsupported file type '{content_type}' — allowed: {sorted(ALLOWED_DOCUMENT_CONTENT_TYPES)}")

    contents = file.file.read()
    if len(contents) > MAX_DOCUMENT_SIZE_BYTES:
        raise TransactionDomainError(422, f"File exceeds the {MAX_DOCUMENT_SIZE_BYTES // (1024 * 1024)}MB limit")
    if len(contents) == 0:
        raise TransactionDomainError(422, "File is empty")

    # Replace, don't accumulate, any previously stored file for this
    # document (a needs_update re-upload) — no history table for old files.
    if document.file_reference:
        old_path = Path(document.file_reference)
        if old_path.exists():
            old_path.unlink()

    target_path = _document_disk_path(transaction.id, document.id, content_type)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(contents)

    document.file_reference = str(target_path)
    document.status = "uploaded"
    document.uploaded_at = datetime.now(timezone.utc)
    # A fresh upload supersedes whatever the mediator said about the
    # previous file — stale review feedback shouldn't linger once the
    # customer has already acted on it.
    document.reviewed_at = None
    document.review_note = None
    db.flush()
    sync_progress_and_status(db, transaction)

    # Mediator only — the customer already gets a synchronous API response
    # confirming their own upload, so notifying them too would be a
    # pointless self-notification (see transaction_notifications.py's
    # module docstring).
    record_event(
        db,
        event_type=EventType.TRANSACTION_DOCUMENT_UPLOADED,
        aggregate_type="property_transaction",
        aggregate_id=transaction.id,
        payload={
            "transaction_id": transaction.id,
            "customer_user_id": transaction.customer_user_id,
            "mediator_id": transaction.mediator_id,
            "document_id": document.id,
            "document_label": document.label,
            "actor_user_id": transaction.customer_user_id,
        },
    )
    return document


def delete_document(db: Session, transaction: PropertyTransaction, document_id: int) -> TransactionDocument:
    document = _get_owned_document(transaction, document_id)
    _require_non_terminal(transaction)
    if not _document_editable(document):
        raise TransactionDomainError(409, f"Document cannot be removed while it is {document.status}")
    if document.status == "not_uploaded":
        raise TransactionDomainError(409, "Nothing uploaded for this document yet")

    if document.file_reference:
        path = Path(document.file_reference)
        if path.exists():
            path.unlink()

    document.file_reference = None
    document.status = "not_uploaded"
    document.uploaded_at = None
    document.reviewed_at = None
    document.review_note = None
    db.flush()
    sync_progress_and_status(db, transaction)
    return document


def document_file_path(transaction: PropertyTransaction, document_id: int) -> Path:
    """For the authenticated download route — never a public/static URL
    (see UPLOAD_ROOT's docstring)."""
    document = _get_owned_document(transaction, document_id)
    if not document.file_reference:
        raise TransactionDomainError(404, "No file uploaded for this document")
    path = Path(document.file_reference)
    if not path.exists():
        raise TransactionDomainError(404, "File no longer available")
    return path


# ── Partner / mediator lookups (Prompt 5) ─────────────────────────────────

def list_transactions_for_mediator(db: Session, mediator: Mediator, status_filter: str | None = None) -> list[PropertyTransaction]:
    """Mediator's own transactions (assigned via `PropertyTransaction.mediator_id`,
    copied from the negotiation at auto-creation time — never a live
    Property.mediator_id re-lookup). `status_filter` buckets the raw 8-value
    status column into the brief's own dashboard tabs rather than exposing it
    directly:

    - "action_required": at least one document is `uploaded` (submitted,
      awaiting this mediator's accept/request-update decision) — the one
      concrete thing only the mediator can unblock right now.
    - "active": non-terminal, not yet ready, and nothing currently awaiting
      mediator review (the next move belongs to the customer).
    - "ready": `ready_for_next_step` or `external_process_pending`.
    - "completed" / "cancelled": mirrors the terminal status directly.

    These five buckets partition every transaction exactly once. Omitted/
    unrecognized `status_filter` returns everything."""
    q = db.query(PropertyTransaction).filter(PropertyTransaction.mediator_id == mediator.id)
    pending_review = PropertyTransaction.documents.any(TransactionDocument.status == "uploaded")
    if status_filter == "action_required":
        q = q.filter(~PropertyTransaction.status.in_(("completed", "cancelled")), pending_review)
    elif status_filter == "active":
        q = q.filter(
            ~PropertyTransaction.status.in_(("completed", "cancelled", "ready_for_next_step", "external_process_pending")),
            ~pending_review,
        )
    elif status_filter == "ready":
        q = q.filter(PropertyTransaction.status.in_(("ready_for_next_step", "external_process_pending")))
    elif status_filter == "completed":
        q = q.filter(PropertyTransaction.status == "completed")
    elif status_filter == "cancelled":
        q = q.filter(PropertyTransaction.status == "cancelled")
    return q.order_by(PropertyTransaction.updated_at.desc()).all()


def get_owned_transaction_for_mediator(db: Session, transaction_id: int, mediator: Mediator) -> PropertyTransaction:
    """Shared 404/403 lookup for every partner-side transaction route — same
    shape as get_owned_transaction()'s customer-side ownership rule, gated on
    `mediator_id` instead. Never trusts a mediator id from the request body."""
    transaction = db.get(PropertyTransaction, transaction_id)
    if not transaction:
        raise TransactionDomainError(404, "Transaction not found")
    if transaction.mediator_id != mediator.id:
        raise TransactionDomainError(403, "Not your transaction")
    return transaction


def _partner_customer_snapshot(customer: User | None) -> dict:
    """Deliberately narrower than customer_info_snapshot() (no email/phone):
    the transaction workspace's document-review flow needs to know who
    they're reviewing for, not how to contact them — that's the existing
    lead/negotiation messaging channel's job, not this endpoint's (brief:
    "only fields needed for the transaction — not full customer PII")."""
    return {"full_name": customer.full_name if customer else None}


def to_partner_transaction_out(transaction: PropertyTransaction, progress: TransactionProgress | None = None) -> dict:
    """Mediator-facing variant of to_transaction_out() — adds only the
    customer's display name on top of the base fields every transaction
    response already carries."""
    base = to_transaction_out(transaction, progress=progress)
    base["customer_name"] = transaction.customer.full_name if transaction.customer else None
    return base


def to_partner_transaction_detail_out(transaction: PropertyTransaction) -> dict:
    """Mediator-facing variant of to_transaction_detail_out() — same
    checklist/documents/terms_snapshot, but a restricted `customer` snapshot
    (see _partner_customer_snapshot()) instead of the customer's own full
    `customer_info` (which includes email)."""
    progress = transaction_progress.compute_transaction_progress(transaction)
    base = to_partner_transaction_out(transaction, progress=progress)
    base["checklist"] = [
        {"key": s.key, "label": s.label, "status": s.status, "detail": s.detail} for s in progress.checklist
    ]
    base["documents"] = [to_document_out(d) for d in transaction.documents]
    base["customer"] = _partner_customer_snapshot(transaction.customer)
    base["terms_snapshot"] = _terms_snapshot(transaction)
    return base


# ── Partner / mediator document review (Prompt 5) ─────────────────────────

def accept_document(db: Session, transaction: PropertyTransaction, document_id: int) -> TransactionDocument:
    """Mediator's "Accept" action — only valid while the document is
    `uploaded` (submitted, awaiting review). The mediator can never alter the
    uploaded file itself (`file_reference` is untouched here), only its
    review status/note."""
    document = _get_owned_document(transaction, document_id)
    _require_non_terminal(transaction)
    if document.status != "uploaded":
        raise TransactionDomainError(409, f"Document cannot be accepted while it is {document.status}")
    document.status = "accepted"
    document.reviewed_at = datetime.now(timezone.utc)
    document.review_note = None
    db.flush()
    sync_progress_and_status(db, transaction)

    # Customer only — the mediator performed this action, never self-notify.
    record_event(
        db,
        event_type=EventType.TRANSACTION_DOCUMENT_ACCEPTED,
        aggregate_type="property_transaction",
        aggregate_id=transaction.id,
        payload={
            "transaction_id": transaction.id,
            "customer_user_id": transaction.customer_user_id,
            "mediator_id": transaction.mediator_id,
            "document_id": document.id,
            "document_label": document.label,
        },
    )
    return document


def request_document_update(db: Session, transaction: PropertyTransaction, document_id: int, reason: str) -> TransactionDocument:
    """Mediator's "Request Update" action — same `uploaded`-only gate as
    accept_document(); sets the document back to `needs_update` with the
    mediator's reason, which reopens it for re-upload via the customer-side
    `_document_editable()` gate. Never touches `file_reference`."""
    document = _get_owned_document(transaction, document_id)
    _require_non_terminal(transaction)
    if document.status != "uploaded":
        raise TransactionDomainError(409, f"Document cannot be sent back for update while it is {document.status}")
    document.status = "needs_update"
    document.reviewed_at = datetime.now(timezone.utc)
    document.review_note = reason
    db.flush()
    progress = sync_progress_and_status(db, transaction)

    # Two distinct customer-facing notifications from this one mutation
    # (see transaction_notifications.py's module docstring): a specific
    # "this document needs a fix" detail, plus a general "you have an
    # action required" nudge carrying the live deterministic Next Best
    # Action message so it never goes stale relative to Prompt 3's engine.
    record_event(
        db,
        event_type=EventType.TRANSACTION_DOCUMENT_UPDATE_REQUESTED,
        aggregate_type="property_transaction",
        aggregate_id=transaction.id,
        payload={
            "transaction_id": transaction.id,
            "customer_user_id": transaction.customer_user_id,
            "mediator_id": transaction.mediator_id,
            "document_id": document.id,
            "document_label": document.label,
            "reason": reason,
        },
    )
    record_event(
        db,
        event_type=EventType.TRANSACTION_ACTION_REQUIRED,
        aggregate_type="property_transaction",
        aggregate_id=transaction.id,
        payload={
            "transaction_id": transaction.id,
            "customer_user_id": transaction.customer_user_id,
            "mediator_id": transaction.mediator_id,
            "next_best_action": progress.next_best_action.message,
        },
    )
    return document


# ── Partner / mediator information confirmation (Prompt 5) ────────────────

def confirm_information_mediator(db: Session, transaction: PropertyTransaction) -> None:
    """Mediator-side "property and commercial information confirmed"
    timestamp — a separate column/actor from the customer's own
    confirm_information(). Same terminal-status guard as the customer
    action."""
    if transaction.status in ("completed", "cancelled"):
        raise TransactionDomainError(409, f"Transaction is already {transaction.status}")
    transaction.mediator_info_confirmed_at = datetime.now(timezone.utc)
    db.flush()
    sync_progress_and_status(db, transaction)


# ── Admin read-only visibility (Prompt 7) ──────────────────────────────────
# No admin mutation actions on this feature — see tracking doc's "Known
# limitations" for the read-only-by-design decision.

_ADMIN_SORT_COLUMNS = {
    "created_at": PropertyTransaction.created_at,
    "updated_at": PropertyTransaction.updated_at,
    "progress_percentage": PropertyTransaction.progress_percentage,
}


def list_transactions_for_admin(
    db: Session,
    *,
    status_filter: str | None = None,
    transaction_type: str | None = None,
    mediator_id: int | None = None,
    customer_user_id: int | None = None,
    sort: str = "updated_at",
    order: str = "desc",
) -> list[PropertyTransaction]:
    q = db.query(PropertyTransaction)
    if status_filter:
        q = q.filter(PropertyTransaction.status == status_filter)
    if transaction_type:
        q = q.filter(PropertyTransaction.transaction_type == transaction_type)
    if mediator_id is not None:
        q = q.filter(PropertyTransaction.mediator_id == mediator_id)
    if customer_user_id is not None:
        q = q.filter(PropertyTransaction.customer_user_id == customer_user_id)
    column = _ADMIN_SORT_COLUMNS.get(sort, PropertyTransaction.updated_at)
    q = q.order_by(column.asc() if order == "asc" else column.desc())
    return q.all()


def get_transaction_for_admin(db: Session, transaction_id: int) -> PropertyTransaction:
    """No ownership check (unlike get_owned_transaction()/
    get_owned_transaction_for_mediator()) — admin can look up any
    transaction by id, gated only by get_admin_user at the route layer."""
    transaction = db.get(PropertyTransaction, transaction_id)
    if not transaction:
        raise TransactionDomainError(404, "Transaction not found")
    return transaction


def _admin_participant_fields(transaction: PropertyTransaction) -> dict:
    customer = transaction.customer
    return {
        "customer_name": customer.full_name if customer else None,
        "customer_email": customer.email if customer else None,
    }


def to_admin_transaction_out(transaction: PropertyTransaction, progress: TransactionProgress | None = None) -> dict:
    """Admin-facing list variant — reuses to_transaction_out() verbatim, adds
    the customer's display name/email (broader than the partner's name-only
    privacy bar, since this is an internal admin-only surface)."""
    base = to_transaction_out(transaction, progress=progress)
    base.update(_admin_participant_fields(transaction))
    return base


def list_transaction_timeline(db: Session, transaction_id: int) -> list[dict]:
    """Reads this transaction's own OutboxEvent rows directly — there is no
    separate event-log/history table for PropertyTransaction (see that
    model's own docstring), and every one of this feature's seven event
    types (Prompt 6) is already recorded against
    aggregate_type="property_transaction" / aggregate_id=str(transaction.id)
    in the same DB transaction as the mutation it describes, so this is a
    read-only reuse of data that already exists rather than a new history
    mechanism."""
    from app.models.outbox_event import OutboxEvent

    events = (
        db.query(OutboxEvent)
        .filter(OutboxEvent.aggregate_type == "property_transaction", OutboxEvent.aggregate_id == str(transaction_id))
        .order_by(OutboxEvent.created_at.asc())
        .all()
    )
    return [{"event_type": e.event_type, "created_at": e.created_at, "payload": e.payload} for e in events]


def to_admin_transaction_detail_out(db: Session, transaction: PropertyTransaction) -> dict:
    """Admin-facing detail variant — reuses to_transaction_detail_out()
    verbatim (checklist/documents/customer_info/terms_snapshot, the latter
    already carrying negotiation_reference), adds the same participant
    fields as to_admin_transaction_out() plus the OutboxEvent-derived
    timeline above."""
    base = to_transaction_detail_out(transaction)
    base.update(_admin_participant_fields(transaction))
    base["timeline"] = list_transaction_timeline(db, transaction.id)
    return base
