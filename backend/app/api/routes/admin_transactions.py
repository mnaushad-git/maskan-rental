"""Rental/Buy Transaction Workspace — Admin read-only visibility (Prompt 7).
See docs/implementation/mymakan-transaction-workspace.md.

Deliberately minimal per the brief: two read-only endpoints, no admin
mutation/moderation actions of any kind (no hide/cancel/override — a
transaction's status/checklist is 100% deterministic, driven only by the
customer/mediator actions Prompts 4/5 already built; there is nothing for an
admin to directly edit here). Mirrors `property_request_admin.py`'s /
`admin_trust.py`'s conventions: `get_admin_user` on every route, plain
query-param filters + an `X-Total-Count` response header for the list
endpoint (not a paginated envelope object), and reuse of Prompt 2/3/4's
existing `to_*_out()` assembly helpers directly rather than re-deriving the
transaction's computed fields a second way.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.feature_flags import is_enabled
from app.models.property_transaction import PROPERTY_TRANSACTION_STATUSES
from app.models.user import User
from app.schemas.property_transaction import AdminTransactionDetailOut, AdminTransactionListItemOut
from app.services import property_transaction as transaction_service
from app.services.property_transaction import TransactionDomainError

router = APIRouter()

_SORT_COLUMNS = ("created_at", "updated_at", "progress_percentage")


def _require_enabled() -> None:
    """Same gate as transactions.py/partner_transactions.py — not a
    dedicated new flag, since a PropertyTransaction can only ever exist off
    an accepted PropertyNegotiation."""
    if not is_enabled("negotiations"):
        raise HTTPException(status_code=503, detail="Transaction Workspace is not currently available")


@router.get("", response_model=list[AdminTransactionListItemOut], dependencies=[Depends(_require_enabled)])
def list_transactions(
    response: Response,
    status_filter: str | None = Query(default=None, alias="status"),
    transaction_type: str | None = Query(default=None, pattern="^(rent|sale)$"),
    mediator_id: int | None = Query(default=None),
    customer_user_id: int | None = Query(default=None),
    sort: str = Query(default="updated_at"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Filterable by status/transaction_type/mediator_id/customer_user_id;
    sortable by created_at/updated_at/progress_percentage (defaults to
    updated_at desc, i.e. "last activity" first). `X-Total-Count` mirrors
    property_request_admin.list_requests's own convention (post-filter,
    pre-pagination count)."""
    if status_filter is not None and status_filter not in PROPERTY_TRANSACTION_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {PROPERTY_TRANSACTION_STATUSES}")
    sort_column = sort if sort in _SORT_COLUMNS else "updated_at"

    rows = transaction_service.list_transactions_for_admin(
        db,
        status_filter=status_filter,
        transaction_type=transaction_type,
        mediator_id=mediator_id,
        customer_user_id=customer_user_id,
        sort=sort_column,
        order=order,
    )
    response.headers["X-Total-Count"] = str(len(rows))
    page = rows[skip : skip + limit]
    return [AdminTransactionListItemOut.model_validate(transaction_service.to_admin_transaction_out(t)) for t in page]


@router.get("/{transaction_id}", response_model=AdminTransactionDetailOut, dependencies=[Depends(_require_enabled)])
def get_transaction(
    transaction_id: int,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Checklist, document statuses, timeline, participants, and negotiation
    reference (via terms_snapshot.negotiation_reference) — no ownership
    check, unlike the customer/partner routes, since any admin may look up
    any transaction by id."""
    try:
        transaction = transaction_service.get_transaction_for_admin(db, transaction_id)
    except TransactionDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return AdminTransactionDetailOut.model_validate(transaction_service.to_admin_transaction_detail_out(db, transaction))
