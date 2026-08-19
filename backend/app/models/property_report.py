"""Property Verification & Trust Center — "Report a Concern" (spec section
24). A renter/user-submitted flag on a listing (e.g. suspected duplicate,
stale/unavailable, incorrect info, suspected fraud), reviewed by an admin
later (Prompt 6's moderation queue). Never triggers an automatic
hide/unpublish/merge/delete — creating a report is purely informational
until a human actor (admin) resolves it.

Follows the codebase's existing convention (see `PROPERTY_REQUEST_STATUSES`
in `app.models.property_request`) of plain `String` columns backed by a
module-level tuple of allowed values rather than a DB-level enum type — new
reasons/statuses stay a Python-only change, no migration required.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Judgment call (no fuller feature spec present in this repo — see
# docs/implementation/mymakan-trust-center.md "Prompt 2" section): reasons
# a user can report a listing for. "duplicate_listing" is the one the
# lightweight duplicate-awareness service (`app.services.duplicate_detection`)
# is designed to eventually corroborate, but a report can be filed for any
# of these independently of that service's own confidence score.
PROPERTY_REPORT_REASONS = (
    "duplicate_listing",
    "incorrect_information",
    "no_longer_available",
    "fraudulent_or_scam",
    "inappropriate_content",
    "other",
)

# Open -> Under Review -> Resolved | Dismissed, per the prompt spec.
PROPERTY_REPORT_STATUSES = ("Open", "Under Review", "Resolved", "Dismissed")
# "Active" = still needs admin attention; used by the one-active-report
# duplicate-submission guard in POST /properties/{id}/reports.
PROPERTY_REPORT_ACTIVE_STATUSES = ("Open", "Under Review")


class PropertyReport(Base):
    __tablename__ = "property_reports"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    # SET NULL (not CASCADE) on user deletion — the report itself is a
    # moderation-relevant record that should outlive the reporter's account,
    # mirroring AuditLog.user_id's nullable/SET NULL pattern.
    reporter_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="Open", server_default="Open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    property = relationship("Property", back_populates="reports", foreign_keys=[property_id])
    reporter = relationship("User", foreign_keys=[reporter_user_id])
    resolver = relationship("User", foreign_keys=[resolved_by])
