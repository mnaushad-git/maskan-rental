"""Delivery-channel provider abstraction (Phase 2/11).

Nothing downstream of `get_push_provider()` / `get_email_provider()` should
know or care which concrete provider is wired up — every call site goes
through this interface. Push provider selection is via
`settings.PUSH_PROVIDER` ("expo" | "fake" | "noop"), gated end-to-end by
`settings.FEATURE_PUSH_NOTIFICATIONS`.

**Provider choice: Expo Push Notifications.** The mobile app (`mobile/`) is
an Expo SDK 57 build with no existing Firebase/FCM/APNs wiring anywhere in
the codebase, and the `/devices` API already accepts exactly the shape Expo
Push expects (`{platform, push_token}` where `push_token` is an
`ExponentPushToken[...]` string from `getExpoPushTokenAsync()`). Expo's push
service internally relays to FCM (Android) and APNs (iOS) — no Firebase SDK
or Google/Apple credentials are embedded in this backend; the only
credential this backend needs is an optional `EXPO_ACCESS_TOKEN` (raises
Expo's per-project send rate limit, not required to send at all).
"""
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

import httpx

from app.core.config import settings
from app.models.device import Device
from app.models.notification import Notification

logger = logging.getLogger("app.notifications.providers")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

# Expo ticket/receipt error codes that mean "this token will never work
# again" — must never be retried, and the device should be disabled.
_PERMANENT_ERROR_CODES = {"DeviceNotRegistered", "InvalidCredentials", "MessageTooBig", "MessageRateExceeded"}


@dataclass
class DeliveryResult:
    status: str  # see app.models.notification_delivery.DELIVERY_STATUSES
    detail: str = ""
    provider_message_id: str | None = None
    failure_code: str | None = None


class PushNotificationProvider(ABC):
    @abstractmethod
    def send(self, device: Device, notification: Notification, *, title: str, body: str, data: dict | None = None) -> DeliveryResult: ...

    def send_batch(self, sends: list[tuple[Device, Notification, str, str, dict | None]]) -> list[DeliveryResult]:
        """Default: send one at a time. Real batching providers (Expo)
        override this to use their bulk endpoint."""
        return [self.send(d, n, title=t, body=b, data=data) for d, n, t, b, data in sends]


class NoOpPushProvider(PushNotificationProvider):
    """Development/default provider: never actually calls a push gateway.
    Logs at debug level and reports "skipped" so delivery_status accurately
    reflects that nothing was really sent — callers must not assume
    "skipped" means failure; it means "push channel isn't provisioned yet"."""

    def send(self, device: Device, notification: Notification, *, title: str, body: str, data: dict | None = None) -> DeliveryResult:
        logger.debug("NoOpPushProvider: would send to device=%s: %s", device.id, title)
        return DeliveryResult(status="skipped", detail="push provider not configured")


