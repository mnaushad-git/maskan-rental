"""Regression tests for the Partner Portal release blockers.

  1. Celery worker context registers every outbox handler + notification task
     (previously viewing/negotiation/transaction/document events were marked
     published on the worker with no handler → no notifications at all).
  2. Notifications dedupe per outbox event, so a second counter-offer /
     document upload on the same record still notifies — and a retried event
     does not duplicate.
  3. Paid plans never activate for free outside development, and the Moyasar
     webhook only grants access when signed, for a payment Maskan created,
     with a matching amount.
  4. Non-public listings are not readable by direct id (detail / images /
     trust / similar / intelligence / duplicate-check), with owner, admin and
     engaged-customer access preserved.
  5. Partner listing lifecycle: edit Pending/Rejected, unpublish, resubmit,
     archive (history preserved), ownership enforced.
  6. Device photo uploads: type/size/ownership validation, signed URLs for
     non-public listings, photo changes re-enter moderation.
  7. Partner/admin views don't inflate customer view counts.
"""
import hashlib
import hmac
import json
import pathlib
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core import rate_limit
from app.core.config import settings
from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.models.payment import Payment
from app.models.property import Property
from app.models.user import User
from app.services import listing_media

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    monkeypatch.setattr(
        rate_limit, "check_rate_limit", lambda *a, limit, **k: rate_limit.RateLimitResult(True, limit, limit, 0)
    )


@pytest.fixture()
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setattr(listing_media, "LISTING_UPLOAD_ROOT", tmp_path)
    return tmp_path


def _user(db, **kw) -> User:
    u = User(email=f"prb-{uuid.uuid4().hex[:10]}@example.com", hashed_password="x", **kw)
    db.add(u)
    db.flush()
    return u


def _partner(db) -> tuple[User, Mediator]:
    u = _user(db)
    m = Mediator(
        user_id=u.id,
        license_number=f"LIC-{uuid.uuid4().hex[:6]}",
        phone="0500000001",
        subscription_status="active",
        approval_status="approved",
    )
    db.add(m)
    db.flush()
    return u, m


def _listing(db, mediator: Mediator, status="Published", **kw) -> Property:
    defaults = dict(
        title=f"PRB {uuid.uuid4().hex[:6]}", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=5000.0, status=status, mediator_id=mediator.id, contact_phone="0500000001",
    )
    defaults.update(kw)
    p = Property(**defaults)
    db.add(p)
    db.flush()
    return p


