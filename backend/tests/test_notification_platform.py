"""Notification Platform upgrade tests: Expo push provider, device
reassignment, delivery tracking, quiet hours, category preferences, generic
lead notifications (recipient resolution + no-self-notify + dedupe), and
per-user digest scheduling math. Follows the existing suite's convention
(see tests/test_saved_search_alerts.py) of exercising internal task
functions directly against the transaction-scoped `db_session` fixture,
plus real HTTP round trips for API-surface behavior."""
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core.notification_providers import DeliveryResult, FakePushProvider, _map_ticket
from app.core.outbox import EventType
from app.models.device import Device
from app.models.lead import Lead, LeadAssignment, LeadMessage
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.models.notification_delivery import NotificationDelivery
from app.models.notification_preference import NotificationPreference
from app.models.user import User
from app.services.digest_scheduler import in_quiet_hours, next_daily_run, next_weekly_run, reschedule
from app.tasks import lead_notifications as lead_notif_tasks
from app.tasks import notifications as notif_tasks


def _make_user(db, email, **overrides) -> User:
    user = User(email=email, hashed_password="x", **overrides)
    db.add(user)
    db.flush()
    return user


def _make_lead(db, customer: User, **overrides) -> Lead:
    defaults = dict(
        customer_user_id=customer.id, customer_name="Test Customer", customer_phone="+966500000001",
        customer_email=customer.email, area_name="Al Yasmin", city="Riyadh", status="open",
    )
    defaults.update(overrides)
    lead = Lead(**defaults)
    db.add(lead)
    db.flush()
    return lead


def _make_mediator(db, user: User, **overrides) -> Mediator:
    defaults = dict(user_id=user.id, license_number=f"LIC-{user.id}", phone="+966500000002", subscription_status="active", is_verified=True, approval_status="approved")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator


@pytest.fixture(autouse=True)
def _patch_task_sessions(db_session, monkeypatch):
    monkeypatch.setattr(notif_tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(lead_notif_tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    monkeypatch.setattr(notif_tasks, "should_enrich", lambda change_type: False)


# ── Digest scheduling math (pure functions, no DB) ──────────────────────────

def test_next_daily_run_schedules_tomorrow_when_already_past_the_hour():
    now = datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc)  # 13:00 Asia/Riyadh
    result = next_daily_run(digest_hour=8, tz_name="Asia/Riyadh", now=now)
    assert result.astimezone(timezone.utc).date() == (now.date() + timedelta(days=1))


def test_next_daily_run_schedules_today_when_hour_not_yet_reached():
    now = datetime(2026, 1, 5, 2, 0, tzinfo=timezone.utc)  # 05:00 Asia/Riyadh
    result = next_daily_run(digest_hour=8, tz_name="Asia/Riyadh", now=now)
    assert result.astimezone(timezone.utc).date() == now.date()


def test_next_weekly_run_lands_on_requested_weekday():
    now = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)  # a Monday
    result = next_weekly_run(digest_hour=8, weekly_day=3, tz_name="UTC", now=now)  # Thursday
    assert result.weekday() == 3
    assert result > now


