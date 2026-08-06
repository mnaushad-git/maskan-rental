"""Moyasar payment gateway integration (mediator + renter subscriptions).

Real vs mock is chosen once by `get_payment_gateway_provider()`, gated by
`settings.USE_REAL_PAYMENTS` *and* `settings.MOYASAR_SECRET_KEY` being set —
either missing falls back to the mock so an accidental flag flip in an
unconfigured environment can't break the flow.

The real provider only ever *starts* a charge (hosted invoice for the first
subscription, saved-card charge for renewals) and records it as a `pending`
`Payment` row. It never activates a subscription itself — that happens
asynchronously via the already-real `/api/payments/webhook/moyasar` handler
(`app.api.routes.payments._handle_payment_paid`) once Moyasar confirms the
charge, exactly like a real gateway integration must work (the charge can
fail, require 3-D Secure, or simply take a moment to settle).

Callers pass their own `metadata` (used by the webhook to route the paid
event back to a mediator or a renter `User`) and, for invoices, their own
`success_url`/`back_url` — this file has no opinion on who the subscriber is.
"""
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from app.core.config import settings

logger = logging.getLogger("app.payments.moyasar")

MOYASAR_API_BASE_URL = "https://api.moyasar.com/v1"


@dataclass
class GatewayResult:
    success: bool
    gateway_payment_id: str | None = None
    payment_url: str | None = None  # set for hosted-checkout flows (invoices); None for direct token charges
    raw: dict | None = None
    error: str | None = None


class PaymentGatewayProvider(ABC):
    @abstractmethod
    def create_subscription_invoice(self, *, amount_sar: float, description: str, metadata: dict, success_url: str, back_url: str) -> GatewayResult: ...

    @abstractmethod
    def charge_saved_card(self, *, token: str, amount_sar: float, description: str, metadata: dict) -> GatewayResult: ...


class MockPaymentGatewayProvider(PaymentGatewayProvider):
    """No network call, no invoice — callers fall back to the original
    instant-activation mock rather than using this provider's result."""

    def create_subscription_invoice(self, *, amount_sar: float, description: str, metadata: dict, success_url: str, back_url: str) -> GatewayResult:
        return GatewayResult(success=False, error="mock provider does not create real invoices")

    def charge_saved_card(self, *, token: str, amount_sar: float, description: str, metadata: dict) -> GatewayResult:
        return GatewayResult(success=False, error="mock provider does not charge real cards")


class MoyasarPaymentGatewayProvider(PaymentGatewayProvider):
    def __init__(self) -> None:
        # Moyasar uses HTTP Basic auth with the secret key as username, empty password.
        self._client = httpx.Client(
            base_url=MOYASAR_API_BASE_URL,
            auth=(settings.MOYASAR_SECRET_KEY or "", ""),
            timeout=15.0,
        )

    def create_subscription_invoice(self, *, amount_sar: float, description: str, metadata: dict, success_url: str, back_url: str) -> GatewayResult:
        """Creates a Moyasar hosted-checkout Invoice — the frontend redirects
        the subscriber to `payment_url` to enter card details; Moyasar redirects
        back to success_url/back_url afterward, but actual activation is
        driven by the server-to-server webhook, not that redirect."""
        payload = {
            "amount": _to_halalas(amount_sar),
            "currency": "SAR",
            "description": description,
            "success_url": success_url,
            "back_url": back_url,
            "metadata": metadata,
        }
        result = self._post("/invoices", payload, context="invoice creation")
        if not result.success:
            return result
        return GatewayResult(success=True, gateway_payment_id=result.raw.get("id"), payment_url=result.raw.get("url"), raw=result.raw)

    def charge_saved_card(self, *, token: str, amount_sar: float, description: str, metadata: dict) -> GatewayResult:
        """Charges a previously-saved card token directly (renewals) — no
        redirect involved. Requires a token saved from a prior successful
        invoice payment (see `_handle_payment_paid` in payments.py)."""
        payload = {
            "amount": _to_halalas(amount_sar),
            "currency": "SAR",
            "description": description,
            "source": {"type": "token", "token": token},
            "metadata": metadata,
        }
        result = self._post("/payments", payload, context="renewal charge")
        if not result.success:
            return result
        return GatewayResult(success=True, gateway_payment_id=result.raw.get("id"), raw=result.raw)

    def _post(self, path: str, payload: dict, *, context: str) -> GatewayResult:
        try:
            response = self._client.post(path, json=payload)
        except httpx.HTTPError as exc:
            logger.error("Moyasar %s failed (network error): %s", context, exc)
            return GatewayResult(success=False, error=str(exc)[:200])

        if response.status_code not in (200, 201):
            logger.error("Moyasar %s failed: %s %s", context, response.status_code, response.text[:300])
            return GatewayResult(success=False, error=f"http_{response.status_code}: {response.text[:200]}")

        return GatewayResult(success=True, raw=response.json())


def _to_halalas(amount_sar: float) -> int:
    return int(round(amount_sar * 100))


_provider: PaymentGatewayProvider | None = None


def get_payment_gateway_provider() -> PaymentGatewayProvider:
    global _provider
    if _provider is None:
        if settings.USE_REAL_PAYMENTS and settings.MOYASAR_SECRET_KEY:
            _provider = MoyasarPaymentGatewayProvider()
        else:
            _provider = MockPaymentGatewayProvider()
    return _provider


def reset_payment_gateway_provider_for_tests() -> None:
    """Test-only: force the next get_payment_gateway_provider() call to
    rebuild (e.g. after monkeypatching settings.USE_REAL_PAYMENTS)."""
    global _provider
    _provider = None