def _h(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


# ── 1. Worker registration ───────────────────────────────────────────────────


def test_worker_context_registers_all_outbox_handlers_and_tasks():
    """Imports ONLY what a Celery worker imports (no app.main) in a clean
    interpreter and checks the handler registry."""
    code = (
        "from app.core.celery_app import celery_app\n"
        "celery_app.loader.import_default_modules()\n"
        "from app.tasks.outbox import _HANDLERS\n"
        "import json\n"
        "print(json.dumps({'handlers': sorted(_HANDLERS), 'tasks': sorted(celery_app.tasks)}))\n"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    data = json.loads(out.stdout.strip().splitlines()[-1])
    for event in (
        "viewing.requested", "viewing.confirmed", "viewing.reschedule_proposed", "viewing.cancelled", "viewing.completed",
        "negotiation.offer_submitted", "negotiation.counter_received", "negotiation.accepted",
        "negotiation.rejected", "negotiation.withdrawn",
        "transaction.created", "transaction.action_required",
        "document.uploaded", "document.accepted", "document.update_requested",
        "lead.created", "lead.message_added",
    ):
        assert event in data["handlers"], f"{event} has no handler in worker context"
    for task in (
        "app.tasks.viewing_notifications.create_viewing_notification",
        "app.tasks.negotiation_notifications.create_negotiation_notification",
        "app.tasks.transaction_notifications.create_transaction_notification",
    ):
        assert task in data["tasks"]


def test_every_handler_module_is_in_the_worker_include_list():
    from app.core.celery_app import WORKER_TASK_MODULES

    for path in (BACKEND / "app" / "tasks").glob("*.py"):
        if "@register_handler" in path.read_text(encoding="utf-8"):
            module = f"app.tasks.{path.stem}"
            assert module in WORKER_TASK_MODULES, f"{module} registers handlers but the worker never imports it"


def test_notification_tasks_route_to_notifications_queue():
    from app.core.celery_app import celery_app

    routes = celery_app.conf.task_routes
    for mod in ("viewing_notifications", "negotiation_notifications", "transaction_notifications"):
        assert routes[f"app.tasks.{mod}.*"]["queue"] == "notifications"


# ── 2. Dedupe per event ──────────────────────────────────────────────────────


class _NoClose:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, item):
        return getattr(self._db, item)

    def close(self):
        pass


def test_viewing_notifications_dedupe_per_event_not_per_record(client, db_session, monkeypatch):
    from app.tasks import notifications as notif_tasks
    from app.tasks import viewing_notifications as vn

    monkeypatch.setattr(vn, "SessionLocal", lambda: _NoClose(db_session))
    monkeypatch.setattr(notif_tasks, "_deliver", lambda *a, **k: None)

    partner_user, mediator = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, mediator)
    start = datetime.now(timezone.utc) + timedelta(days=5)
    r = client.post(
        "/api/viewings",
        json={"property_id": prop.id, "requested_start_at": start.isoformat(), "requested_end_at": (start + timedelta(hours=1)).isoformat()},
        headers=_h(customer),
    )
    assert r.status_code == 201, r.text
    vid = str(r.json()["id"])

    def count():
        return db_session.query(Notification).filter(Notification.user_id == partner_user.id, Notification.entity_id == int(vid)).count()

    before = count()
    vn.create_viewing_notification.run("viewing.requested", vid, {}, None, event_id="91001")
    vn.create_viewing_notification.run("viewing.requested", vid, {}, None, event_id="91001")  # retry
    assert count() == before + 1, "a retried event must not duplicate"
    vn.create_viewing_notification.run("viewing.requested", vid, {}, None, event_id="91002")  # a new event
    assert count() == before + 2, "a new event on the same record must still notify"


# ── 3. Payments ──────────────────────────────────────────────────────────────


def _no_sub_partner(db):
    u = _user(db)
    m = Mediator(user_id=u.id, license_number="LIC-X", phone="0500000002", subscription_status="pending_payment", approval_status="approved")
    db.add(m)
    db.flush()
    return u, m


def test_production_without_real_payments_refuses_paid_activation(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "ENV", "production")
    monkeypatch.setattr(settings, "USE_REAL_PAYMENTS", False)
    u, m = _no_sub_partner(db_session)
    assert client.post("/api/mediators/me/subscribe", headers=_h(u)).status_code == 503
    assert client.post("/api/mediators/me/renew", headers=_h(u)).status_code == 503
    db_session.refresh(m)
    assert m.subscription_status == "pending_payment"
    customer = _user(db_session)
    assert client.post("/api/subscriptions/me/subscribe", headers=_h(customer)).status_code == 503
    db_session.refresh(customer)
    assert customer.subscription_status != "active"


def test_real_payments_without_webhook_secret_fail_closed(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "ENV", "production")
    monkeypatch.setattr(settings, "USE_REAL_PAYMENTS", True)
    monkeypatch.setattr(settings, "MOYASAR_SECRET_KEY", "sk_test_dummy")
    monkeypatch.setattr(settings, "MOYASAR_WEBHOOK_SECRET", None)
    u, _ = _no_sub_partner(db_session)
    assert client.post("/api/mediators/me/subscribe", headers=_h(u)).status_code == 503


def test_development_mock_still_works(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "ENV", "development")
    monkeypatch.setattr(settings, "USE_REAL_PAYMENTS", False)
    u, m = _no_sub_partner(db_session)
    r = client.post("/api/mediators/me/subscribe", headers=_h(u))
    assert r.status_code == 200 and r.json()["status"] == "active"


def _signed(body: dict, secret="whsec_test") -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    sig = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"x-moyasar-signature": sig, "content-type": "application/json"}


