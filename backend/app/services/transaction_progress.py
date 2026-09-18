"""Rental/Buy Transaction Workspace — deterministic checklist/progress/Next
Best Action/readiness engine (Prompt 3). See
docs/implementation/mymakan-transaction-workspace.md ("Checklist methodology"
/ "Progress methodology" sections for the exact formula and priority order
documented alongside this module).

This is the single source of truth for everything in this module's name —
the future customer/partner/admin API layers (Prompt 4/5/7) call
`compute_transaction_progress()` and MUST NOT recompute any of this
themselves; frontend/mobile must never recompute it either (brief's own
"centralize checklist rules" instruction). Everything here is a pure
function of a `PropertyTransaction` + its `TransactionDocument` rows +
`PropertyTransaction.customer_info_confirmed_at` — no AI, no randomness, no
wall-clock dependence, so the same input always produces the same output.

Only `PropertyTransaction.customer_info_confirmed_at` exists today as a
confirmation flag (Prompt 2's model) — there is no separate mediator-side
"commercial information confirmed" column yet (Prompt 5's own brief mentions
a future mediator-side confirm-information action, but adding its storage is
that prompt's job, not this one's). Given that, this module deliberately
splits the "customer info" concept across two of the six checklist steps
using only what already exists:

- `customer_info` (step 2): profile-completeness check — does the customer's
  `User.full_name`/`User.phone` snapshot (see
  `property_transaction.customer_info_snapshot()`) have both fields filled
  in. Purely derived, no confirmation action involved.
- `terms_reconfirmed` (step 5): the actual "Information Confirmation" action
  (Prompt 9's "My information is correct" button), i.e. whether
  `customer_info_confirmed_at` is set. This is the brief's "mutual-
  confirmation step" labeled exactly "Information Confirmation" (never "Sign
  Contract").
"""
from dataclasses import dataclass

from app.models.property_transaction import PropertyTransaction, TransactionDocument

# Exact, non-negotiable final-state wording (global constraints) — never
# "Transaction complete", "Ownership transferred", or "Ejar completed".
READY_LABELS: dict[str, str] = {
    "rent": "Ready for Rental Contract Process",
    "sale": "Ready for Sale Process",
}

# The mutual-confirmation checklist step's exact label — never "Sign
# Contract" (global constraint).
INFORMATION_CONFIRMATION_LABEL = "Information Confirmation"

# Checklist step statuses.
STEP_DONE = "done"
STEP_IN_PROGRESS = "in_progress"
STEP_PENDING = "pending"

# Readiness labels below the final ready state (which uses READY_LABELS
# instead of a generic "Ready for Next Step" string once truly ready).
READINESS_NOT_READY = "Not Ready"
READINESS_ALMOST_READY = "Almost Ready"

# progress_percentage weighting — documented in the tracking doc's "Progress
# methodology" section. Sums to exactly 100 once every step is fully done
# (each weight below is that step's maximum contribution).
_WEIGHT_OFFER_AGREED = 10
_WEIGHT_CUSTOMER_INFO = 15
_WEIGHT_DOCUMENTS_SUBMITTED = 25
_WEIGHT_MEDIATOR_REVIEW = 25
_WEIGHT_TERMS_RECONFIRMED = 15
_WEIGHT_READY_BONUS = 10


@dataclass(frozen=True)
class ChecklistStep:
    key: str
    label: str
    status: str  # STEP_DONE | STEP_IN_PROGRESS | STEP_PENDING
    detail: str | None = None  # e.g. "2/3" — present only when meaningful


@dataclass(frozen=True)
class NextBestAction:
    key: str
    message: str


@dataclass(frozen=True)
class TransactionProgress:
    checklist: list[ChecklistStep]
    progress_percentage: int
    next_best_action: NextBestAction
    readiness_label: str


def _final_step_label(transaction_type: str) -> str:
    return READY_LABELS.get(transaction_type, READY_LABELS["rent"])


