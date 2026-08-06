from datetime import datetime, timedelta, timezone

import re

from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.config import settings
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
            is_admin=user.email in settings.admin_emails,
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
            is_admin=user.email in settings.admin_emails,
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
        is_admin=current_user.email in settings.admin_emails,
        verification_status=current_user.verification_status,
        is_verified=current_user.is_verified,
    )


@router.post("/logout")
def logout():
    return {"message": "logged out"}
