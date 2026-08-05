from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.models.contract import Contract
from app.models.lead import Lead, LeadAssignment
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User
from app.schemas.contract import ContractCreate, ContractOut

router = APIRouter()


def _sync_expiry(contract: Contract) -> None:
    """Lazily flip an active contract past its end date to 'expired' on read."""
    if contract.status == "active" and contract.end_date < datetime.now(timezone.utc).date():
        contract.status = "expired"


def _check_contract_access(contract: Contract, user: User, db: Session) -> str:
    """Returns the caller's role ('tenant' or 'landlord') or raises 403."""
    if contract.tenant_user_id == user.id:
        return "tenant"
    mediator = db.query(Mediator).filter(Mediator.user_id == user.id).first()
    if mediator and mediator.id == contract.landlord_mediator_id:
        return "landlord"
    if user.email in settings.admin_emails:
        return "tenant"  # admin can read as either side
    raise HTTPException(status_code=403, detail="Access denied.")


@router.post("/", response_model=ContractOut, status_code=201)
def create_contract(
    body: ContractCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = db.get(Lead, body.lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")

    assignment = (
        db.query(LeadAssignment)
        .filter(LeadAssignment.lead_id == lead.id, LeadAssignment.status == "accepted")
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=400, detail="This lead has no accepted mediator assignment yet.")

    is_tenant = lead.customer_user_id == current_user.id
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    is_landlord = mediator and mediator.id == assignment.mediator_id
    if not is_tenant and not is_landlord:
        raise HTTPException(status_code=403, detail="Only the tenant or the accepted mediator can create a contract for this lead.")

    existing = db.query(Contract).filter(Contract.lead_id == lead.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="A contract already exists for this lead.")

    if body.property_id is not None:
        prop = db.get(Property, body.property_id)
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found.")

    if body.end_date <= body.start_date:
        raise HTTPException(status_code=400, detail="end_date must be after start_date.")

    contract = Contract(
        lead_id=lead.id,
        tenant_user_id=lead.customer_user_id,
        landlord_mediator_id=assignment.mediator_id,
        property_id=body.property_id,
        rent_amount=body.rent_amount,
        deposit_amount=body.deposit_amount,
        start_date=body.start_date,
        end_date=body.end_date,
        status="draft",
    )
    db.add(contract)
    db.commit()
    db.refresh(contract)
    return contract


@router.get("/my", response_model=list[ContractOut])
def my_contracts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    q = db.query(Contract).filter(
        (Contract.tenant_user_id == current_user.id)
        | (Contract.landlord_mediator_id == mediator.id if mediator else False)
    )
    contracts = q.order_by(Contract.created_at.desc()).all()
    changed = False
    for contract in contracts:
        before = contract.status
        _sync_expiry(contract)
        changed = changed or contract.status != before
    if changed:
        db.commit()
    return contracts


@router.get("/{contract_id}", response_model=ContractOut)
def get_contract(
    contract_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found.")
    _check_contract_access(contract, current_user, db)
    before = contract.status
    _sync_expiry(contract)
    if contract.status != before:
        db.commit()
        db.refresh(contract)
    return contract


@router.post("/{contract_id}/sign", response_model=ContractOut)
def sign_contract(
    contract_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contract = db.get(Contract, contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found.")
    role = _check_contract_access(contract, current_user, db)
    if contract.status not in ("draft", "pending_signature"):
        raise HTTPException(status_code=409, detail=f"Contract cannot be signed in its current status ('{contract.status}').")

    if role == "tenant":
        if contract.tenant_signed_at is not None:
            raise HTTPException(status_code=400, detail="You have already signed this contract.")
        contract.tenant_signed_at = datetime.now(timezone.utc)
    else:
        if contract.landlord_signed_at is not None:
            raise HTTPException(status_code=400, detail="You have already signed this contract.")
        contract.landlord_signed_at = datetime.now(timezone.utc)

    contract.status = "active" if contract.tenant_signed_at and contract.landlord_signed_at else "pending_signature"
    db.commit()
    db.refresh(contract)
    return contract
