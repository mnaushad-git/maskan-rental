from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db, get_optional_current_user
from app.core.rate_limit import rate_limit_dependency
from app.models.ai_call_log import AICallLog
from app.models.analytics_event import ANALYTICS_EVENTS, AnalyticsEvent
from app.models.lead import Lead
from app.models.listing_image import ListingImage
from app.models.property import Property
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PropertyViewing
from app.models.user import User

router = APIRouter()


_WINDOW_DAYS = 30

# Data-quality goals shown next to each measured coverage figure. These are
# product targets (configuration), not measurements.
_DATA_QUALITY_TARGETS = {"photos": 90, "geocoded": 98, "partner": 85, "details": 90}


def _pct(part: int, whole: int) -> int:
    return int(round(part * 100 / whole)) if whole else 0


def _window_counts(db: Session, column, now: datetime) -> tuple[int, int]:
    """(rows created in the last 30 days, rows created in the 30 days before)."""
    start = now - timedelta(days=_WINDOW_DAYS)
    prev_start = start - timedelta(days=_WINDOW_DAYS)
    current = db.scalar(select(func.count()).where(column >= start)) or 0
    previous = db.scalar(select(func.count()).where(column >= prev_start, column < start)) or 0
    return int(current), int(previous)


def _new_kpi(label: str, total: int, new_in_window: int, accent: str) -> dict:
    return {
        "label": label,
        "value": f"{total:,}",
        "delta": f"+{new_in_window:,}" if new_in_window else "",
        "sub": f"new in last {_WINDOW_DAYS} days" if new_in_window else f"none new in last {_WINDOW_DAYS} days",
        "trend": "up" if new_in_window else "flat",
        "accent": accent,
    }


