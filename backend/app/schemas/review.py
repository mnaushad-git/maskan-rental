from datetime import datetime
from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    mediator_id: int
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = None


class ReviewOut(BaseModel):
    id: int
    mediator_id: int
    user_id: int | None
    rating: int
    comment: str | None
    reviewer_name: str | None
    status: str
    created_at: datetime
    reviewer_is_verified: bool = False

    model_config = {"from_attributes": True}


class ReviewAdminOut(ReviewOut):
    """Extended output for admin moderation panel — includes partner name."""
    mediator_agency_name: str | None = None

    model_config = {"from_attributes": True}


class ReviewSummary(BaseModel):
    avg_rating: float | None
    review_count: int
    distribution: dict[int, int]  # {1: n, 2: n, 3: n, 4: n, 5: n}
