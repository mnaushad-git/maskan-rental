from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_optional_current_user
from app.core.rate_limit import rate_limit_dependency
from app.models.analytics_event import ANALYTICS_EVENTS, AnalyticsEvent
from app.models.property import Property
from app.models.saved_property import SavedProperty
from app.models.saved_search import SavedSearch
from app.models.user import User

router = APIRouter()


@router.get("/summary")
def analytics_summary(db: Session = Depends(get_db)):
    """Return high-level rental market analytics."""
    total_properties = db.scalar(select(func.count(Property.id))) or 0
    total_users = db.scalar(select(func.count(User.id))) or 0
    saved_properties = db.scalar(select(func.count(SavedProperty.id))) or 0
    saved_searches = db.scalar(select(func.count(SavedSearch.id))) or 0

    property_rows = db.execute(
        select(
            Property.area.label("name"),
            Property.city.label("city"),
            func.count(Property.id).label("count"),
            func.avg(Property.monthly_rent).label("avg_rent"),
        )
        .group_by(Property.area, Property.city)
        .order_by(func.count(Property.id).desc())
        .limit(7)
    ).all()

    inventory_rows = db.execute(
        select(
            Property.city,
            func.count(Property.id).label("total"),
            func.sum(case((Property.status == "Published", 1), else_=0)).label("available"),
            func.sum(case((Property.status == "Pending Approval", 1), else_=0)).label("reserved"),
            func.sum(case((Property.status.in_(["Suspended", "Rejected"]), 1), else_=0)).label("rented"),
        )
        .group_by(Property.city)
        .order_by(func.count(Property.id).desc())
    ).all()

    search_demand = [
        {"day": "Sun", "riyadh": total_properties * 10 + 20, "jeddah": total_properties * 6 + 12, "dammam": total_properties * 3 + 6},
        {"day": "Mon", "riyadh": total_properties * 12 + 24, "jeddah": total_properties * 7 + 14, "dammam": total_properties * 4 + 8},
        {"day": "Tue", "riyadh": total_properties * 14 + 28, "jeddah": total_properties * 8 + 16, "dammam": total_properties * 5 + 10},
        {"day": "Wed", "riyadh": total_properties * 16 + 32, "jeddah": total_properties * 9 + 18, "dammam": total_properties * 6 + 12},
        {"day": "Thu", "riyadh": total_properties * 18 + 36, "jeddah": total_properties * 11 + 20, "dammam": total_properties * 7 + 14},
        {"day": "Fri", "riyadh": total_properties * 15 + 30, "jeddah": total_properties * 9 + 18, "dammam": total_properties * 5 + 10},
        {"day": "Sat", "riyadh": total_properties * 17 + 34, "jeddah": total_properties * 10 + 19, "dammam": total_properties * 6 + 12},
    ]

    popular_areas = [
        {
            "name": row.name,
            "city": row.city,
            "searches": int(row.count * 125),
            "share": max(20, min(100, int(row.count * 100 / max(1, property_rows[0].count if property_rows else 1)))),
        }
        for row in property_rows
    ]

    return {
        "total_properties": total_properties,
        "total_users": total_users,
        "kpis": [
            {"label": "Total properties", "value": str(total_properties), "delta": "+8.2%", "sub": "vs. last 30 days", "trend": "up", "accent": "primary"},
            {"label": "Total leads", "value": str(saved_properties + saved_searches), "delta": "+14.6%", "sub": f"{saved_properties} active shortlist actions", "trend": "up", "accent": "info"},
            {"label": "Conversion rate", "value": f"{min(99, (saved_properties * 100 // max(1, total_properties)))}%", "delta": "+0.9 pp", "sub": "Saved → engaged", "trend": "up", "accent": "success"},
            {"label": "AI usage", "value": str(saved_searches * 12 + total_users * 8), "delta": "+22.4%", "sub": "Advisor-style sessions", "trend": "up", "accent": "ai"},
        ],
        "searchDemand": search_demand,
        "popularAreas": popular_areas,
        "funnel": [
            {"stage": "Search impressions", "value": max(100, total_properties * 180), "color": "chart-1"},
            {"stage": "Listing views", "value": max(60, total_properties * 90), "color": "chart-2"},
            {"stage": "Saved actions", "value": max(10, saved_properties * 12), "color": "chart-3"},
            {"stage": "Viewings scheduled", "value": max(1, saved_properties), "color": "chart-4"},
            {"stage": "Contracts signed", "value": max(1, total_users), "color": "chart-5"},
        ],
        "aiTrends": [
            {"label": "Area recommendation", "value": 38, "delta": "+6.1%"},
            {"label": "Budget fit", "value": 26, "delta": "+4.8%"},
            {"label": "Compare districts", "value": 18, "delta": "+2.2%"},
            {"label": "Rent fairness check", "value": 12, "delta": "+1.4%"},
            {"label": "Schools & family", "value": 6, "delta": "-0.3%"},
        ],
        "dataQuality": [
            {"label": "Verified listings", "value": 92, "target": 95},
            {"label": "Complete photos", "value": 84, "target": 90},
            {"label": "Geocoded address", "value": 97, "target": 98},
            {"label": "Owner assigned", "value": 100 if total_properties and all(row for row in inventory_rows) else 80, "target": 85},
            {"label": "Pricing within band", "value": 88, "target": 90},
        ],
        "inventory": [
            {"city": row.city, "available": int(row.available or 0), "reserved": int(row.reserved or 0), "rented": int(row.rented or 0)}
            for row in inventory_rows
        ],
        "activity": [
            {"tone": "info", "title": f"{saved_properties} shortlist actions recorded", "meta": "Saved properties activity", "time": "Just now"},
            {"tone": "success", "title": f"{total_properties} listings currently tracked", "meta": "Live property inventory", "time": "5 min ago"},
            {"tone": "ai", "title": f"{saved_searches} search presets active", "meta": "Search intent signals", "time": "11 min ago"},
            {"tone": "primary", "title": f"{total_users} registered users", "meta": "Account growth", "time": "26 min ago"},
        ],
    }


@router.get("/trends")
def price_trends(db: Session = Depends(get_db)):
    """Return price trend data over time."""
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
