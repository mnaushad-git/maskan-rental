from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.device import DEVICE_PLATFORMS


class DeviceRegister(BaseModel):
    platform: str
    push_token: str
    installation_id: str | None = None
    device_id: str | None = None
    app_version: str | None = None
    os_version: str | None = None
    locale: str = "en"
    device_timezone: str | None = None

    @field_validator("platform")
    @classmethod
    def _valid_platform(cls, v: str) -> str:
        if v not in DEVICE_PLATFORMS:
            raise ValueError(f"platform must be one of {DEVICE_PLATFORMS}")
        return v

    @field_validator("push_token")
    @classmethod
    def _non_empty_token(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("push_token must not be empty")
        return v.strip()


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    platform: str
    installation_id: str | None
    device_id: str | None
    app_version: str | None
    os_version: str | None
    locale: str
    device_timezone: str | None
    enabled: bool
    failure_count: int
    invalidated_at: datetime | None
    last_active_at: datetime
    last_success_push_at: datetime | None
    last_failed_push_at: datetime | None
    created_at: datetime


class DeviceAdminOut(DeviceOut):
    """Admin-facing device view (Phase 9D). Still never includes the raw
    push token — admin ops needs health signals, not the credential."""

    user_id: int
    user_email: str | None = None
