from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,  # empty container env vars fall through to .env file
    )

    ENV: str = "development"
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    DATABASE_URL: str = "postgresql://maskan_app:maskan_dev_123@localhost:5433/maskan"
    SECRET_KEY: str = "maskan-dev-secret-key-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days
    ANTHROPIC_API_KEY: str | None = None
    # Comma-separated admin emails, e.g. ADMIN_EMAILS=admin@example.com,ops@maskan.sa
    ADMIN_EMAILS: str = ""

    # ── Redis (cache, rate limiting, locks, idempotency) ──────────────────────
    # Optional by design: every Redis-backed feature must degrade gracefully
    # (cache miss / rate-limit fail-open / lock not acquired) when this is
    # unset or the server is unreachable — Postgres remains the system of
    # record and Redis is never required for correctness.
    REDIS_URL: str | None = None
    CACHE_VERSION: str = "v1"

    # ── Background jobs (Celery) ───────────────────────────────────────────────
    # Defaults to REDIS_URL (same instance, separate logical DB) so a single
    # REDIS_URL env var is enough to light up cache + jobs together; override
    # independently only if the broker needs to live elsewhere.
    CELERY_BROKER_URL: str | None = None
    CELERY_RESULT_BACKEND: str | None = None

    @property
    def celery_broker_url(self) -> str:
        return self.CELERY_BROKER_URL or self.REDIS_URL or "redis://localhost:6379/1"

    @property
    def celery_result_backend(self) -> str:
        return self.CELERY_RESULT_BACKEND or self.REDIS_URL or "redis://localhost:6379/1"

    @property
    def admin_emails(self) -> list[str]:
        return [e.strip() for e in self.ADMIN_EMAILS.split(",") if e.strip()]

    # ── Area Intelligence ─────────────────────────────────────────────────────
    GOOGLE_PLACES_API_KEY: str | None = None   # TODO: add real key when available
    GOOGLE_MAPS_API_KEY: str | None = None     # can be the same key as above

    # ── Mediator payments (Moyasar) ───────────────────────────────────────────
    # USE_REAL_PAYMENTS gates the real Moyasar API calls in mediators.py
    # (subscribe/renew). Off by default so the original mock (instant
    # activation, no network call) keeps working with zero config. Turning it
    # on also requires MOYASAR_SECRET_KEY — see app.core.moyasar and
    # .env.example for the full checklist; without a secret key the code
    # falls back to the mock even if this is true.
    USE_REAL_PAYMENTS: bool = False
    MOYASAR_PUBLISHABLE_KEY: str | None = None  # TODO: add real key when available
    MOYASAR_SECRET_KEY: str | None = None
    MOYASAR_WEBHOOK_SECRET: str | None = None
    LEAD_PICKUP_FEE_SAR: float = 25.0
    SUBSCRIPTION_FEE_SAR: float = 99.0

    # ── Renter premium tier ("AI Alert Plus") ─────────────────────────────────
    # Same Moyasar flow as the mediator subscription above (app.core.moyasar),
    # gated by the same USE_REAL_PAYMENTS/MOYASAR_SECRET_KEY pair.
    RENTER_PREMIUM_FEE_SAR: float = 19.0
    # Free-tier daily cap on AI Advisor chat messages ("AI Alert Plus" perk:
    # premium is unlimited). A simple per-day counter, not a new AI feature —
    # see app.api.routes.ai._enforce_free_chat_cap.
    AI_CHAT_FREE_DAILY_LIMIT: int = 15

    # ── Email notifications ───────────────────────────────────────────────────
    SENDGRID_API_KEY: str | None = None         # TODO: add real key when available
    FROM_EMAIL: str = "no-reply@maskan.sa"

    # ── Saved Search Alerts & Notification Center ─────────────────────────────
    SAVED_SEARCH_LIMIT_PER_USER: int = 25
    # A price move must clear BOTH the percentage and absolute thresholds to be
    # considered "meaningful" (avoids alert spam on trivial re-pricing while
    # still catching small-value listings where a % move is tiny in SAR terms).
    PRICE_CHANGE_THRESHOLD_PERCENT: float = 3.0
    PRICE_CHANGE_THRESHOLD_ABS_SAR: float = 1000.0
    NOTIFICATION_RETENTION_DAYS: int = 180

    # ── Feature flags (see app.core.feature_flags) ─────────────────────────────
    FEATURE_SAVED_SEARCH_ALERTS: bool = True
    FEATURE_NOTIFICATION_CENTER: bool = True
    FEATURE_DAILY_DIGEST: bool = True
    FEATURE_WEEKLY_DIGEST: bool = True
    FEATURE_PUSH_NOTIFICATIONS: bool = False
    FEATURE_AI_ALERT_EXPLANATIONS: bool = True
    FEATURE_CUSTOMER_NOTIFICATION_DROPDOWN: bool = True
    FEATURE_MOBILE_NOTIFICATION_CENTER: bool = True
    FEATURE_LEAD_GENERIC_NOTIFICATIONS: bool = True
    FEATURE_LIVE_NOTIFICATION_STREAM: bool = True
    FEATURE_PER_USER_DIGEST_SCHEDULE: bool = True
    FEATURE_NOTIFICATION_ADMIN_DASHBOARD: bool = True
    FEATURE_NOTIFICATION_QUIET_HOURS: bool = True
    FEATURE_NOTIFICATION_MESSAGE_PREVIEW: bool = True
    FEATURE_PUSH_TEST_ENDPOINT: bool = True

    # ── Real push notification delivery (Phase 2) ─────────────────────────────
    # Expo Push is the chosen provider (see DEPLOY.md "Push Notifications"):
    # the mobile app is a managed-ish Expo SDK 57 build with no existing
    # Firebase/FCM wiring, and the device API already speaks Expo's token
    # shape ({platform, push_token}). Expo's push service internally relays
    # to FCM/APNs — no Firebase SDK or credentials are embedded in this repo.
    PUSH_PROVIDER: str = "expo"  # "expo" | "fake" | "noop"
    EXPO_ACCESS_TOKEN: str | None = None  # TODO: add real key when available (raises Expo's per-project rate limit)
    PUSH_BATCH_SIZE: int = 100  # Expo's own hard cap per request
    PUSH_TIMEOUT_SECONDS: float = 10.0
    PUSH_RETRY_COUNT: int = 3
    PUSH_DRY_RUN: bool = False
    PUSH_DEFAULT_TTL_SECONDS: int = 2419200  # 28 days, Expo's own default
    PUSH_DEVICE_FAILURE_THRESHOLD: int = 5  # consecutive failures before auto-disabling a device
    ENVIRONMENT_NAME: str = "development"

    # ── Notification analytics / attribution ──────────────────────────────────
    NOTIFICATION_ATTRIBUTION_WINDOW_HOURS: int = 72

    # ── Property Request + AI Property Agent (Phase 2-19) ─────────────────────
    PROPERTY_REQUEST_MAX_CLARIFICATION_ROUNDS: int = 3
    PROPERTY_REQUEST_MATCH_IMPROVEMENT_THRESHOLD: float = 0.08  # min match_score delta to re-notify on recalculation
    PROPERTY_REQUEST_ACTIVE_LIMIT_PER_USER: int = 10
    PROPERTY_REQUEST_DEFAULT_EXPIRY_DAYS: int = 60
    PROPERTY_REQUEST_MEDIATOR_MAX_SUBMISSIONS_PER_REQUEST: int = 5
    PROPERTY_REQUEST_EXPIRING_SOON_DAYS: int = 5  # window for the "expiring" notification

    FEATURE_PROPERTY_REQUESTS: bool = True
    FEATURE_AI_PROPERTY_REQUEST_CREATION: bool = True
    FEATURE_AI_PROPERTY_AGENT: bool = True
    FEATURE_MEDIATOR_REQUEST_MARKETPLACE: bool = True
    FEATURE_PROPERTY_REQUEST_NOTIFICATIONS: bool = True
    FEATURE_PROPERTY_REQUEST_AREA_SUGGESTIONS: bool = True
    FEATURE_PROPERTY_REQUEST_COMMUTE_MATCHING: bool = True
    FEATURE_PROPERTY_REQUEST_AI_EXPLANATIONS: bool = True
    FEATURE_PROPERTY_REQUEST_ADMIN_DASHBOARD: bool = True

    @model_validator(mode="after")
    def _warn_insecure_defaults(self) -> "Settings":
        if self.ENV == "production" and self.SECRET_KEY == "maskan-dev-secret-key-change-me":
            raise ValueError("SECRET_KEY must be changed in production")
        return self


settings = Settings()
