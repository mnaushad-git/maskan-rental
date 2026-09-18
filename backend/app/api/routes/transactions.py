"""Rental/Buy Transaction Workspace — customer-facing routes (Prompt 4). See
docs/implementation/mymakan-transaction-workspace.md.

Gated behind FEATURE_NEGOTIATIONS (not a dedicated new flag) — a
`PropertyTransaction` can only ever exist off an accepted `PropertyNegotiation`
(see property_transaction.create_transaction_for_negotiation(), called
inline from property_negotiation.accept_offer()), so when negotiations are
off there is no way for a transaction to exist in the first place. Mirrors
negotiations.py's `_require_enabled()` pattern exactly.

Every mutating action below re-derives the transaction from `{id}` +
`current_user` via `get_owned_transaction()` — never trusts a user id from
the request body — and returns the freshly recomputed
`PropertyTransactionDetailOut` (checklist/progress/next-best-action/
readiness always come from Prompt 3's deterministic engine via
`sync_progress_and_status()` / `to_transaction_detail_out()`, never
recomputed ad hoc here).
"""
import mimetypes

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.feature_flags import is_enabled
from app.core.rate_limit import rate_limit_dependency
from app.models.user import User
from app.schemas.property_transaction import (
    CustomerInformationUpdate,
    PropertyTransactionDetailOut,
    PropertyTransactionOut,
    TransactionAssistantOut,
    TransactionAssistantRequest,
    TransactionCancelRequest,
)
from app.services import property_transaction as transaction_service
from app.services import transaction_ai
from app.services.property_transaction import TransactionDomainError
from app.services.transaction_ai import InvalidQuickAction

router = APIRouter()


def _require_enabled() -> None:
    if not is_enabled("negotiations"):
        raise HTTPException(status_code=503, detail="Transaction Workspace is not currently available")


def _get_owned_transaction(db: Session, transaction_id: int, current_user: User):
    try:
        return transaction_service.get_owned_transaction(db, transaction_id, current_user)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=list[PropertyTransactionOut], dependencies=[Depends(_require_enabled)])
def list_my_transactions(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """`status` accepts "active" (everything not completed/cancelled),
    "completed", or "cancelled"; omitted/unrecognized returns everything."""
    rows = transaction_service.list_transactions_for_customer(db, current_user, status_filter=status)
    return [PropertyTransactionOut.model_validate(transaction_service.to_transaction_out(t)) for t in rows]


@router.get("/{transaction_id}", response_model=PropertyTransactionDetailOut, dependencies=[Depends(_require_enabled)])
def get_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    return PropertyTransactionDetailOut.model_validate(transaction_service.to_transaction_detail_out(transaction))


@router.patch(
    "/{transaction_id}/customer-information",
    response_model=PropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def update_customer_information(
    transaction_id: int,
    body: CustomerInformationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    transaction_service.update_customer_information(db, transaction, full_name=body.full_name, phone=body.phone)
    db.commit()
    db.refresh(transaction)
    return PropertyTransactionDetailOut.model_validate(transaction_service.to_transaction_detail_out(transaction))


@router.post(
    "/{transaction_id}/documents",
    response_model=PropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def upload_document(
    transaction_id: int,
    document_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    try:
        transaction_service.upload_document(db, transaction, document_id, file)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PropertyTransactionDetailOut.model_validate(transaction_service.to_transaction_detail_out(transaction))


@router.delete(
    "/{transaction_id}/documents/{document_id}",
    response_model=PropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def delete_document(
    transaction_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    try:
        transaction_service.delete_document(db, transaction, document_id)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PropertyTransactionDetailOut.model_validate(transaction_service.to_transaction_detail_out(transaction))


@router.get(
    "/{transaction_id}/documents/{document_id}/download",
    dependencies=[Depends(_require_enabled)],
)
def download_document(
    transaction_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Authenticated, ownership-checked file retrieval — the only way to
    read a document's bytes back. There is no public/static route serving
    `property_transaction.UPLOAD_ROOT` anywhere in this app (see that
    constant's docstring), so this endpoint is the sole access path."""
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    try:
        path = transaction_service.document_file_path(transaction, document_id)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type)


@router.post(
    "/{transaction_id}/confirm-information",
    response_model=PropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def confirm_information(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sets the customer confirmation timestamp — NOT a signature (wording
    rule: labeled "Information Confirmation", never "Sign Contract")."""
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    try:
        transaction_service.confirm_information(db, transaction)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PropertyTransactionDetailOut.model_validate(transaction_service.to_transaction_detail_out(transaction))


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
    current_user: User = Depends(get_current_user),
):
    """Grounded strictly in this transaction's own deterministic
    checklist/progress/documents/property/terms/trust data (never raw DB
    rows, never invents a fact, never changes transaction state, never gives
    a legal interpretation — see app/services/transaction_ai.py). Read-only:
    no `db.commit()` here since nothing is ever mutated."""
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    try:
        result = transaction_ai.generate_response(
            transaction,
            actor_role="customer",
            quick_action=body.quick_action,
            language=body.language,
            user_id=current_user.id,
        )
    except InvalidQuickAction as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return TransactionAssistantOut(quick_action=body.quick_action, reply=result.reply, generated_by=result.generated_by)


@router.post(
    "/{transaction_id}/cancel",
    response_model=PropertyTransactionDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def cancel_transaction(
    transaction_id: int,
    body: TransactionCancelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    transaction = _get_owned_transaction(db, transaction_id, current_user)
    try:
        transaction_service.cancel_transaction(db, transaction, reason=body.reason, cancelled_by="customer")
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(transaction)
    return PropertyTransactionDetailOut.model_validate(transaction_service.to_transaction_detail_out(transaction))