def test_webhook_rejected_without_configured_secret(client, monkeypatch):
    monkeypatch.setattr(settings, "MOYASAR_WEBHOOK_SECRET", None)
    r = client.post("/api/payments/webhook/moyasar", content=b"{}", headers={"content-type": "application/json"})
    assert r.status_code == 503


def test_webhook_requires_valid_signature(client, monkeypatch):
    monkeypatch.setattr(settings, "MOYASAR_WEBHOOK_SECRET", "whsec_test")
    assert client.post("/api/payments/webhook/moyasar", content=b"{}").status_code == 400
    assert client.post("/api/payments/webhook/moyasar", content=b"{}", headers={"x-moyasar-signature": "bad"}).status_code == 400


def test_forged_metadata_webhook_cannot_activate(client, db_session, monkeypatch):
    """Even correctly signed, a payment.paid for a payment Maskan never created
    must not activate anyone (previously metadata alone was enough)."""
    monkeypatch.setattr(settings, "MOYASAR_WEBHOOK_SECRET", "whsec_test")
    _, m = _no_sub_partner(db_session)
    raw, headers = _signed({"type": "payment.paid", "data": {"id": "pay_forged", "amount": 9900, "currency": "SAR",
                                                             "metadata": {"payment_type": "subscription", "mediator_id": str(m.id)}}})
    assert client.post("/api/payments/webhook/moyasar", content=raw, headers=headers).status_code == 200
    db_session.refresh(m)
    assert m.subscription_status == "pending_payment"


def test_webhook_activates_only_matching_pending_payment(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "MOYASAR_WEBHOOK_SECRET", "whsec_test")
    _, m = _no_sub_partner(db_session)
    other_user, other = _no_sub_partner(db_session)
    pay = Payment(mediator_id=m.id, payment_type="subscription", amount=99.0, currency="SAR", status="pending",
                  gateway="moyasar", gateway_payment_id=f"pay_{uuid.uuid4().hex[:8]}")
    db_session.add(pay)
    db_session.flush()

    # wrong amount → ignored
    raw, headers = _signed({"type": "payment.paid", "data": {"id": pay.gateway_payment_id, "amount": 100, "currency": "SAR"}})
    client.post("/api/payments/webhook/moyasar", content=raw, headers=headers)
    db_session.refresh(m)
    assert m.subscription_status == "pending_payment"

    # correct amount, metadata pointing at ANOTHER partner → the payment's own partner is activated
    raw, headers = _signed({"type": "payment.paid", "data": {"id": pay.gateway_payment_id, "amount": 9900, "currency": "SAR",
                                                             "metadata": {"payment_type": "subscription", "mediator_id": str(other.id)}}})
    assert client.post("/api/payments/webhook/moyasar", content=raw, headers=headers).status_code == 200
    db_session.refresh(m)
    db_session.refresh(other)
    db_session.refresh(pay)
    assert m.subscription_status == "active" and pay.status == "paid"
    assert other.subscription_status == "pending_payment"

    # replay → already processed, expiry unchanged
    expires = m.subscription_expires_at
    assert client.post("/api/payments/webhook/moyasar", content=raw, headers=headers).json()["status"] == "already_processed"
    db_session.refresh(m)
    assert m.subscription_expires_at == expires


# ── 4. Non-public listing visibility ─────────────────────────────────────────

PER_ID_GETS = ["", "/images", "/trust", "/similar", "/duplicate-check"]


@pytest.mark.parametrize("status", ["Pending Approval", "Rejected", "Draft", "Suspended", "Unpublished"])
def test_non_public_listing_hidden_by_direct_id(client, db_session, status):
    owner_user, mediator = _partner(db_session)
    other_partner, _ = _partner(db_session)
    customer = _user(db_session)
    admin = _user(db_session, is_admin=True)
    prop = _listing(db_session, mediator, status=status)
    for suffix in PER_ID_GETS:
        path = f"/api/properties/{prop.id}{suffix}"
        assert client.get(path).status_code == 404, path
        assert client.get(path, headers=_h(customer)).status_code == 404, path
        assert client.get(path, headers=_h(other_partner)).status_code == 404, path
        assert client.get(path, headers=_h(owner_user)).status_code == 200, path
        assert client.get(path, headers=_h(admin)).status_code == 200, path


