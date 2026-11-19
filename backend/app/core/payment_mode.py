"""Single decision point for how paid plans may be activated.

Modes:
  * "real"        — Moyasar is fully configured (USE_REAL_PAYMENTS, the
                    secret key AND the webhook secret). Subscribe/renew only
                    *start* a charge; access is granted exclusively by a
                    signature-verified `payment.paid` webhook for a payment we
                    created.
  * "mock"        — instant activation with no charge. Allowed ONLY in local
                    development / test environments.
  * "unavailable" — anything else (e.g. production without Moyasar, or with
                    Moyasar but no webhook secret). Paid activation is refused
                    with 503; an admin can still activate a partner manually
                    from the Admin Portal.

Failing closed matters: previously, a production deployment with
USE_REAL_PAYMENTS unset silently fell back to the mock and handed out paid
subscriptions for free.
"""

from typing import Literal

from fastapi import HTTPException, status

from app.core.config import settings

PaymentMode = Literal["real", "mock", "unavailable"]

_MOCK_ALLOWED_ENVS = {"development", "dev", "local", "test", "testing"}


def payment_mode() -> PaymentMode:
    if settings.USE_REAL_PAYMENTS and settings.MOYASAR_SECRET_KEY and settings.MOYASAR_WEBHOOK_SECRET:
        return "real"
    if (settings.ENV or "").strip().lower() in _MOCK_ALLOWED_ENVS:
        return "mock"
    return "unavailable"


def require_payment_mode() -> PaymentMode:
    """Raise 503 when paid plans cannot be activated safely."""
    mode = payment_mode()
    if mode == "unavailable":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Online payment isn't available yet. Please contact Maskan to activate your subscription.",
        )
    return mode
