from datetime import date, datetime
from pydantic import BaseModel, EmailStr


class LeadCreate(BaseModel):
    area_name: str
    city: str
    customer_name: str
    customer_phone: str
    customer_email: str
    min_budget: float | None = None
    max_budget: float | None = None
    bedrooms_needed: int | None = None
    move_in_date: date | None = None
    requirements_note: str | None = None
    source: str = "web_form"


class LeadSuggestionOut(BaseModel):
    id: int
    lead_id: int
    property_id: int | None
    match_score: float
    reason: str | None
    created_at: datetime
    property_title: str | None = None
    monthly_rent: float | None = None
    bedrooms: int | None = None

    model_config = {"from_attributes": True}


class LeadAssignmentOut(BaseModel):
    id: int
    lead_id: int
    mediator_id: int | None
    status: str
    assigned_at: datetime
    accepted_at: datetime | None
    rejected_at: datetime | None
    expires_at: datetime
    mediator_agency_name: str | None = None
    mediator_phone: str | None = None

    model_config = {"from_attributes": True}


class LeadSummaryOut(BaseModel):
    id: int
    area_name: str
    city: str
    status: str
    customer_name: str
    customer_phone: str
    customer_email: str
    max_budget: float | None
    bedrooms_needed: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LeadDetailOut(BaseModel):
    id: int
    customer_user_id: int
    customer_name: str
    customer_phone: str
    customer_email: str
    area_name: str
    city: str
    min_budget: float | None
    max_budget: float | None
    bedrooms_needed: int | None
    move_in_date: date | None
    requirements_note: str | None
    status: str
    source: str
    created_at: datetime
    closed_at: datetime | None
    closure_outcome: str | None = None
    closure_note: str | None = None
    closure_requested_at: datetime | None = None
    suggestions: list[LeadSuggestionOut] = []
    assignments: list[LeadAssignmentOut] = []

    model_config = {"from_attributes": True}


class LeadAvailableOut(BaseModel):
    """Masked lead visible to all active partners in the marketplace."""
    id: int
    area_name: str
    city: str
    min_budget: float | None
    max_budget: float | None
    bedrooms_needed: int | None
    move_in_date: date | None
    requirements_note: str | None
    status: str
    created_at: datetime
    suggestions: list[LeadSuggestionOut] = []

    model_config = {"from_attributes": True}


class LeadStatusUpdate(BaseModel):
    status: str  # "closed_won" | "closed_lost" — partner's requested closure outcome
    note: str | None = None


class LeadMessageCreate(BaseModel):
    content: str


class LeadMessageOut(BaseModel):
    id: int
    lead_id: int
    sender_user_id: int | None
    sender_role: str
    content: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}