def test_engaged_customer_keeps_access_but_not_to_hidden(client, db_session):
    _, mediator = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, mediator)
    start = datetime.now(timezone.utc) + timedelta(days=4)
    r = client.post("/api/viewings", json={"property_id": prop.id, "requested_start_at": start.isoformat(),
                                           "requested_end_at": (start + timedelta(hours=1)).isoformat()}, headers=_h(customer))
    assert r.status_code == 201, r.text
    prop.status = "Pending Approval"
    db_session.flush()
    assert client.get(f"/api/properties/{prop.id}", headers=_h(customer)).status_code == 200
    prop.status = "Hidden"
    db_session.flush()
    assert client.get(f"/api/properties/{prop.id}", headers=_h(customer)).status_code == 404


def test_public_listing_still_public(client, db_session):
    _, mediator = _partner(db_session)
    prop = _listing(db_session, mediator)
    for suffix in PER_ID_GETS:
        assert client.get(f"/api/properties/{prop.id}{suffix}").status_code == 200, suffix


# ── 5. Views ─────────────────────────────────────────────────────────────────


def test_owner_and_admin_views_do_not_count(client, db_session):
    owner_user, mediator = _partner(db_session)
    admin = _user(db_session, is_admin=True)
    customer = _user(db_session)
    prop = _listing(db_session, mediator, views_count=0)
    client.get(f"/api/properties/{prop.id}", headers=_h(owner_user))
    client.get(f"/api/properties/{prop.id}", headers=_h(admin))
    db_session.refresh(prop)
    assert prop.views_count == 0
    client.get(f"/api/properties/{prop.id}", headers=_h(customer))
    client.get(f"/api/properties/{prop.id}")
    db_session.refresh(prop)
    assert prop.views_count == 2


# ── 6. Lifecycle ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("start_status", ["Pending Approval", "Rejected", "Published"])
def test_partner_can_edit_and_resubmit(client, db_session, start_status):
    u, m = _partner(db_session)
    prop = _listing(db_session, m, status=start_status)
    r = client.patch(f"/api/properties/partner/{prop.id}", json={"title": "Edited"}, headers=_h(u))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pending Approval" and r.json()["title"] == "Edited"


@pytest.mark.parametrize("locked", ["Suspended", "Hidden"])
def test_admin_locked_listings_stay_locked(client, db_session, locked):
    u, m = _partner(db_session)
    prop = _listing(db_session, m, status=locked)
    assert client.patch(f"/api/properties/partner/{prop.id}", json={"title": "x"}, headers=_h(u)).status_code == 409
    assert client.post(f"/api/properties/partner/{prop.id}/unpublish", headers=_h(u)).status_code == 409


def test_unpublish_resubmit_archive_flow(client, db_session):
    u, m = _partner(db_session)
    prop = _listing(db_session, m)
    r = client.post(f"/api/properties/partner/{prop.id}/unpublish", headers=_h(u))
    assert r.status_code == 200 and r.json()["status"] == "Unpublished"
    assert all(p["id"] != prop.id for p in client.get("/api/properties/?limit=500").json())
    assert client.get(f"/api/properties/{prop.id}").status_code == 404
    # editing an unpublished listing keeps it unpublished
    assert client.patch(f"/api/properties/partner/{prop.id}", json={"title": "Still off"}, headers=_h(u)).json()["status"] == "Unpublished"
    r = client.post(f"/api/properties/partner/{prop.id}/resubmit", headers=_h(u))
    assert r.status_code == 200 and r.json()["status"] == "Pending Approval"
    assert client.delete(f"/api/properties/partner/{prop.id}", headers=_h(u)).status_code == 204
    db_session.refresh(prop)
    assert prop.status == "Archived"  # row preserved
    mine = client.get("/api/properties/partner/mine", headers=_h(u)).json()
    assert all(p["id"] != prop.id for p in mine)
    assert client.post(f"/api/properties/partner/{prop.id}/resubmit", headers=_h(u)).status_code == 404