def test_reschedule_sets_both_next_run_fields(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    prefs = NotificationPreference(user_id=user.id, digest_hour=9, weekly_digest_day=2, timezone="Asia/Riyadh")
    db_session.add(prefs)
    db_session.flush()
    reschedule(prefs)
    assert prefs.next_daily_digest_at is not None
    assert prefs.next_weekly_digest_at is not None
    assert prefs.next_daily_digest_at.tzinfo is not None


def test_in_quiet_hours_handles_overnight_window(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    prefs = NotificationPreference(user_id=user.id, timezone="UTC", quiet_hours_enabled=True, quiet_hours_start="22:00", quiet_hours_end="07:00")
    db_session.add(prefs)
    db_session.flush()
    assert in_quiet_hours(prefs, now=datetime(2026, 1, 5, 23, 0, tzinfo=timezone.utc)) is True
    assert in_quiet_hours(prefs, now=datetime(2026, 1, 5, 3, 0, tzinfo=timezone.utc)) is True
    assert in_quiet_hours(prefs, now=datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)) is False


def test_in_quiet_hours_false_when_disabled(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    prefs = NotificationPreference(user_id=user.id, timezone="UTC", quiet_hours_enabled=False)
    db_session.add(prefs)
    db_session.flush()
    assert in_quiet_hours(prefs, now=datetime(2026, 1, 5, 23, 0, tzinfo=timezone.utc)) is False


# ── Expo push provider: ticket -> DeliveryResult mapping ───────────────────

def test_map_ticket_ok_is_accepted():
    result = _map_ticket({"status": "ok", "id": "abc-123"})
    assert result.status == "accepted"
    assert result.provider_message_id == "abc-123"


def test_map_ticket_device_not_registered_is_unregistered_token():
    result = _map_ticket({"status": "error", "message": "not registered", "details": {"error": "DeviceNotRegistered"}})
    assert result.status == "unregistered_token"
    assert result.failure_code == "DeviceNotRegistered"


def test_map_ticket_unknown_error_is_generic_failed():
    result = _map_ticket({"status": "error", "message": "boom", "details": {"error": "SomeOtherError"}})
    assert result.status == "failed"


def test_fake_push_provider_records_sends(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    device = Device(user_id=user.id, platform="android", push_token="ExponentPushToken[fake]", push_token_hash="h1")
    db_session.add(device)
    notification = Notification(id=1, user_id=user.id, type="system_announcement", title="t", body="b", delivery_status={}, meta={})
    provider = FakePushProvider()
    result = provider.send(device, notification, title="t", body="b")
    assert result.status == "accepted"
    assert len(provider.sent) == 1


# ── Device registration: reassignment / "one token, one active user" ───────

def test_registering_same_token_under_a_new_user_disables_the_old_row(client, db_session, unique_email):
    signup_a = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token_a = signup_a.json()["access_token"]
    signup_b = client.post("/api/auth/signup", json={"email": f"b-{unique_email}", "password": "S3cret!23"})
    token_b = signup_b.json()["access_token"]

    shared_token = "ExponentPushToken[shared-device-xyz]"
    resp_a = client.post("/api/devices/", json={"platform": "android", "push_token": shared_token}, headers={"Authorization": f"Bearer {token_a}"})
    assert resp_a.status_code == 201
    device_a_id = resp_a.json()["id"]

    resp_b = client.post("/api/devices/", json={"platform": "android", "push_token": shared_token}, headers={"Authorization": f"Bearer {token_b}"})
    assert resp_b.status_code == 201

    stale = db_session.get(Device, device_a_id)
    assert stale.enabled is False
    assert stale.invalidated_at is not None


def test_reregistering_same_user_same_token_reactivates_row(client, db_session, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    push_token = "ExponentPushToken[same-user]"

    first = client.post("/api/devices/", json={"platform": "ios", "push_token": push_token}, headers=headers)
    second = client.post("/api/devices/", json={"platform": "ios", "push_token": push_token, "app_version": "2.0"}, headers=headers)
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["app_version"] == "2.0"


# ── Notification preferences: category merge, quiet hours validation ───────

def test_patch_category_preferences_merges_not_replaces(client, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    client.get("/api/notification-preferences/", headers=headers)  # materialize defaults
    resp = client.patch(
        "/api/notification-preferences/",
        json={"category_preferences": {"lead_messages": {"channels": ["in_app"], "frequency": "off"}}},
        headers=headers,
    )
    assert resp.status_code == 200
    prefs = resp.json()["category_preferences"]
    assert prefs["lead_messages"]["frequency"] == "off"
    assert prefs["property_alerts"]["frequency"] == "instant"  # untouched by the partial update


def test_security_category_cannot_be_turned_off(client, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.patch(
        "/api/notification-preferences/",
        json={"category_preferences": {"security": {"channels": ["in_app"], "frequency": "off"}}},
        headers=headers,
    )
    assert resp.status_code == 422


def test_digest_hour_change_reschedules_next_run(client, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    before = client.get("/api/notification-preferences/", headers=headers).json()
    resp = client.patch("/api/notification-preferences/", json={"digest_hour": 14}, headers=headers)
    assert resp.status_code == 200
    after = resp.json()
    assert after["digest_hour"] == 14
    assert after["next_daily_digest_at"] != before["next_daily_digest_at"]


# ── Lead notifications: recipient resolution + no self-notify + dedupe ─────

def test_lead_message_from_customer_notifies_mediator_not_customer(db_session, unique_email):
    customer = _make_user(db_session, unique_email)
    mediator_user = _make_user(db_session, f"med-{unique_email}")
    mediator = _make_mediator(db_session, mediator_user)
    lead = _make_lead(db_session, customer, status="in_progress")
    db_session.add(LeadAssignment(lead_id=lead.id, mediator_id=mediator.id, status="accepted", expires_at=datetime.now(timezone.utc) + timedelta(hours=48)))
    msg = LeadMessage(lead_id=lead.id, sender_user_id=customer.id, sender_role="customer", content="Hello")
    db_session.add(msg)
    db_session.flush()
    db_session.commit()

    result = lead_notif_tasks.create_lead_notification(EventType.LEAD_MESSAGE_ADDED, str(lead.id), {"lead_id": lead.id, "message_id": msg.id, "sender_role": "customer", "actor_user_id": customer.id})
    assert result["created"] == 1

    notification = db_session.query(Notification).filter(Notification.type == "lead_message").one()
    assert notification.user_id == mediator_user.id
    assert notification.deep_link == f"myhome://lead/{lead.id}"


def test_lead_notification_never_notifies_the_actor(db_session, unique_email):
    customer = _make_user(db_session, unique_email)
    lead = _make_lead(db_session, customer, status="pending_review")
    db_session.commit()

    # LEAD_APPROVED always targets the customer; actor_user_id happening to
    # equal the customer (shouldn't occur in practice) must still suppress it.
    result = lead_notif_tasks.create_lead_notification(EventType.LEAD_APPROVED, str(lead.id), {"lead_id": lead.id, "actor_user_id": customer.id})
    assert result["created"] == 0


def test_lead_notification_is_idempotent_on_duplicate_event(db_session, unique_email):
    customer = _make_user(db_session, unique_email)
    lead = _make_lead(db_session, customer, status="open")
    db_session.commit()

    payload = {"lead_id": lead.id}
    first = lead_notif_tasks.create_lead_notification(EventType.LEAD_APPROVED, str(lead.id), payload)
    second = lead_notif_tasks.create_lead_notification(EventType.LEAD_APPROVED, str(lead.id), payload)
    assert first["created"] == 1
    assert second["created"] == 0
    assert db_session.query(Notification).filter(Notification.type == "lead_status_update", Notification.user_id == customer.id).count() == 1


def test_lead_assigned_admin_flow_notifies_mediator_not_customer(db_session, unique_email):
    customer = _make_user(db_session, unique_email)
    mediator_user = _make_user(db_session, f"med-{unique_email}")
    mediator = _make_mediator(db_session, mediator_user)
    lead = _make_lead(db_session, customer, status="assigned")
    db_session.commit()

    # No actor_user_id => admin-assignment flow => notify the mediator, not the customer.
    result = lead_notif_tasks.create_lead_notification(EventType.LEAD_ASSIGNED, str(lead.id), {"lead_id": lead.id, "mediator_id": mediator.id})
    assert result["created"] == 1
    notification = db_session.query(Notification).filter(Notification.entity_type == "lead").one()
    assert notification.user_id == mediator_user.id


def test_lead_closed_notifies_both_customer_and_mediator(db_session, unique_email):
    customer = _make_user(db_session, unique_email)
    mediator_user = _make_user(db_session, f"med-{unique_email}")
    mediator = _make_mediator(db_session, mediator_user)
    lead = _make_lead(db_session, customer, status="closed_won")
    db_session.add(LeadAssignment(lead_id=lead.id, mediator_id=mediator.id, status="accepted", expires_at=datetime.now(timezone.utc) + timedelta(hours=48)))
    db_session.commit()

    result = lead_notif_tasks.create_lead_notification(EventType.LEAD_CLOSED, str(lead.id), {"lead_id": lead.id, "outcome": "closed_won"})
    assert result["created"] == 2
    recipients = {n.user_id for n in db_session.query(Notification).filter(Notification.entity_type == "lead").all()}
    assert recipients == {customer.id, mediator_user.id}


def test_accept_lead_endpoint_emits_lead_assigned_event(client, db_session, unique_email):
    from app.core.outbox import EventType as ET
    from app.models.outbox_event import OutboxEvent

    customer = _make_user(db_session, unique_email)
    mediator_user = _make_user(db_session, f"med-{unique_email}")
    from app.api.routes.auth import hash_password
    mediator_user.hashed_password = hash_password("S3cret!23")
    mediator = _make_mediator(db_session, mediator_user)
    from app.models.mediator import MediatorArea
    db_session.add(MediatorArea(mediator_id=mediator.id, area_name="Al Yasmin", city="Riyadh"))
    lead = _make_lead(db_session, customer, status="open")
    db_session.commit()

    login = client.post("/api/auth/login", json={"email": mediator_user.email, "password": "S3cret!23"})
    token = login.json()["access_token"]
    resp = client.post(f"/api/leads/{lead.id}/accept", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200

    event = db_session.query(OutboxEvent).filter(OutboxEvent.event_type == ET.LEAD_ASSIGNED, OutboxEvent.aggregate_id == str(lead.id)).one()
    assert event.payload["actor_user_id"] == mediator_user.id


# ── Delivery tracking + quiet hours ──────────────────────────────────────────

def test_deliver_records_notification_delivery_rows_for_push(db_session, unique_email, monkeypatch):
    from app.core.config import settings as app_settings

    monkeypatch.setattr(app_settings, "FEATURE_PUSH_NOTIFICATIONS", True)
    monkeypatch.setattr(app_settings, "PUSH_PROVIDER", "fake")
    import app.core.notification_providers as providers_mod
    providers_mod.reset_push_provider_for_tests()

    user = _make_user(db_session, unique_email)
    device = Device(user_id=user.id, platform="android", push_token="ExponentPushToken[t1]", push_token_hash="h1", enabled=True)
    db_session.add(device)
    db_session.flush()

    notification = Notification(user_id=user.id, type="saved_search_new_listing", title="New match", body="A property matches your search", delivery_status={}, meta={})
    db_session.add(notification)
    db_session.flush()

    notif_tasks._deliver(db_session, notification, ["in_app", "push"])
    db_session.commit()

    deliveries = db_session.query(NotificationDelivery).filter(NotificationDelivery.notification_id == notification.id).all()
    channels = {d.channel for d in deliveries}
    assert "push" in channels
    assert "in_app" in channels
    push_delivery = next(d for d in deliveries if d.channel == "push")
    assert push_delivery.status == "accepted"
    assert push_delivery.device_id == device.id

    providers_mod.reset_push_provider_for_tests()


def test_quiet_hours_suppresses_push_but_not_in_app(db_session, unique_email, monkeypatch):
    from app.core.config import settings as app_settings

    monkeypatch.setattr(app_settings, "FEATURE_PUSH_NOTIFICATIONS", True)
    monkeypatch.setattr(app_settings, "PUSH_PROVIDER", "fake")
    import app.core.notification_providers as providers_mod
    providers_mod.reset_push_provider_for_tests()

    user = _make_user(db_session, unique_email)
    device = Device(user_id=user.id, platform="android", push_token="ExponentPushToken[t2]", push_token_hash="h2", enabled=True)
    db_session.add(device)
    prefs = NotificationPreference(user_id=user.id, quiet_hours_enabled=True, quiet_hours_start="00:00", quiet_hours_end="23:59", quiet_hours_allow_urgent=True, timezone="UTC")
    db_session.add(prefs)
    db_session.flush()
    reschedule(prefs)

    notification = Notification(user_id=user.id, type="saved_search_new_listing", title="New match", body="A property matches your search", delivery_status={}, meta={})
    db_session.add(notification)
    db_session.flush()

    notif_tasks._deliver(db_session, notification, ["in_app", "push"])
    db_session.commit()

    assert notification.delivery_status["in_app"] == "delivered"
    assert notification.delivery_status["push"] == "skipped"
    assert db_session.query(NotificationDelivery).filter(NotificationDelivery.notification_id == notification.id, NotificationDelivery.channel == "push").count() == 0

    providers_mod.reset_push_provider_for_tests()


def test_security_category_bypasses_quiet_hours(db_session, unique_email, monkeypatch):
    from app.core.config import settings as app_settings

    monkeypatch.setattr(app_settings, "FEATURE_PUSH_NOTIFICATIONS", True)
    monkeypatch.setattr(app_settings, "PUSH_PROVIDER", "fake")
    import app.core.notification_providers as providers_mod
    providers_mod.reset_push_provider_for_tests()

    user = _make_user(db_session, unique_email)
    device = Device(user_id=user.id, platform="android", push_token="ExponentPushToken[t3]", push_token_hash="h3", enabled=True)
    db_session.add(device)
    prefs = NotificationPreference(user_id=user.id, quiet_hours_enabled=True, quiet_hours_start="00:00", quiet_hours_end="23:59", quiet_hours_allow_urgent=True, timezone="UTC")
    db_session.add(prefs)
    db_session.flush()
    reschedule(prefs)

    notification = Notification(user_id=user.id, type="security", title="Security alert", body="New sign-in detected", delivery_status={}, meta={})
    db_session.add(notification)
    db_session.flush()

    notif_tasks._deliver(db_session, notification, ["in_app", "push"])
    db_session.commit()
    assert notification.delivery_status["push"] == "delivered"

    providers_mod.reset_push_provider_for_tests()


def test_permanent_rejection_disables_device(db_session, unique_email, monkeypatch):
    from app.core.config import settings as app_settings

    monkeypatch.setattr(app_settings, "FEATURE_PUSH_NOTIFICATIONS", True)
    monkeypatch.setattr(app_settings, "PUSH_PROVIDER", "fake")
    import app.core.notification_providers as providers_mod
    providers_mod.reset_push_provider_for_tests()
    provider = providers_mod.get_push_provider()
    assert isinstance(provider, FakePushProvider)
    provider.force_result = DeliveryResult(status="unregistered_token", failure_code="DeviceNotRegistered")

    user = _make_user(db_session, unique_email)
    device = Device(user_id=user.id, platform="android", push_token="ExponentPushToken[t4]", push_token_hash="h4", enabled=True)
    db_session.add(device)
    db_session.flush()

    notification = Notification(user_id=user.id, type="saved_search_new_listing", title="New match", body="body", delivery_status={}, meta={})
    db_session.add(notification)
    db_session.flush()

    notif_tasks._deliver(db_session, notification, ["in_app", "push"])
    db_session.commit()

    db_session.refresh(device)
    assert device.enabled is False
    assert device.invalidated_at is not None

    providers_mod.reset_push_provider_for_tests()


# ── Admin notification operations ────────────────────────────────────────────

def _admin_headers(db, email) -> dict:
    admin = _make_user(db, email, is_admin=True)
    db.commit()
    token = create_access_token(admin.id)
    return {"Authorization": f"Bearer {token}"}


def test_admin_overview_requires_admin(client, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]
    resp = client.get("/api/notifications/admin/overview", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_admin_overview_returns_kpis(client, db_session, unique_email):
    headers = _admin_headers(db_session, unique_email)
    resp = client.get("/api/notifications/admin/overview", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "notifications_created" in body
    assert "push_accepted" in body
    assert "active_devices" in body


def test_admin_disable_device(client, db_session, unique_email):
    user = _make_user(db_session, f"target-{unique_email}")
    device = Device(user_id=user.id, platform="android", push_token="ExponentPushToken[admin-disable]", push_token_hash="hx", enabled=True)
    db_session.add(device)
    db_session.commit()
    headers = _admin_headers(db_session, unique_email)

    resp = client.post(f"/api/devices/admin/{device.id}/disable", headers=headers)
    assert resp.status_code == 200
    db_session.refresh(device)
    assert device.enabled is False
