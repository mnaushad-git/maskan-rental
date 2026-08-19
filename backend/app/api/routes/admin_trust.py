"""Property Verification & Trust Center — Admin moderation extensions
(Prompt 6, spec sections 14-15). Mirrors `property_request_admin.py`'s
existing pattern exactly: `get_admin_user` for permission checks,
`record_audit` for every mutating action, plain query-param filters + an
`X-Total-Count` response header for the list endpoint (see `list_requests`
there) rather than a paginated envelope object.

Deliberately does NOT introduce a separate moderation platform or its own
scoring: every trust/completeness/consistency/freshness number here comes
from Prompts 1-5's existing deterministic services and the exact same
`_build_trust_assessment` / `_assemble_property_intelligence` helpers
`properties.py`'s own customer-facing `/trust` and `/intelligence` endpoints
already call — imported directly (the same cross-router private-helper reuse
`mediators.py` already established for `reviews.py`'s `get_mediator_summary`)
rather than duplicated or recomputed.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.api.routes.mediators import _bulk_mediator_trust_activity_fields, _mediator_public_out
from app.api.routes.partner_quality import _missing_field_suggestions
from app.api.routes.properties import _assemble_property_intelligence, _build_trust_assessment, _load_property_for_intelligence
from app.core.audit import record_audit
from app.core.feature_flags import is_enabled
from app.core.metrics import properties_published_total
from app.core.outbox import EventType, record_event
from app.models.audit_log import AuditLog
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_report import PROPERTY_REPORT_ACTIVE_STATUSES, PropertyReport
from app.models.user import User
from app.schemas.admin_trust import (
    AdminDataQualityOut,
    AdminTrustDashboardOut,
    ModerationHistoryEntryOut,
    ModerationListItemOut,
    PropertyHideRequest,
    PropertyModerationActionOut,
    PropertyReviewDetailOut,
    ReportResolveOut,
    ReportResolveRequest,
)
from app.schemas.partner_quality import ImageQualityOut
from app.schemas.property_report import PropertyReportOut
from app.schemas.trust import CompletenessOut, TrustAssessmentOut
from app.services import image_quality as image_quality_service
from app.services import listing_completeness as listing_completeness_service
from app.services import listing_freshness as listing_freshness_service
from app.services import trust_assessment as trust_assessment_service

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────
# Judgment calls (no fuller feature spec present in this repo for sections
# 14-15's exact numbers — see the same caveat in every earlier prompt's
# section of docs/implementation/mymakan-trust-center.md). Kept local to this
# router rather than added to `trust_config.py`, mirroring Prompt 4's
# identical reasoning for `MIN_REVIEW_COUNT_FOR_AI_SUMMARY`: these gate an
# *admin moderation view*, not a Trust Model score input.
# ─────────────────────────────────────────────────────────────────────────

# Admin "hide" is a new Property.status value. `Property.status` has never
# been a DB-level enum (see `app/models/property.py` — plain String, default
# "Published") and the rest of the codebase already treats anything other
# than "Published" as not publicly visible (every existing
# `Property.status == "Published"` filter across search/matching/comparables
# would already exclude a "Hidden" row with zero code changes) — so this adds
# no migration and no new enum, exactly the "reuse existing property status
# mechanism" the prompt asked for.
ADMIN_HIDDEN_STATUS = "Hidden"

ADMIN_LOW_COMPLETENESS_THRESHOLD = 60
ADMIN_STALE_FRESHNESS_CATEGORIES = {"Needs Reconfirmation", "Potentially Stale"}
ADMIN_RECENTLY_REPORTED_DAYS = 14
ADMIN_MODERATION_HISTORY_LIMIT = 50

_REPORT_RESOLVE_ACTION_SLUG = {
    "Under Review": "under_review",
    "Resolved": "resolved",
    "Dismissed": "dismissed",
}


# ── Dashboard ────────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=AdminTrustDashboardOut)
def get_trust_dashboard(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """Counts for the six moderation queues (spec section 14). Completeness/
    staleness counts reuse Prompt 1's `compute_listing_completeness` /
    `compute_listing_freshness` per Published listing rather than a second
    scoring implementation — at this feature's demo-scale data volume (see
    the global "feature-first investor demo mode" constraint) that's simple
    and correct; a future prompt could push these thresholds into SQL if the
    listing count ever grows large enough for it to matter."""
    now = datetime.now(timezone.utc)

    listings_requiring_review = db.scalar(
        select(func.count()).select_from(Property).where(Property.status == "Pending Approval")
    ) or 0

    published = db.scalars(select(Property).where(Property.status == "Published")).all()
    low_completeness_listings = 0
    stale_listings = 0
    for prop in published:
        completeness = listing_completeness_service.compute_listing_completeness(prop)
        if completeness.score < ADMIN_LOW_COMPLETENESS_THRESHOLD:
            low_completeness_listings += 1
        freshness = listing_freshness_service.compute_listing_freshness(
            prop.created_at, prop.updated_at, prop.availability_confirmed_at, now=now
        )
        if freshness.category in ADMIN_STALE_FRESHNESS_CATEGORIES:
            stale_listings += 1

    open_reports = db.scalar(
        select(func.count()).select_from(PropertyReport).where(PropertyReport.status.in_(PROPERTY_REPORT_ACTIVE_STATUSES))
    ) or 0

    # "Pending verification" = not yet myMakan-verified (`is_verified` is
    # False) — deliberately independent of `approval_status` (portal-access
    # approval is a different gate; a mediator can be approved to use the
    # portal and still not be myMakan-verified yet).
    mediators_pending_verification = db.scalar(
        select(func.count()).select_from(Mediator).where(Mediator.is_verified.is_(False))
    ) or 0

    since = now - timedelta(days=ADMIN_RECENTLY_REPORTED_DAYS)
    recently_reported_properties = db.scalar(
        select(func.count(func.distinct(PropertyReport.property_id))).where(PropertyReport.created_at >= since)
    ) or 0

    return AdminTrustDashboardOut(
        listings_requiring_review=listings_requiring_review,
        low_completeness_listings=low_completeness_listings,
        stale_listings=stale_listings,
        open_reports=open_reports,
        mediators_pending_verification=mediators_pending_verification,
        recently_reported_properties=recently_reported_properties,
    )


# ── Moderation list ──────────────────────────────────────────────────────

def _item_trust_fields(prop: Property, mediator_trust_fields: dict) -> trust_assessment_service.TrustAssessment:
    """Same `assess_property_trust` call `_build_trust_assessment` makes for
    the customer `/trust` endpoint, reusing the mediator's already-bulk-
    loaded review/listing aggregates (from `mediators.py`'s own
    `_bulk_mediator_trust_activity_fields` helper — the identical N+1-free
    pattern that endpoint already uses for its own list view). Deliberately
    omits `data_confidence` (Marketplace Confidence) here: computing it needs
    a per-property comparables query, which would turn this list endpoint
    into an N+1 across every candidate row. The overall score/level here can
    therefore differ slightly from the single-property `/trust` and review-
    detail endpoints (which do include it, via `_build_trust_assessment`) —
    an accepted list-view performance trade-off, not a second scoring
    algorithm; every component that IS included is the exact same function
    call either way."""
    mf = mediator_trust_fields.get(prop.mediator_id, {}) if prop.mediator_id else {}
    return trust_assessment_service.assess_property_trust(
        prop,
        review_count=mf.get("review_count", 0),
        avg_rating=mf.get("avg_rating"),
        mediator_listing_count=mf.get("active_listing_count", 0),
        data_confidence=None,
    )


@router.get("/properties", response_model=list[ModerationListItemOut])
def list_moderation_properties(
    response: Response,
    transaction_type: str | None = Query(default=None, pattern="^(rent|sale)$"),
    city: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    trust_level: str | None = Query(default=None),
    low_completeness: bool | None = Query(default=None),
    reported: bool | None = Query(default=None),
    stale: bool | None = Query(default=None),
    mediator_verified: bool | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Filterable property moderation list (spec section 15). DB-pushable
    filters (`transaction_type`/`city`/`status`) narrow the candidate set
    first; trust/completeness/freshness/report-count are then computed
    per-candidate via the same reused services the dashboard/detail
    endpoints use, and the remaining filters (`trust_level`/
    `low_completeness`/`reported`/`stale`/`mediator_verified`) are applied in
    Python over that already-small candidate set — see `_item_trust_fields`'s
    docstring for why this stays N+1-free. `X-Total-Count` mirrors
    `property_request_admin.list_requests`'s existing convention (the
    post-filter, pre-pagination count)."""
    stmt = select(Property)
    if transaction_type:
        stmt = stmt.where(Property.listing_type == transaction_type)
    if city:
        stmt = stmt.where(Property.city.ilike(city))
    if status_filter:
        stmt = stmt.where(Property.status == status_filter)
    candidates = db.scalars(stmt).all()

    candidate_ids = [p.id for p in candidates]
    mediator_ids = list({p.mediator_id for p in candidates if p.mediator_id})
    mediator_trust_fields = _bulk_mediator_trust_activity_fields(db, mediator_ids)

    report_counts: dict[int, int] = {}
    if candidate_ids:
        rows = db.execute(
            select(PropertyReport.property_id, func.count(PropertyReport.id))
            .where(PropertyReport.property_id.in_(candidate_ids), PropertyReport.status.in_(PROPERTY_REPORT_ACTIVE_STATUSES))
            .group_by(PropertyReport.property_id)
        ).all()
        report_counts = dict(rows)

    rows: list[tuple[Property, ModerationListItemOut]] = []
    for prop in candidates:
        assessment = _item_trust_fields(prop, mediator_trust_fields)
        completeness = assessment.component_scores["completeness"]
        freshness = assessment.component_scores["freshness"]
        open_report_count = report_counts.get(prop.id, 0)
        mediator_is_verified = bool(prop.mediator and prop.mediator.is_verified)

        if trust_level is not None and assessment.trust_level != trust_level:
            continue
        if low_completeness is not None and (completeness.score < ADMIN_LOW_COMPLETENESS_THRESHOLD) != low_completeness:
            continue
        if reported is not None and (open_report_count > 0) != reported:
            continue
        if stale is not None and (freshness.category in ADMIN_STALE_FRESHNESS_CATEGORIES) != stale:
            continue
        if mediator_verified is not None and mediator_is_verified != mediator_verified:
            continue

        item = ModerationListItemOut(
            property_id=prop.id,
            title=prop.title,
            transaction_type=prop.listing_type,
            city=prop.city,
            area=prop.area,
            status=prop.status,
            mediator_id=prop.mediator_id,
            mediator_name=(prop.mediator.agency_name if prop.mediator else None),
            mediator_verified=mediator_is_verified,
            trust_score=assessment.overall_score,
            trust_level=assessment.trust_level,
            completeness_score=completeness.score,
            freshness_category=freshness.category,
            open_report_count=open_report_count,
            updated_at=prop.updated_at,
        )
        rows.append((prop, item))

    rows.sort(key=lambda r: r[0].updated_at, reverse=True)
    response.headers["X-Total-Count"] = str(len(rows))
    return [item for _prop, item in rows[skip : skip + limit]]


