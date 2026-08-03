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
    MOYASAR_PUBLISHABLE_KEY: str | None = None  # TODO: add real key when available
    MOYASAR_SECRET_KEY: str | None = None
    MOYASAR_WEBHOOK_SECRET: str | None = None
    LEAD_PICKUP_FEE_SAR: float = 25.0
    SUBSCRIPTION_FEE_SAR: float = 99.0

    # ── Email notifications ───────────────────────────────────────────────────
    SENDGRID_API_KEY: str | None = None         # TODO: add real key when available
    FROM_EMAIL: str = "no-reply@maskan.sa"

    @model_validator(mode="after")
    def _warn_insecure_defaults(self) -> "Settings":
        if self.ENV == "production" and self.SECRET_KEY == "maskan-dev-secret-key-change-me":
            raise ValueError("SECRET_KEY must be changed in production")
        return self


settings = Settings()
