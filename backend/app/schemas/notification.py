from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.notification_preference import NOTIFICATION_CATEGORIES


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    body: str
    locale: str
    entity_type: str | None
    entity_id: int | None
    saved_search_id: int | None
    property_id: int | None
    match_reasons: list[dict] | None
    deep_link: str | None
    read_at: datetime | None
    seen_at: datetime | None
    delivery_status: dict
    ai_generated: bool
    created_at: datetime
    expires_at: datetime | None
    meta: dict


class NotificationListResponse(BaseModel):
    items: list[NotificationOut]
    next_cursor: str | None = None
    unread_count: int


class UnreadCountResponse(BaseModel):
    unread_count: int


class CategoryPreference(BaseModel):
    channels: list[str] = Field(default_factory=lambda: ["in_app", "push"])
    frequency: str = "instant"

    @field_validator("channels")
    @classmethod
    def _valid_channels(cls, v: list[str]) -> list[str]:
        allowed = {"in_app", "push", "email", "sms", "whatsapp"}
        bad = [c for c in v if c not in allowed]
        if bad:
            raise ValueError(f"unknown channel(s): {bad}")
        return v

    @field_validator("frequency")
    @classmethod
    def _valid_frequency(cls, v: str) -> str:
        if v not in ("instant", "daily", "weekly", "off"):
            raise ValueError("frequency must be one of instant, daily, weekly, off")
        return v


class NotificationPreferenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    in_app_enabled: bool
    push_enabled: bool
    email_enabled: bool
    category_preferences: dict[str, CategoryPreference]
    digest_hour: int
    weekly_digest_day: int
    timezone: str
    next_daily_digest_at: datetime | None
    next_weekly_digest_at: datetime | None
    quiet_hours_enabled: bool
    quiet_hours_start: str
    quiet_hours_end: str
    quiet_hours_allow_urgent: bool
    hide_message_preview: bool


class NotificationPreferenceUpdate(BaseModel):
    in_app_enabled: bool | None = None
    push_enabled: bool | None = None
    email_enabled: bool | None = None
    category_preferences: dict[str, CategoryPreference] | None = None
    digest_hour: int | None = Field(default=None, ge=0, le=23)
    weekly_digest_day: int | None = Field(default=None, ge=0, le=6)
    timezone: str | None = None
    quiet_hours_enabled: bool | None = None
    quiet_hours_start: str | None = None
    quiet_hours_end: str | None = None
    quiet_hours_allow_urgent: bool | None = None
    hide_message_preview: bool | None = None

    @field_validator("category_preferences")
    @classmethod
    def _known_categories(cls, v: dict[str, CategoryPreference] | None) -> dict[str, CategoryPreference] | None:
        if v is None:
            return v
        bad = [k for k in v if k not in NOTIFICATION_CATEGORIES]
        if bad:
            raise ValueError(f"unknown categor{'y' if len(bad) == 1 else 'ies'}: {bad}")
        if "security" in v and v["security"].frequency == "off":
            raise ValueError("the 'security' category cannot be turned off")
        return v

    @field_validator("quiet_hours_start", "quiet_hours_end")
    @classmethod
    def _valid_hhmm(cls, v: str | None) -> str | None:
        if v is None:
            return v
        import re

        if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", v):
            raise ValueError("must be HH:MM (24h)")
        return v


class NotificationDeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    notification_id: int
    device_id: int | None
    channel: str
    provider: str
    provider_message_id: str | None
    attempt_number: int
    status: str
    failure_code: str | None
    failure_message: str | None
    attempted_at: datetime
    accepted_at: datetime | None
    delivered_at: datetime | None
    opened_at: datetime | None
    created_at: datetime
    trace_id: str | None