@router.get("/summary")
def analytics_summary(db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    """Admin analytics summary. Admin-only (P11-001).

    Every figure here is computed from real rows. This endpoint previously
    returned fabricated numbers (search demand / funnel derived by
    multiplying the listing count, hard-coded AI-trend and data-quality
    percentages, fixed "+8.2%"-style deltas and fake "5 min ago" activity).
    Metrics Maskan does not record yet are listed in `unavailable` and
    returned empty, so the dashboard can say so instead of inventing them."""
    now = datetime.now(timezone.utc)

    # Archived = deleted by a partner/admin (row kept for history) — never part of inventory.
    live = Property.status != "Archived"
    total_properties = db.scalar(select(func.count(Property.id)).where(live)) or 0
    total_users = db.scalar(select(func.count(User.id))) or 0
    total_leads = db.scalar(select(func.count(Lead.id))) or 0
    total_viewings = db.scalar(select(func.count(PropertyViewing.id))) or 0
    total_transactions = db.scalar(select(func.count(PropertyTransaction.id))) or 0
    total_views = db.scalar(select(func.coalesce(func.sum(Property.views_count), 0)).where(live)) or 0

    new_properties, _ = _window_counts(db, Property.created_at, now)
    new_leads, _ = _window_counts(db, Lead.created_at, now)
    new_users, _ = _window_counts(db, User.created_at, now)

    unavailable = ["searchDemand"]  # no search-event tracking exists yet

    # AI usage — from the AI call log (one row per model call).
    ai_trends: list[dict] = []
    try:
        ai_current, ai_previous = _window_counts(db, AICallLog.created_at, now)
        if ai_previous:
            change = round((ai_current - ai_previous) * 100 / ai_previous)
            delta = f"{change:+d}%"
            trend = "up" if change > 0 else "down" if change < 0 else "flat"
            sub = f"vs {ai_previous:,} in previous {_WINDOW_DAYS} days"
        else:
            delta, trend, sub = "", "flat", f"AI requests, last {_WINDOW_DAYS} days"
        ai_kpi = {"label": "AI requests", "value": f"{ai_current:,}", "delta": delta, "sub": sub, "trend": trend, "accent": "ai"}
        feature_rows = db.execute(
            select(AICallLog.feature, func.count(AICallLog.id).label("n"))
            .where(AICallLog.created_at >= now - timedelta(days=_WINDOW_DAYS))
            .group_by(AICallLog.feature)
            .order_by(func.count(AICallLog.id).desc())
            .limit(5)
        ).all()
        feature_total = sum(r.n for r in feature_rows)
        ai_trends = [
            {"label": r.feature.replace("_", " ").capitalize(), "count": int(r.n), "value": _pct(int(r.n), feature_total)}
            for r in feature_rows
        ]
    except SQLAlchemyError:
        db.rollback()
        ai_kpi = {"label": "AI requests", "value": "—", "delta": "", "sub": "AI usage log unavailable", "trend": "flat", "accent": "ai"}
        unavailable.append("aiTrends")

    area_rows = db.execute(
        select(Property.area.label("name"), Property.city.label("city"), func.count(Property.id).label("count"))
        .where(live)
        .group_by(Property.area, Property.city)
        .order_by(func.count(Property.id).desc())
        .limit(7)
    ).all()
    top_count = area_rows[0].count if area_rows else 0
    popular_areas = [
        {"name": r.name, "city": r.city, "listings": int(r.count), "share": _pct(int(r.count), int(top_count))}
        for r in area_rows
    ]

    inventory_rows = db.execute(
        select(
            Property.city,
            func.sum(case((Property.status == "Published", 1), else_=0)).label("published"),
            func.sum(case((Property.status == "Pending Approval", 1), else_=0)).label("pending"),
            func.sum(case((Property.status.notin_(["Published", "Pending Approval"]), 1), else_=0)).label("inactive"),
        )
        .where(live)
        .group_by(Property.city)
        .order_by(func.count(Property.id).desc())
    ).all()

    with_photos = db.scalar(
        select(func.count(func.distinct(ListingImage.property_id))).join(Property, Property.id == ListingImage.property_id).where(live)
    ) or 0
    geocoded = db.scalar(
        select(func.count(Property.id)).where(live, Property.latitude.isnot(None), Property.longitude.isnot(None))
    ) or 0
    with_partner = db.scalar(select(func.count(Property.id)).where(live, Property.mediator_id.isnot(None))) or 0
    complete_details = db.scalar(
        select(func.count(Property.id)).where(
            live,
            Property.size_sq_m.isnot(None), Property.bedrooms.isnot(None), Property.bathrooms.isnot(None)
        )
    ) or 0

    activity: list[dict] = []
    for prop in db.scalars(select(Property).order_by(Property.created_at.desc()).limit(4)).all():
        activity.append({
            "tone": "primary",
            "title": f"New listing — {prop.title}",
            "meta": f"{prop.area}, {prop.city} · {prop.status}",
            "time": prop.created_at.isoformat(),
        })
    for lead in db.scalars(select(Lead).order_by(Lead.created_at.desc()).limit(4)).all():
        activity.append({
            "tone": "info",
            "title": f"New lead #{lead.id}",
            "meta": "Status: " + (lead.status or "").replace("_", " "),
            "time": lead.created_at.isoformat(),
        })
    for u in db.scalars(select(User).order_by(User.created_at.desc()).limit(3)).all():
        activity.append({
            "tone": "success",
            "title": "New account registered",
            "meta": f"User #{u.id}",
            "time": u.created_at.isoformat(),
        })
    activity.sort(key=lambda a: a["time"], reverse=True)

    return {
        "generated_at": now.isoformat(),
        "window_days": _WINDOW_DAYS,
        "unavailable": unavailable,
        "total_properties": total_properties,
        "total_users": total_users,
        "kpis": [
            _new_kpi("Total properties", total_properties, new_properties, "primary"),
            _new_kpi("Total leads", total_leads, new_leads, "info"),
            _new_kpi("Registered users", total_users, new_users, "success"),
            ai_kpi,
        ],
        "searchDemand": [],
        "popularAreas": popular_areas,
        "funnel": [
            {"stage": "Listing views", "value": int(total_views), "color": "chart-1"},
            {"stage": "Leads created", "value": int(total_leads), "color": "chart-2"},
            {"stage": "Viewings scheduled", "value": int(total_viewings), "color": "chart-3"},
            {"stage": "Transactions started", "value": int(total_transactions), "color": "chart-4"},
        ],
        "aiTrends": ai_trends,
        "dataQuality": [
            {"label": "Listings with photos", "value": _pct(with_photos, total_properties), "target": _DATA_QUALITY_TARGETS["photos"]},
            {"label": "Geocoded location", "value": _pct(geocoded, total_properties), "target": _DATA_QUALITY_TARGETS["geocoded"]},
            {"label": "Assigned to a partner", "value": _pct(with_partner, total_properties), "target": _DATA_QUALITY_TARGETS["partner"]},
            {"label": "Size, bedrooms & bathrooms set", "value": _pct(complete_details, total_properties), "target": _DATA_QUALITY_TARGETS["details"]},
        ],
        "inventory": [
            {"city": r.city, "published": int(r.published or 0), "pending": int(r.pending or 0), "inactive": int(r.inactive or 0)}
            for r in inventory_rows
        ],
        "activity": activity[:8],
    }


@router.get("/trends")
def price_trends(db: Session = Depends(get_db), _admin: User = Depends(get_admin_user)):
    """Return price trend data over time. Admin-only (P11-001), same
    rationale as `analytics_summary` above — no frontend call site
    currently uses this endpoint, but it sits in the same admin-only router
    and should not be an unauthenticated outlier either."""
    rows = db.execute(
        select(Property.city, func.avg(Property.monthly_rent).label("avg_rent"))
        .group_by(Property.city)
        .order_by(Property.city)
    ).all()
    return {"trends": [{"city": row.city, "avg_rent": float(row.avg_rent or 0)} for row in rows]}


# ── Client analytics ingestion (Phase 10) ────────────────────────────────────

_MAX_EVENTS_PER_BATCH = 25
_MAX_PROPERTIES_KEYS = 20


class AnalyticsEventIn(BaseModel):
    event_name: str
    properties: dict = Field(default_factory=dict)

    @field_validator("event_name")
    @classmethod
    def _known_event(cls, v: str) -> str:
        if v not in ANALYTICS_EVENTS:
            raise ValueError(f"unknown event_name: {v}")
        return v

    @field_validator("properties")
    @classmethod
    def _bounded_properties(cls, v: dict) -> dict:
        # Defense-in-depth against accidentally logging message content or
        # full search criteria (Phase 10 explicitly forbids both): cap key
        # count and stringify+truncate every value rather than trusting the
        # client to only ever send small, safe fields.
        if len(v) > _MAX_PROPERTIES_KEYS:
            raise ValueError(f"too many properties keys (max {_MAX_PROPERTIES_KEYS})")
        return {str(k)[:60]: (str(val)[:200] if not isinstance(val, (int, float, bool)) else val) for k, val in v.items()}


class AnalyticsEventBatch(BaseModel):
    events: list[AnalyticsEventIn]

    @field_validator("events")
    @classmethod
    def _bounded_batch(cls, v: list) -> list:
        if not v:
            raise ValueError("events must not be empty")
        if len(v) > _MAX_EVENTS_PER_BATCH:
            raise ValueError(f"too many events in one batch (max {_MAX_EVENTS_PER_BATCH})")
        return v


@router.post("/events", status_code=201)
def ingest_analytics_events(
    body: AnalyticsEventBatch,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
    _rl=Depends(rate_limit_dependency("analytics_events", limit=120, window_seconds=60)),
):
    """Batch analytics-event ingestion from mobile/web clients (Phase 10).
    Auth-optional: some events (e.g. push_permission_prompt_shown) can fire
    before login. Never accepts free-form event names or unbounded payloads
    — see AnalyticsEventIn's validators — and never stores message content
    or full search criteria; that is a client-side + validator contract, not
    just documentation, since `properties` values are stringified+truncated
    regardless of what a client sends."""
    from app.core.request_context import get_request_id

    trace_id = get_request_id()
    for event in body.events:
        db.add(
            AnalyticsEvent(
                event_name=event.event_name,
                user_id=current_user.id if current_user else None,
                properties=event.properties,
                trace_id=trace_id,
            )
        )
    db.commit()
    return {"accepted": len(body.events)}
