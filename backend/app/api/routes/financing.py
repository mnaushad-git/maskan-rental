from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user, get_db
from app.api.routes.ai import generate_affordability_note
from app.core.rate_limit import rate_limit_dependency
from app.models.financing_interest import FinancingInterest
from app.models.property import Property
from app.models.user import User
from app.schemas.financing import FinancingInterestCreate, FinancingInterestOut

router = APIRouter()


@router.post(
    "/",
    response_model=FinancingInterestOut,
    status_code=201,
    dependencies=[Depends(rate_limit_dependency("financing_interest", limit=10, window_seconds=600, by_user=True))],
)
def submit_financing_interest(
    body: FinancingInterestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    prop = db.get(Property, body.property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found.")
    if not prop.monthly_rent:
        raise HTTPException(status_code=400, detail="This property has no monthly rent to assess affordability against.")

    note, generated_by = generate_affordability_note(
        stated_budget=body.stated_budget,
        monthly_rent=prop.monthly_rent,
        user_id=current_user.id,
    )

    interest = FinancingInterest(
        renter_user_id=current_user.id,
        property_id=body.property_id,
        stated_budget=body.stated_budget,
        ai_note=note,
        ai_generated_by=generated_by,
    )
    db.add(interest)
    db.commit()
    db.refresh(interest)
    return interest


@router.get("/my", response_model=list[FinancingInterestOut])
def my_financing_interests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(FinancingInterest)
        .filter(FinancingInterest.renter_user_id == current_user.id)
        .order_by(FinancingInterest.created_at.desc())
        .all()
    )


@router.get("/admin/all", response_model=list[FinancingInterestOut])
def admin_list_financing_interests(
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    return db.query(FinancingInterest).order_by(FinancingInterest.created_at.desc()).all()