# ── Property review detail ──────────────────────────────────────────────

def _moderation_history(db: Session, property_id: int, report_ids: list[int]) -> list[ModerationHistoryEntryOut]:
    """Audit-log entries relevant to this property (spec section 15's
    "moderation history"): actions logged directly against the property
    (hide/restore/availability-confirmed — `entity_type="property"`) plus
    actions logged against any of its reports (`entity_type=
    "property_report"`, `POST /reports`'s `property.reported` and this
    router's own report-resolve actions) — `PropertyReport` rows don't carry
    `property_id` in their own audit entries, so both entity types have to be
    unioned here rather than a single equality filter."""
    conditions = [and_(AuditLog.entity_type == "property", AuditLog.entity_id == str(property_id))]
    if report_ids:
        conditions.append(
            and_(AuditLog.entity_type == "property_report", AuditLog.entity_id.in_([str(rid) for rid in report_ids]))
        )
    rows = db.scalars(
        select(AuditLog).where(or_(*conditions)).order_by(AuditLog.created_at.desc()).limit(ADMIN_MODERATION_HISTORY_LIMIT)
    ).all()
    return [ModerationHistoryEntryOut.model_validate(row) for row in rows]


@router.get("/properties/{property_id}", response_model=PropertyReviewDetailOut)
def get_property_review_detail(property_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """Full review-detail assembly (spec section 15): the exact same trust
    assessment `/trust` returns (`_build_trust_assessment`, imported
    directly, not recomputed), the same data-quality view the partner sees
    (`compute_listing_completeness` + `assess_image_quality`, the identical
    calls Prompt 3's `/quality` makes), the mediator's public trust profile
    (`mediators.py`'s own `_bulk_mediator_trust_activity_fields`/
    `_mediator_public_out`), every report ever filed on this listing, the
    same Property Intelligence assembly `/intelligence` uses (skipped, not
    error'd, when that feature flag is off — this admin view should never
    hard-fail on an unrelated flag), and moderation history from the audit
    log."""
    prop = _load_property_for_intelligence(db, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    assessment = _build_trust_assessment(db, prop)
    trust_out = TrustAssessmentOut.from_assessment(property_id, assessment)

    completeness = listing_completeness_service.compute_listing_completeness(prop)
    img_quality = image_quality_service.assess_image_quality(prop)
    data_quality = AdminDataQualityOut(
        completeness=CompletenessOut(**vars(completeness)),
        missing_field_suggestions=_missing_field_suggestions(completeness),
        image_quality=ImageQualityOut.from_result(img_quality),
    )

    mediator_out = None
    mediator_approval_status = None
    if prop.mediator_id and prop.mediator:
        trust_fields = _bulk_mediator_trust_activity_fields(db, [prop.mediator_id])
        mediator_out = _mediator_public_out(prop.mediator, trust_fields)
        mediator_approval_status = prop.mediator.approval_status

    reports = db.scalars(
        select(PropertyReport).where(PropertyReport.property_id == property_id).order_by(PropertyReport.created_at.desc())
    ).all()

    property_intelligence = None
    if is_enabled("property_intelligence"):
        property_intelligence = _assemble_property_intelligence(db, prop)

    moderation_history = _moderation_history(db, property_id, [r.id for r in reports])

    return PropertyReviewDetailOut(
        property_id=prop.id,
        title=prop.title,
        transaction_type=prop.listing_type,
        city=prop.city,
        area=prop.area,
        status=prop.status,
        trust=trust_out,
        data_quality=data_quality,
        mediator=mediator_out,
        mediator_approval_status=mediator_approval_status,
        reports=[PropertyReportOut.model_validate(r) for r in reports],
        property_intelligence=property_intelligence,
        moderation_history=moderation_history,
    )


# ── Moderation actions ───────────────────────────────────────────────────

@router.post("/properties/{property_id}/hide", response_model=PropertyModerationActionOut)
def hide_property(
    property_id: int,
    payload: PropertyHideRequest | None = None,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Hide/unpublish a listing (spec section 15). Reuses `Property.status`
    (see `ADMIN_HIDDEN_STATUS`'s docstring above) rather than inventing a
    separate moderation flag — every existing "Published only" query across
    the app already excludes a "Hidden" row automatically. Mirrors the
    existing generic admin `PATCH /properties/{id}` status-transition's own
    event-emission behavior (`PROPERTY_UNPUBLISHED` + `PROPERTY_AVAILABILITY_
    CHANGED`) so downstream consumers (property-request matching, etc.)
    behave identically regardless of which admin surface unpublished it."""
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if prop.status == ADMIN_HIDDEN_STATUS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property is already hidden")

    previous_status = prop.status
    was_published = previous_status == "Published"
    prop.status = ADMIN_HIDDEN_STATUS

    record_audit(
        db,
        user_id=admin.id,
        action="property.admin_hidden",
        entity_type="property",
        entity_id=prop.id,
        metadata={"previous_status": previous_status, "reason": payload.reason if payload else None},
    )
    if was_published:
        record_event(
            db, event_type=EventType.PROPERTY_UNPUBLISHED, aggregate_type="property", aggregate_id=prop.id,
            payload={"property_id": prop.id, "reason": "admin_hidden"},
        )
        record_event(
            db, event_type=EventType.PROPERTY_AVAILABILITY_CHANGED, aggregate_type="property", aggregate_id=prop.id,
            payload={"property_id": prop.id, "available": False},
        )

    db.commit()
    db.refresh(prop)
    return PropertyModerationActionOut(property_id=prop.id, status=prop.status)


@router.post("/properties/{property_id}/restore", response_model=PropertyModerationActionOut)
def restore_property(property_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """Reverses an admin `hide` — restores the listing to "Published". Only
    valid from `ADMIN_HIDDEN_STATUS` (not a generic status-setter — the
    existing generic admin `PATCH /properties/{id}` already covers arbitrary
    status changes); a listing that was never hidden has nothing to
    "restore" through this action."""
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if prop.status != ADMIN_HIDDEN_STATUS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Property is not currently hidden")

    prop.status = "Published"
    record_audit(
        db, user_id=admin.id, action="property.admin_restored", entity_type="property", entity_id=prop.id, metadata={},
    )
    record_event(
        db, event_type=EventType.PROPERTY_PUBLISHED, aggregate_type="property", aggregate_id=prop.id,
        payload={"property_id": prop.id, "republished": True},
    )
    properties_published_total.inc()

    db.commit()
    db.refresh(prop)
    return PropertyModerationActionOut(property_id=prop.id, status=prop.status)


@router.post("/reports/{report_id}/resolve", response_model=ReportResolveOut)
def resolve_report(
    report_id: int,
    payload: ReportResolveRequest,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Open -> Under Review / Resolved / Dismissed (spec section 15). Only
    valid from an active status (`Open`/`Under Review`) — a report that's
    already `Resolved`/`Dismissed` can't be re-resolved through this action
    (409), mirroring `POST /reports`' own "active status" concept from
    Prompt 2. `resolved_at`/`resolved_by` are only set on a terminal
    transition (`Resolved`/`Dismissed`), not on `Under Review`."""
    report = db.get(PropertyReport, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    if report.status not in PROPERTY_REPORT_ACTIVE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Report is already '{report.status}' and cannot be changed again.",
        )

    previous_status = report.status
    report.status = payload.status
    report.resolution_notes = payload.resolution_notes
    if payload.status in ("Resolved", "Dismissed"):
        report.resolved_at = datetime.now(timezone.utc)
        report.resolved_by = admin.id

    record_audit(
        db,
        user_id=admin.id,
        action=f"property_report.{_REPORT_RESOLVE_ACTION_SLUG[payload.status]}",
        entity_type="property_report",
        entity_id=report.id,
        metadata={"property_id": report.property_id, "previous_status": previous_status, "new_status": payload.status},
    )
    db.commit()
    db.refresh(report)
    return ReportResolveOut(
        id=report.id,
        property_id=report.property_id,
        status=report.status,
        resolved_at=report.resolved_at,
        resolved_by=report.resolved_by,
        resolution_notes=report.resolution_notes,
    )
