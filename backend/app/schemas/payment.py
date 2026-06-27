from datetime import datetime
from pydantic import BaseModel


class PaymentOut(BaseModel):
    id: int
    user_id: int | None
    mediator_id: int | None
    payment_type: str
    amount: float
    currency: str
    status: str
    gateway: str
    gateway_payment_id: str | None
    description: str | None
    paid_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PaymentCreate(BaseModel):
    mediator_id: int
    payment_type: str
    amount: float
    description: str | None = None
