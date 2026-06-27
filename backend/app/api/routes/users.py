from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.user import User
from app.schemas.user import AdminUserCreate, UserOut, UserUpdate
import uuid

router = APIRouter()
_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def _role(user: User, partner_user_ids: set[int]) -> str:
    if user.is_admin or user.email in settings.ADMIN_EMAILS:
        return "admin"
    if user.id in partner_user_ids:
        return "partner"
    return "customer"


def _to_out(user: User, partner_user_ids: set[int]) -> UserOut:
    out = UserOut.model_validate(user)
    out.role = _role(user, partner_user_ids)
    return out


@router.get("/", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    users = db.scalars(select(User).order_by(User.id.desc())).all()
    partner_ids = set(db.scalars(select(Mediator.user_id)).all())
    return [_to_out(u, partner_ids) for u in users]


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    partner_ids = set(db.scalars(select(Mediator.user_id)).all())
    return _to_out(user, partner_ids)


@router.post("/", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    email = payload.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    role = (payload.role or "customer").strip().lower()
    user = User(
        email=email,
        full_name=payload.full_name,
        phone=payload.phone,
        hashed_password=_pwd.hash(payload.password),
        is_active=True,
        is_admin=(role == "admin"),
    )
    db.add(user)
    db.flush()  # get user.id before creating mediator

    if role == "partner":
        mediator = Mediator(
            user_id=user.id,
            license_number=f"LIC-{uuid.uuid4().hex[:8].upper()}",
            phone=payload.phone or "",
            subscription_status="active",
            is_verified=False,
        )
        db.add(mediator)

    db.commit()
    db.refresh(user)
    partner_ids = set(db.scalars(select(Mediator.user_id)).all())
    return _to_out(user, partner_ids)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    data = payload.model_dump(exclude_unset=True)

    if "password" in data:
        user.hashed_password = _pwd.hash(data.pop("password"))

    new_role = data.pop("role", None)
    if new_role:
        new_role = new_role.strip().lower()
        existing_mediator = db.scalar(select(Mediator).where(Mediator.user_id == user.id))

        if new_role == "admin":
            user.is_admin = True
            # Promote: keep mediator record if they had one (doesn't hurt)
        elif new_role == "partner":
            user.is_admin = False
            if not existing_mediator:
                db.add(Mediator(
                    user_id=user.id,
                    license_number=f"LIC-{uuid.uuid4().hex[:8].upper()}",
                    phone=user.phone or "",
                    subscription_status="active",
                    is_verified=False,
                ))
        elif new_role == "customer":
            user.is_admin = False
            if existing_mediator:
                db.delete(existing_mediator)

    for field, value in data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    partner_ids = set(db.scalars(select(Mediator.user_id)).all())
    return _to_out(user, partner_ids)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    db.delete(user)
    db.commit()
