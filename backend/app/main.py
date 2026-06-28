from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
import app.models  # noqa: F401 — registers all SQLAlchemy models before any mapper is configured
from app.api.routes import properties, search, analytics, areas, auth, users, saved_searches, saved_properties, ai
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
)

# Routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(properties.router, prefix="/api/properties", tags=["properties"])
app.include_router(saved_properties.router, prefix="/api/saved-properties", tags=["saved-properties"])
app.include_router(saved_searches.router, prefix="/api/saved-searches", tags=["saved-searches"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(area_intelligence.router, prefix="/api/areas", tags=["area-intelligence"])
app.include_router(areas.router, prefix="/api/areas", tags=["areas"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(mediators.router, prefix="/api/mediators", tags=["mediators"])
app.include_router(leads.router, prefix="/api/leads", tags=["leads"])
app.include_router(payments.router, prefix="/api/payments", tags=["payments"])
app.include_router(reviews.router, prefix="/api/reviews", tags=["reviews"])


@app.get("/api/health", tags=["health"])
def health_check():
    return {"status": "ok"}
