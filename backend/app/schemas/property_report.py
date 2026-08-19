from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.property_report import PROPERTY_REPORT_REASONS


class PropertyReportCreate(BaseModel):
    reason: str
    comment: str | None = None

    @field_validator("reason")
    @classmethod
    def _valid_reason(cls, v: str) -> str:
        if v not in PROPERTY_REPORT_REASONS:
            raise ValueError(f"reason must be one of {PROPERTY_REPORT_REASONS}")
        return v


class PropertyReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    property_id: int
    reporter_user_id: int | None
    reason: str
    comment: str | None
    status: str
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: int | None
    resolution_notes: str | None