class FakePushProvider(PushNotificationProvider):
    """Deterministic in-memory provider for tests and local dev
    (`PUSH_PROVIDER=fake`). Records every call in `.sent` so tests can
    assert on it; `.force_result` lets a test simulate a specific outcome
    (e.g. an invalid-token response) without a network call."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.force_result: DeliveryResult | None = None

    def send(self, device: Device, notification: Notification, *, title: str, body: str, data: dict | None = None) -> DeliveryResult:
        self.sent.append({"device_id": device.id, "notification_id": notification.id, "title": title, "body": body, "data": data})
        if self.force_result is not None:
            return self.force_result
        return DeliveryResult(status="accepted", provider_message_id=f"fake-{notification.id}-{device.id}")


class ExpoPushProvider(PushNotificationProvider):
    """Real provider: batches messages to Expo's push API (up to
    `settings.PUSH_BATCH_SIZE` per request, Expo's own hard cap is 100),
    maps Expo's per-ticket status back to `DeliveryResult`, and retries
    transient failures (network error / 5xx / provider "rate limited") with
    bounded exponential backoff — bounded because this runs synchronously
    inside the notification-creation request/task path (see
    `app.tasks.notifications._deliver`), not as its own separately-retried
    Celery task; a long retry loop here would stall that path.

    Expo's response is a *ticket*, not a delivery confirmation — "ok" means
    "Expo accepted the message for delivery to FCM/APNs", not "the device
    received it". A later delivery receipt (fetched via a separate,
    not-yet-wired Expo receipts endpoint) would be needed for a true
    "delivered" status; today `send()` only ever returns "accepted" or a
    failure — never "delivered" — which is why `DELIVERY_STATUSES` includes
    both.
    """

    def __init__(self) -> None:
        self._client = httpx.Client(timeout=settings.PUSH_TIMEOUT_SECONDS)

    def _headers(self) -> dict:
        headers = {"Accept": "application/json", "Content-Type": "application/json", "Accept-Encoding": "gzip, deflate"}
        if settings.EXPO_ACCESS_TOKEN:
            headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
        return headers

    def _message_for(self, device: Device, notification: Notification, *, title: str, body: str, data: dict | None) -> dict:
        payload = {
            "to": device.push_token,
            "title": title,
            "sound": "default",
            "priority": "high",
            "ttl": settings.PUSH_DEFAULT_TTL_SECONDS,
            "channelId": _channel_for(notification.type),
            "data": {
                "notificationId": notification.id,
                "type": notification.type,
                "deepLink": notification.deep_link,
                **(data or {}),
            },
        }
        # Message-preview hiding (Phase 3/14): body omitted from the push
        # payload entirely for lock-screen-sensitive categories when the
        # recipient has hidden previews — see _deliver()'s caller, which
        # passes an already-redacted `body` in that case, so this is just
        # forwarding, not a second redaction pass.
        payload["body"] = body
        return payload

    def send(self, device: Device, notification: Notification, *, title: str, body: str, data: dict | None = None) -> DeliveryResult:
        return self.send_batch([(device, notification, title, body, data)])[0]

    def send_batch(self, sends: list[tuple[Device, Notification, str, str, dict | None]]) -> list[DeliveryResult]:
        if settings.PUSH_DRY_RUN:
            return [DeliveryResult(status="accepted", detail="dry_run") for _ in sends]

        results: list[DeliveryResult] = []
        for start in range(0, len(sends), settings.PUSH_BATCH_SIZE):
            chunk = sends[start:start + settings.PUSH_BATCH_SIZE]
            messages = [self._message_for(d, n, title=t, body=b, data=data) for d, n, t, b, data in chunk]
            results.extend(self._send_chunk_with_retry(messages))
        return results

    def _send_chunk_with_retry(self, messages: list[dict]) -> list[DeliveryResult]:
        attempt = 0
        while True:
            attempt += 1
            try:
                response = self._client.post(EXPO_PUSH_URL, headers=self._headers(), json=messages)
            except httpx.HTTPError as exc:
                if attempt <= settings.PUSH_RETRY_COUNT:
                    time.sleep(min(2 ** attempt * 0.1, 2.0))
                    continue
                logger.error("ExpoPushProvider: network error after %s attempts: %s", attempt, exc)
                return [DeliveryResult(status="provider_unavailable", detail=str(exc)[:200]) for _ in messages]

            if response.status_code == 429:
                if attempt <= settings.PUSH_RETRY_COUNT:
                    time.sleep(min(2 ** attempt * 0.2, 3.0))
                    continue
                return [DeliveryResult(status="rate_limited", detail="Expo push API rate limited") for _ in messages]

            if response.status_code >= 500:
                if attempt <= settings.PUSH_RETRY_COUNT:
                    time.sleep(min(2 ** attempt * 0.2, 3.0))
                    continue
                return [DeliveryResult(status="provider_unavailable", detail=f"Expo push API returned {response.status_code}") for _ in messages]

            if response.status_code != 200:
                logger.error("ExpoPushProvider: unexpected status %s: %s", response.status_code, response.text[:300])
                return [DeliveryResult(status="failed", detail=f"http_{response.status_code}") for _ in messages]

            try:
                tickets = response.json().get("data", [])
            except ValueError:
                return [DeliveryResult(status="failed", detail="invalid_json_response") for _ in messages]

            return [_map_ticket(t) for t in tickets] if tickets else [DeliveryResult(status="failed", detail="empty_response") for _ in messages]


def _map_ticket(ticket: dict) -> DeliveryResult:
    status = ticket.get("status")
    if status == "ok":
        return DeliveryResult(status="accepted", provider_message_id=ticket.get("id"))
    error_code = (ticket.get("details") or {}).get("error")
    message = ticket.get("message", "")
    if error_code == "DeviceNotRegistered":
        return DeliveryResult(status="unregistered_token", failure_code=error_code, detail=message[:200])
    if error_code in _PERMANENT_ERROR_CODES:
        return DeliveryResult(status="permanent_rejection", failure_code=error_code, detail=message[:200])
    return DeliveryResult(status="failed", failure_code=error_code, detail=message[:200])


def _channel_for(notification_type: str) -> str:
    """Android notification channel id (Phase 2C). Channels are created
    client-side (see mobile/src/lib/push.ts) with matching ids — this just
    routes each notification type to the right one so users can control
    importance/sound per category from Android system settings."""
    if notification_type.startswith("lead_"):
        return "leads"
    if notification_type.startswith("saved_search_"):
        return "property_alerts"
    if notification_type == "security":
        return "security"
    return "default"


class EmailProvider(ABC):
    @abstractmethod
    def send(self, *, to_email: str, subject: str, body: str) -> DeliveryResult: ...


class NoOpEmailProvider(EmailProvider):
    def send(self, *, to_email: str, subject: str, body: str) -> DeliveryResult:
        logger.debug("NoOpEmailProvider: would email %s: %s", to_email, subject)
        return DeliveryResult(status="skipped", detail="email provider not configured (no SENDGRID_API_KEY)")


_push_provider: PushNotificationProvider | None = None
_email_provider: EmailProvider | None = None


def get_push_provider() -> PushNotificationProvider:
    global _push_provider
    if _push_provider is None:
        if not settings.FEATURE_PUSH_NOTIFICATIONS:
            _push_provider = NoOpPushProvider()
        elif settings.PUSH_PROVIDER == "expo":
            _push_provider = ExpoPushProvider()
        elif settings.PUSH_PROVIDER == "fake":
            _push_provider = FakePushProvider()
        else:
            _push_provider = NoOpPushProvider()
    return _push_provider


def reset_push_provider_for_tests() -> None:
    """Test-only: force the next get_push_provider() call to rebuild (e.g.
    after monkeypatching settings.PUSH_PROVIDER)."""
    global _push_provider
    _push_provider = None


def get_email_provider() -> EmailProvider:
    global _email_provider
    if _email_provider is None:
        _email_provider = NoOpEmailProvider()
    return _email_provider