def test_archive_refused_with_active_offer(client, db_session):
    u, m = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, m, listing_type="sale", monthly_rent=None, sale_price=900000.0)
    r = client.post(f"/api/properties/{prop.id}/negotiations", json={"amount": 850000}, headers=_h(customer))
    assert r.status_code == 201, r.text
    resp = client.delete(f"/api/properties/partner/{prop.id}", headers=_h(u))
    assert resp.status_code == 409 and "offer" in resp.json()["detail"]
    db_session.refresh(prop)
    assert prop.status == "Published"


def test_lifecycle_ownership_enforced(client, db_session):
    _, m = _partner(db_session)
    intruder, _ = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, m)
    for method, path in [("post", "unpublish"), ("post", "resubmit"), ("delete", "")]:
        url = f"/api/properties/partner/{prop.id}" + (f"/{path}" if path else "")
        assert getattr(client, method)(url, headers=_h(intruder)).status_code == 403
        assert getattr(client, method)(url, headers=_h(customer)).status_code == 403
        assert getattr(client, method)(url).status_code == 401


# ── 7. Photo uploads ─────────────────────────────────────────────────────────


def test_upload_validation_and_signed_media(client, db_session, upload_root):
    u, m = _partner(db_session)
    intruder, _ = _partner(db_session)
    prop = _listing(db_session, m, status="Pending Approval")
    url = f"/api/properties/partner/{prop.id}/images/upload"

    assert client.post(url, files={"file": ("x.png", b"not an image", "image/png")}, headers=_h(u)).status_code == 415
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (listing_media.MAX_LISTING_IMAGE_BYTES + 1)
    assert client.post(url, files={"file": ("big.png", big, "image/png")}, headers=_h(u)).status_code == 413
    assert client.post(url, files={"file": ("x.png", PNG, "image/png")}, headers=_h(intruder)).status_code == 403
    assert client.post(url, files={"file": ("x.png", PNG, "image/png")}).status_code == 401

    r = client.post(url, files={"file": ("photo.jpg", JPEG, "image/jpeg")}, headers=_h(u))
    assert r.status_code == 201, r.text
    signed = r.json()["url"]
    assert "/api/media/listing-images/" in signed and "sig=" in signed  # non-public → signed
    key = re.search(r"listing-images/([0-9a-f]{32}\.jpg)", signed).group(1)
    assert (upload_root / str(prop.id) / key).is_file()

    media_path = signed[signed.index("/api/media/"):]
    assert client.get(media_path).status_code == 200  # valid signature
    assert client.get(f"/api/media/listing-images/{key}").status_code == 404  # unsigned, non-public
    assert client.get(media_path.replace("sig=", "sig=0")).status_code == 404  # tampered

    prop.status = "Published"
    db_session.flush()
    assert client.get(f"/api/media/listing-images/{key}").status_code == 200  # public listing → public photo
    listed = client.get(f"/api/properties/{prop.id}").json()["images"][0]["url"]
    assert "sig=" not in listed and listed.endswith(key)


def test_photo_change_on_published_listing_reenters_review(client, db_session, upload_root):
    u, m = _partner(db_session)
    prop = _listing(db_session, m)
    r = client.post(f"/api/properties/partner/{prop.id}/images/upload", files={"file": ("p.png", PNG, "image/png")}, headers=_h(u))
    assert r.status_code == 201
    db_session.refresh(prop)
    assert prop.status == "Pending Approval"


def test_cannot_attach_another_listings_media_path(client, db_session):
    u, m = _partner(db_session)
    prop = _listing(db_session, m, status="Pending Approval")
    for bad in ["/api/media/listing-images/" + "a" * 32 + ".jpg",
                "http://localhost:8000/api/media/listing-images/" + "a" * 32 + ".jpg?exp=1&sig=x",
                "javascript:alert(1)"]:
        r = client.post(f"/api/properties/partner/{prop.id}/images", json={"url": bad}, headers=_h(u))
        assert r.status_code == 422, bad
    ok = client.post(f"/api/properties/partner/{prop.id}/images", json={"url": "https://example.com/a.jpg"}, headers=_h(u))
    assert ok.status_code == 201