def _customer_info_field_counts(transaction: PropertyTransaction) -> tuple[int, int]:
    """(fields_present, fields_total) among full_name/phone — email is
    excluded since `User.email` is NOT NULL and therefore always present, so
    counting it would never let this fraction show anything but "done"."""
    customer = transaction.customer
    total = 2
    present = 0
    if customer is not None:
        if customer.full_name:
            present += 1
        if customer.phone:
            present += 1
    return present, total


def _required_documents(documents: list[TransactionDocument]) -> list[TransactionDocument]:
    return sorted((d for d in documents if d.required), key=lambda d: d.id)


def _document_counts(documents: list[TransactionDocument]) -> dict[str, int]:
    required = _required_documents(documents)
    required_total = len(required)
    required_submitted = sum(1 for d in required if d.status != "not_uploaded")
    required_accepted = sum(1 for d in required if d.status == "accepted")
    return {
        "required_total": required_total,
        "required_submitted": required_submitted,
        "required_accepted": required_accepted,
    }


def _customer_info_done(transaction: PropertyTransaction) -> bool:
    present, total = _customer_info_field_counts(transaction)
    return present == total


def _documents_submitted_done(counts: dict[str, int]) -> bool:
    # Vacuously done if a transaction type ever seeds zero required
    # documents (not the case for today's rent/sale templates, both 2
    # required + 1 optional, but avoids a spurious "pending" forever if that
    # ever changes).
    return counts["required_submitted"] >= counts["required_total"]


def _mediator_review_done(counts: dict[str, int]) -> bool:
    return counts["required_accepted"] >= counts["required_total"]


def _terms_reconfirmed_done(transaction: PropertyTransaction) -> bool:
    return transaction.customer_info_confirmed_at is not None


def compute_checklist(transaction: PropertyTransaction, documents: list[TransactionDocument]) -> list[ChecklistStep]:
    counts = _document_counts(documents)
    present, total = _customer_info_field_counts(transaction)
    customer_info_done = present == total
    documents_done = _documents_submitted_done(counts)
    review_done = _mediator_review_done(counts)
    terms_done = _terms_reconfirmed_done(transaction)
    fully_ready = customer_info_done and documents_done and review_done and terms_done

    steps = [
        ChecklistStep(key="offer_agreed", label="Offer Agreed", status=STEP_DONE),
        ChecklistStep(
            key="customer_info",
            label="Customer Information",
            status=STEP_DONE if customer_info_done else (STEP_IN_PROGRESS if present > 0 else STEP_PENDING),
            detail=None if customer_info_done else f"{present}/{total}",
        ),
        ChecklistStep(
            key="documents_submitted",
            label="Documents Submitted",
            status=(
                STEP_DONE
                if documents_done
                else (STEP_IN_PROGRESS if counts["required_submitted"] > 0 else STEP_PENDING)
            ),
            detail=None if documents_done else f"{counts['required_submitted']}/{counts['required_total']}",
        ),
        ChecklistStep(
            key="mediator_review",
            label="Mediator Review",
            status=(
                STEP_DONE
                if review_done
                else (STEP_IN_PROGRESS if counts["required_submitted"] > 0 else STEP_PENDING)
            ),
            detail=None if review_done else f"{counts['required_accepted']}/{counts['required_total']}",
        ),
        ChecklistStep(
            key="terms_reconfirmed",
            label=INFORMATION_CONFIRMATION_LABEL,
            status=STEP_DONE if terms_done else STEP_PENDING,
        ),
        ChecklistStep(
            key="ready_for_next_step",
            label=_final_step_label(transaction.transaction_type),
            status=STEP_DONE if fully_ready else STEP_PENDING,
        ),
    ]
    return steps


