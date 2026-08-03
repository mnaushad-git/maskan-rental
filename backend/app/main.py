from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.middleware import RequestIDMiddleware
import app.models  # noqa: F401 — registers all SQLAlchemy models before any mapper is configured
from app.api.routes import properties, search, analytics, areas, auth, users, saved_searches, saved_properties, ai, health
from app.api.routes import area_intelligence, mediators, leads, payments, reviews


@asynccontextmanager
async def lifespan(app: FastAPI):
    from apscheduler.schedulers.background import BackgroundScheduler
    from app.jobs.refresh_area_intelligence import refresh_all
    from app.jobs.expire_assignments import expire_stale_assignments
    scheduler = BackgroundScheduler(timezone="Asia/Riyadh")
    scheduler.add_job(refresh_all, "cron", hour=0, minute=0)
    scheduler.add_job(expire_stale_assignments, "interval", minutes=30)
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
    allow_origins=list({settings.FRONTEND_ORIGIN, "http://localhost:8080", "http://localhost:5173"}),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Request-ID"],
)
app.add_middleware(RequestIDMiddleware)

register_exception_handlers(app)

# Routers — each is mounted twice: at the legacy unversioned `/api/...` path
# (existing clients keep working unmodified) and at `/api/v1/...` (the path
# new clients should move to going forward). Same router instance, same
# behavior, just reachable from both prefixes.
_ROUTERS = [
    (auth.router, "/auth", ["auth"]),
    (users.router, "/users", ["users"]),
    (properties.router, "/properties", ["properties"]),
    (saved_properties.router, "/saved-properties", ["saved-properties"]),
    (saved_searches.router, "/saved-searches", ["saved-searches"]),
    (search.router, "/search", ["search"]),
    (analytics.router, "/analytics", ["analytics"]),
    (area_intelligence.router, "/areas", ["area-intelligence"]),
    (areas.router, "/areas", ["areas"]),
    (ai.router, "/ai", ["ai"]),
    (mediators.router, "/mediators", ["mediators"]),
    (leads.router, "/leads", ["leads"]),
    (payments.router, "/payments", ["payments"]),
    (reviews.router, "/reviews", ["reviews"]),
]

for router, path, tags in _ROUTERS:
    app.include_router(router, prefix=f"/api{path}", tags=tags)
for router, path, tags in _ROUTERS:
    app.include_router(router, prefix=f"/api/v1{path}", tags=[f"v1-{t}" for t in tags])

app.include_router(health.router, prefix="/api/health", tags=["health"])
app.include_router(health.router, prefix="/api/v1/health", tags=["v1-health"])
