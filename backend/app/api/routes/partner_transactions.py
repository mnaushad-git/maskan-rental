"""Rental/Buy Transaction Workspace — partner-facing routes (Prompt 5). See
docs/implementation/mymakan-transaction-workspace.md. Mirrors
partner_negotiations.py's auth/route conventions exactly: standalone router,
`/partner/transactions` prefix, every endpoint gated on
`Depends(get_mediator_user)` + `transaction.mediator_id != mediator.id ->
403 "Not your transaction"` via `get_owned_transaction_for_mediator()`,
gated behind FEATURE_NEGOTIATIONS the same way transactions.py (customer
side) is (a `PropertyTransaction` can only ever exist off an accepted
`PropertyNegotiation`).

Every route returns the freshly recomputed
`PartnerPropertyTransaction(Detail)Out` (checklist/progress/next-best-action/
readiness always come from Prompt 3's deterministic engine via
`sync_progress_and_status()` / `to_partner_transaction_(detail_)out()`, never
recomputed ad hoc here) — mirrors transactions.py's own convention. Document
review actions (`accept`/`request-update`) only ever touch a
`TransactionDocument`'s review status/note; the mediator can never alter the
uploaded file itself. `agreed_amount` is never accepted in any request body
on this router, so it stays immutable through every partner action too.
"""
import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_mediator_user
from app.core.feature_flags import is_enabled
from app.core.rate_limit import rate_limit_dependency
from app.models.mediator import Mediator
from app.models.user import User
from app.schemas.property_transaction import (
    PartnerPropertyTransactionDetailOut,
    PartnerPropertyTransactionOut,
    TransactionAssistantOut,
    TransactionAssistantRequest,
    TransactionDocumentReviewRequest,
)
from app.services import property_transaction as transaction_service
from app.services import transaction_ai
from app.services.property_transaction import TransactionDomainError
from app.services.transaction_ai import InvalidQuickAction

router = APIRouter()


def _require_enabled() -> None:
    if not is_enabled("negotiations"):
        raise HTTPException(status_code=503, detail="Transaction Workspace is not currently available")


def _get_owned_transaction(db: Session, transaction_id: int, mediator: Mediator):
    try:
        return transaction_service.get_owned_transaction_for_mediator(db, transaction_id, mediator)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=list[PartnerPropertyTransactionOut], dependencies=[Depends(_require_enabled)])
def list_partner_transactions(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """`status_filter` accepts "action_required" / "active" / "ready" /
    "completed" / "cancelled" — see
    property_transaction.list_transactions_for_mediator()'s docstring for the
    exact bucket rules. Omitted/unrecognized returns everything."""
    _user, mediator = mediator_user
    rows = transaction_service.list_transactions_for_mediator(db, mediator, status_filter=status_filter)
    return [PartnerPropertyTransactionOut.model_validate(transaction_service.to_partner_transaction_out(t)) for t in rows]


@router.get(
    "/{transaction_id}",
    response_model=PartnerPropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def get_partner_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    _user, mediator = mediator_user
    transaction = _get_owned_transaction(db, transaction_id, mediator)
    return PartnerPropertyTransactionDetailOut.model_validate(
        transaction_service.to_partner_transaction_detail_out(transaction)
    )


@router.get(
    "/{transaction_id}/documents/{document_id}/download",
    dependencies=[Depends(_require_enabled)],
)
def download_document(
    transaction_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Mediator-side counterpart of transactions.py's own `.../download`
    route (Prompt 4) — added in Prompt 10, since a mediator genuinely can't
    review a document (accept/request-update) without being able to read its
    bytes back, and Prompt 5's own router never added this despite building
    accept/request-update. Same ownership-checked, no-public-URL contract:
    `property_transaction.document_file_path()` is the one shared helper
    both routers call, never duplicated."""
    _user, mediator = mediator_user
    transaction = _get_owned_transaction(db, transaction_id, mediator)
    try:
        path = transaction_service.document_file_path(transaction, document_id)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)


@router.post(
    "/{transaction_id}/documents/{document_id}/accept",
    response_model=PartnerPropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def accept_document(
    transaction_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Only valid while the document is `uploaded` (409 otherwise). Never
    touches the uploaded file itself — only the review status/note."""
    _user, mediator = mediator_user
    transaction = _get_owned_transaction(db, transaction_id, mediator)
    try:
        transaction_service.accept_document(db, transaction, document_id)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PartnerPropertyTransactionDetailOut.model_validate(
        transaction_service.to_partner_transaction_detail_out(transaction)
    )


@router.post(
    "/{transaction_id}/documents/{document_id}/request-update",
    response_model=PartnerPropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def request_document_update(
    transaction_id: int,
    document_id: int,
    body: TransactionDocumentReviewRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Requires a non-empty `reason` (422 otherwise). Only valid while the
    document is `uploaded` (409 otherwise). Never touches the uploaded file
    itself — only the review status/note."""
    _user, mediator = mediator_user
    transaction = _get_owned_transaction(db, transaction_id, mediator)
    try:
        transaction_service.request_document_update(db, transaction, document_id, reason=body.reason)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PartnerPropertyTransactionDetailOut.model_validate(
        transaction_service.to_partner_transaction_detail_out(transaction)
    )


@router.post(
    "/{transaction_id}/ai-assistant",
    response_model=TransactionAssistantOut,
    dependencies=[
        Depends(_require_enabled),
        Depends(rate_limit_dependency("transaction_ai_assistant", limit=20, window_seconds=600, by_user=True)),
    ],
)
def ai_assistant(
    transaction_id: int,
    body: TransactionAssistantRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Mediator-side counterpart of transactions.py's own `ai-assistant`
    route — the brief's quick-action vocabulary has a distinct mediator set
    (summarize outstanding / what's blocking / draft update request /
    summarize customer progress), so mediators need their own
    ownership-checked entry point into the same
    `app.services.transaction_ai.generate_response()`. Grounded strictly in
    this transaction's own deterministic data, with the same restricted
    (no email/phone) customer view every other partner-side response uses.
    Read-only: no `db.commit()` here since nothing is ever mutated."""
    _user, mediator = mediator_user
    transaction = _get_owned_transaction(db, transaction_id, mediator)
    try:
        result = transaction_ai.generate_response(
            transaction,
            actor_role="mediator",
            quick_action=body.quick_action,
            language=body.language,
            user_id=_user.id,
        )
    except InvalidQuickAction as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return TransactionAssistantOut(quick_action=body.quick_action, reply=result.reply, generated_by=result.generated_by)


@router.post(
    "/{transaction_id}/confirm-information",
    response_model=PartnerPropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def confirm_information(
    transaction_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Mediator-side "property and commercial information confirmed"
    timestamp — a separate column/actor from the customer's own
    confirm-information action."""
    _user, mediator = mediator_user
    transaction = _get_owned_transaction(db, transaction_id, mediator)
    try:
        transaction_service.confirm_information_mediator(db, transaction)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PartnerPropertyTransactionDetailOut.model_validate(
        transaction_service.to_partner_transaction_detail_out(transaction)
    )
