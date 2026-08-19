from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging_config import configure_logging
from app.core.middleware import MetricsMiddleware, RequestIDMiddleware
import app.models  # noqa: F401 — registers all SQLAlchemy models before any mapper is configured
import app.tasks.notifications  # noqa: F401 — registers outbox event handlers (saved-search matching) at import time
import app.tasks.lead_notifications  # noqa: F401 — registers outbox event handlers (generic lead notifications) at import time
import app.tasks.property_requests  # noqa: F401 — registers outbox event handlers (property request matching) at import time
import app.tasks.viewing_notifications  # noqa: F401 — registers outbox event handlers (viewing notifications) at import time
import app.tasks.negotiation_notifications  # noqa: F401 — registers outbox event handlers (negotiation notifications) at import time
from app.api.routes import properties, search, analytics, areas, auth, users, saved_searches, saved_properties, ai, health, projects
from app.api.routes import area_intelligence, mediators, leads, contracts, payments, reviews, notifications, devices, bookings
from app.api.routes import property_requests, property_request_partner, property_request_admin, verification, subscriptions
from app.api.routes import financing
from app.api.routes import home_finder
from app.api.routes import partner_quality
from app.api.routes import admin_trust
from app.api.routes import viewings
from app.api.routes import partner_viewings
from app.api.routes import negotiations
from app.api.routes import partner_negotiations

configure_logging()


def _run_outbox_publisher() -> None:
    from app.core.jobs import enqueue
    from app.tasks.outbox import publish_pending_events
    enqueue(publish_pending_events)


def _run_digest_bucket() -> None:
    from app.core.jobs import enqueue
    from app.tasks.notifications import run_digest_bucket
    enqueue(run_digest_bucket)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.jobs.refresh_area_intelligence import refresh_all
    from app.jobs.expire_assignments import expire_stale_assignments
    from app.jobs.expire_property_requests import process_property_request_expiry
    scheduler = BackgroundScheduler(timezone="Asia/Riyadh")
    scheduler.add_job(refresh_all, "cron", day_of_week="thu", hour=0, minute=0)
    scheduler.add_job(expire_stale_assignments, "interval", minutes=30)
    scheduler.add_job(process_property_request_expiry, "interval", minutes=30)
    # Outbox publisher: frequent, cheap poll. enqueue() dispatches it to
    # Celery's scheduled_jobs queue when a broker is available, or just runs
    # it inline in this process otherwise — either way pending events get
    # picked up within ~15s of being written.
    scheduler.add_job(_run_outbox_publisher, "interval", seconds=15)
    # Per-user bucketed digest scheduler (Phase 5): runs every 15 minutes and
    # processes whichever users' next_daily_digest_at/next_weekly_digest_at
    # has arrived, so each user's digest fires at *their* configured local
    # hour/weekday rather than one fixed platform-wide cron tick. Digest runs
    # are themselves idempotent per (user, period, calendar day) — see
    # DigestRun — so a missed/duplicate tick is always safe.
    scheduler.add_job(_run_digest_bucket, "interval", minutes=15)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="Maskan Rental API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# CORS — allow the Vite dev server (and production origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list({settings.FRONTEND_ORIGIN, "http://localhost:8080", "http://localhost:8082", "http://localhost:5173"}),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Request-ID"],
)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(MetricsMiddleware)

register_exception_handlers(app)


