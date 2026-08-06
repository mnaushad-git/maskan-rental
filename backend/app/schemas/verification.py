from datetime import datetime
from pydantic import BaseModel, Field


class VerificationSubmit(BaseModel):
    # Mock capture only — no real Nafath call. A document/ID reference is
    # enough to drive the admin approval flow.
    document_reference: str = Field(..., min_length=3, max_length=255)


class VerificationOut(BaseModel):
    verification_status: str
    is_verified: bool
    verification_document_ref: str | None
    verification_submitted_at: datetime | None
    verification_reviewed_at: datetime | None

    model_config = {"from_attributes": True}


class VerificationAdminOut(VerificationOut):
    id: int
    email: str
    full_name: str | None

    model_config = {"from_attributes": True}
