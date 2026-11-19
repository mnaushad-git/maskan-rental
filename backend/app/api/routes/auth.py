from datetime import datetime, timedelta, timezone

import re

from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.core.roles import is_admin_user
from app.core.rate_limit import rate_limit_dependency
from app.models.user import User
from passlib.context import CryptContext

router = APIRouter()
# Use a pure-passlib algorithm to avoid bcrypt backend compatibility issues.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address.")
    return v


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        return _validate_email(v)


class SignupRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        return _validate_email(v)


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None = None
    is_admin: bool = False
    verification_status: str = "unverified"  # "unverified" | "pending" | "approved" | "rejected"
    is_verified: bool = False
    subscription_status: str = "inactive"  # "inactive" | "pending_payment" | "active" | "cancelled" | "expired"
    subscription_tier: str = "free"  # "free" | "premium"

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


@router.post(
    "/signup",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_dependency("signup", limit=5, window_seconds=3600))],
)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    existing_user = db.scalar(select(User).where(User.email == body.email))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    user = User(
        email=body.email,
        full_name=body.full_name,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return AuthResponse(
        access_token=create_access_token(user.id),
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_admin=is_admin_user(user),
            verification_status=user.verification_status,
            is_verified=user.is_verified,
        ),
    )


@router.post(
    "/login",
    response_model=AuthResponse,
    dependencies=[Depends(rate_limit_dependency("login", limit=10, window_seconds=300))],
)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate a user and return a token."""
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled. Contact support.")

    return AuthResponse(
        access_token=create_access_token(user.id),
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_admin=is_admin_user(user),
            verification_status=user.verification_status,
            is_verified=user.is_verified,
        ),
    )


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        is_admin=is_admin_user(current_user),
        verification_status=current_user.verification_status,
        is_verified=current_user.is_verified,
    )


@router.post("/logout")
def logout():
    return {"message": "logged out"}


# ── Self-service account deletion (Google Play policy) ─────────────────────
# Logic lives in app/services/account_deletion.py; these routes only handle
# re-authentication, confirmation and HTTP mapping. A wrong password returns
# 403, never 401: clients treat any 401 as "session expired" and sign out.

ACCOUNT_DELETION_CONFIRMATION = "DELETE"

_BLOCKER_MESSAGES = {
    "partner_account": "Partner accounts can't be deleted from the app. Please contact Maskan support.",
    "active_transactions": "You have a property transaction in progress. Complete or cancel it first.",
    "active_negotiations": "You have an open offer or negotiation. Withdraw it or wait for it to close first.",
    "upcoming_viewings": "You have a viewing that is requested or scheduled. Cancel it first.",
    "upcoming_bookings": "You have an upcoming booking. Cancel it or wait until it ends.",
    "open_contracts": "You have a contract that is in draft, awaiting signature or active.",
    "open_leads": "You have an open enquiry with a partner. Wait for it to be closed first.",
    "active_property_requests": "You have an active property request. Cancel it first.",
    "pending_payments": "You have a payment that is still processing. Try again once it completes.",
}


class DeletionBlockerOut(BaseModel):
    code: str
    count: int
    message: str


class DeletionEligibilityResponse(BaseModel):
    eligible: bool
    blockers: list[DeletionBlockerOut]


class DeleteAccountRequest(BaseModel):
    password: str
    confirmation: str


def _blockers_out(blockers) -> list[DeletionBlockerOut]:
    return [DeletionBlockerOut(code=b.code, count=b.count, message=_BLOCKER_MESSAGES.get(b.code, b.code)) for b in blockers]


@router.get("/me/deletion-eligibility", response_model=DeletionEligibilityResponse)
def account_deletion_eligibility(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.services.account_deletion import find_blockers

    if is_admin_user(current_user):
        return DeletionEligibilityResponse(eligible=False, blockers=[DeletionBlockerOut(
            code="admin_account", count=1, message="Admin accounts can't be deleted from the app.")])
    blockers = _blockers_out(find_blockers(db, current_user))
    return DeletionEligibilityResponse(eligible=not blockers, blockers=blockers)


@router.post(
    "/me/delete",
    dependencies=[Depends(rate_limit_dependency("account_delete", limit=5, window_seconds=3600, by_user=True))],
)
def delete_my_account(
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.account_deletion import delete_account, find_blockers

    if body.confirmation.strip().upper() != ACCOUNT_DELETION_CONFIRMATION:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f'Type {ACCOUNT_DELETION_CONFIRMATION} to confirm account deletion.')
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect.")
    if is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin accounts can't be deleted from the app.")
    blockers = find_blockers(db, current_user)
    if blockers:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=" ".join(b.message for b in _blockers_out(blockers)))
    try:
        delete_account(db, current_user)
    except ValueError:  # blocker appeared between the check and the delete
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Your account changed while deleting. Please try again.")
    return {"status": "deleted", "message": "Your account has been deleted and you have been signed out."}