@app.get("/metrics", include_in_schema=False)
def metrics():
    """Prometheus scrape endpoint. Deliberately at the root, not under
    `/api`, since it's ops surface rather than product API — kept off the
    OpenAPI schema for the same reason. Internal-only in production (not
    proxied publicly by Caddy)."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

# Routers — each is mounted twice: at the legacy unversioned `/api/...` path
# (existing clients keep working unmodified) and at `/api/v1/...` (the path
# new clients should move to going forward). Same router instance, same
# behavior, just reachable from both prefixes.
#
# A few routers are additionally gated behind a myMakan Phase-1 feature flag
# (see docs/implementation/mymakan-phase1.md "Feature flags"): when off, the
# router is simply never registered, so its endpoints 404 instead of running.
# Only the routers with an unambiguous 1:1 flag mapping are gated here;
# contracts/verification/subscriptions/payments stay registered because they
# either have no dedicated Phase-1 flag yet or are shared with in-scope flows
# (e.g. payments backs the in-scope mediator lead/subscription fee flow) — see
# the TODO in that doc's "Feature flags" section for Prompt 5 to revisit.
_ROUTERS = [
    (auth.router, "/auth", ["auth"]),
    (users.router, "/users", ["users"]),
    (properties.router, "/properties", ["properties"]),
    *([(projects.router, "/projects", ["projects"])] if settings.FEATURE_PROJECTS else []),
    (saved_properties.router, "/saved-properties", ["saved-properties"]),
    (saved_searches.router, "/saved-searches", ["saved-searches"]),
    (search.router, "/search", ["search"]),
    (analytics.router, "/analytics", ["analytics"]),
    (area_intelligence.router, "/areas", ["area-intelligence"]),
    (areas.router, "/areas", ["areas"]),
    (ai.router, "/ai", ["ai"]),
    *([(home_finder.router, "/ai/home-finder", ["ai-home-finder"])] if settings.FEATURE_AI_HOME_FINDER else []),
    (mediators.router, "/mediators", ["mediators"]),
    (leads.router, "/leads", ["leads"]),
    (contracts.router, "/contracts", ["contracts"]),
    *([(bookings.router, "/bookings", ["bookings"])] if settings.FEATURE_BOOKING else []),
    (payments.router, "/payments", ["payments"]),
    (reviews.router, "/reviews", ["reviews"]),
    (notifications.router, "/notifications", ["notifications"]),
    (notifications.preferences_router, "/notification-preferences", ["notification-preferences"]),
    (devices.router, "/devices", ["devices"]),
    (property_requests.router, "/property-requests", ["property-requests"]),
    (property_request_partner.router, "/partner/property-requests", ["partner-property-requests"]),
    (property_request_admin.router, "/admin/property-requests", ["admin-property-requests"]),
    (partner_quality.router, "/partner/properties", ["partner-quality"]),
    (admin_trust.router, "/admin/trust", ["admin-trust"]),
    *([(viewings.router, "/viewings", ["viewings"])] if settings.FEATURE_VISIT_MANAGEMENT else []),
    *([(partner_viewings.router, "/partner/viewings", ["partner-viewings"])] if settings.FEATURE_VISIT_MANAGEMENT else []),
    # negotiations.router deliberately mounts at an EMPTY path segment
    # (unlike every other entry in this list) — its endpoints span both
    # /properties/{id}/negotiations[/active] and /negotiations[/id], so the
    # router itself spells out each full path and only needs the bare
    # "/api"/"/api/v1" prefix from here. See negotiations.py's module
    # docstring.
    *([(negotiations.router, "", ["negotiations"])] if settings.FEATURE_NEGOTIATIONS else []),
    *([(partner_negotiations.router, "/partner/negotiations", ["partner-negotiations"])] if settings.FEATURE_NEGOTIATIONS else []),
    (verification.router, "/verification", ["verification"]),
    (subscriptions.router, "/subscriptions", ["subscriptions"]),
    *([(financing.router, "/financing", ["financing"])] if settings.FEATURE_FINANCING else []),
]

for router, path, tags in _ROUTERS:
    app.include_router(router, prefix=f"/api{path}", tags=tags)
for router, path, tags in _ROUTERS:
    app.include_router(router, prefix=f"/api/v1{path}", tags=[f"v1-{t}" for t in tags])

app.include_router(health.router, prefix="/api/health", tags=["health"])
app.include_router(health.router, prefix="/api/v1/health", tags=["v1-health"])
