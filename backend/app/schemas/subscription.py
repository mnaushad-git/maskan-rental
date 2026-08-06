from datetime import datetime
from pydantic import BaseModel


class SubscriptionOut(BaseModel):
    subscription_status: str
    subscription_tier: str
    subscription_started_at: datetime | None
    subscription_expires_at: datetime | None

    model_config = {"from_attributes": True}