def compute_progress_percentage(transaction: PropertyTransaction, documents: list[TransactionDocument]) -> int:
    counts = _document_counts(documents)
    present, total = _customer_info_field_counts(transaction)

    score = float(_WEIGHT_OFFER_AGREED)  # transaction existing implies the offer was accepted
    score += _WEIGHT_CUSTOMER_INFO * (present / total if total else 1.0)

    required_total = counts["required_total"]
    documents_fraction = (counts["required_submitted"] / required_total) if required_total else 1.0
    review_fraction = (counts["required_accepted"] / required_total) if required_total else 1.0
    score += _WEIGHT_DOCUMENTS_SUBMITTED * documents_fraction
    score += _WEIGHT_MEDIATOR_REVIEW * review_fraction

    terms_done = _terms_reconfirmed_done(transaction)
    score += _WEIGHT_TERMS_RECONFIRMED if terms_done else 0.0

    fully_ready = (
        present == total
        and _documents_submitted_done(counts)
        and _mediator_review_done(counts)
        and terms_done
    )
    score += _WEIGHT_READY_BONUS if fully_ready else 0.0

    return max(0, min(100, round(score)))


def compute_next_best_action(transaction: PropertyTransaction, documents: list[TransactionDocument]) -> NextBestAction:
    """Deterministic priority pick, evaluated in this exact order (documented
    in the tracking doc's "Progress methodology" section):

    1. Complete your profile information (customer_info step incomplete)
    2. Upload missing document (a required document is not_uploaded)
    3. Review mediator's update request (a required document needs_update)
    4. Await mediator's document review (required docs submitted, none
       flagged, but not all accepted yet)
    5. Confirm your information (Information Confirmation step not done)
    6. Ready — no further customer action

    Ties (e.g. two missing/needs_update required documents) always resolve
    to the lowest `id` (insertion/template order), matching
    `PropertyTransaction.documents`'s own `order_by`.
    """
    if not _customer_info_done(transaction):
        return NextBestAction(key="complete_profile_information", message="Complete your profile information")

    required = _required_documents(documents)

    missing = next((d for d in required if d.status == "not_uploaded"), None)
    if missing is not None:
        return NextBestAction(key="upload_missing_document", message=f"Upload {missing.label}")

    needs_update = next((d for d in required if d.status == "needs_update"), None)
    if needs_update is not None:
        return NextBestAction(
            key="review_update_request",
            message=f"Review mediator's update request for {needs_update.label}",
        )

    counts = _document_counts(documents)
    if not _mediator_review_done(counts):
        return NextBestAction(key="await_mediator_review", message="Awaiting mediator's document review")

    if not _terms_reconfirmed_done(transaction):
        return NextBestAction(key="confirm_information", message="Confirm your information")

    return NextBestAction(
        key="ready",
        message=f"Your transaction is {_final_step_label(transaction.transaction_type)}",
    )


def compute_readiness_label(transaction: PropertyTransaction, documents: list[TransactionDocument]) -> str:
    counts = _document_counts(documents)
    customer_info_done = _customer_info_done(transaction)
    documents_done = _documents_submitted_done(counts)
    review_done = _mediator_review_done(counts)
    terms_done = _terms_reconfirmed_done(transaction)

    if customer_info_done and documents_done and review_done and terms_done:
        return _final_step_label(transaction.transaction_type)
    if documents_done and review_done:
        return READINESS_ALMOST_READY
    return READINESS_NOT_READY


def compute_transaction_progress(transaction: PropertyTransaction) -> TransactionProgress:
    """Top-level orchestrator — the only entry point Prompt 4/5/7's API
    layer should ever need. Reads `transaction.documents` (already sorted by
    the model's own `order_by`)."""
    documents = list(transaction.documents)
    return TransactionProgress(
        checklist=compute_checklist(transaction, documents),
        progress_percentage=compute_progress_percentage(transaction, documents),
        next_best_action=compute_next_best_action(transaction, documents),
        readiness_label=compute_readiness_label(transaction, documents),
    )
