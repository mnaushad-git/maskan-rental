from datetime import datetime

from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict, EmailStr

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str | None = None
    hashed_password: str


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None
    phone: str | None = None
    role: str = "customer"  # "customer" | "partner" | "admin"


class UserUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    is_active: bool | None = None
    password: str | None = None
    role: str | None = None  # "customer" | "partner" | "admin"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # Plain str (not EmailStr): output serialization must never reject data
    # already in the DB. Some seeded accounts use reserved TLDs like ".test"
    # which EmailStr rejects, which would 500 the whole list.
    email: str
    full_name: str | None = None
    phone: str | None = None
    is_active: bool
    is_admin: bool = False
    created_at: datetime
    role: str = "customer"  # "admin" | "partner" | "customer"
