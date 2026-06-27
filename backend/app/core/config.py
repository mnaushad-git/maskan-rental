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
    ADMIN_EMAILS: list[str] = []

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
