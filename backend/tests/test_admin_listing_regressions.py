"""Regression tests for the Admin Portal listing regressions (post Partner Portal).

High 1 — admin edits destroyed uploaded photos: the admin editor re-added the
         signed URL as an "external" image and deleted the real upload. The
         server now refuses Maskan media URLs as external images (from admin
         and partner), and a photo survives admin edits in every status.
High 2 — admin DELETE hard-deleted the property, cascading away transactions,
         offers and viewings. It now archives (row + history kept) and is
         refused while a deal is in progress.
Plus: shared-file protection, analytics excluding archived listings, the
orphan-photo cleanup script, and a static guard against hard deletes.
"""
import os
import pathlib
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core import rate_limit
from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import PropertyNegotiation
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PropertyViewing
from app.models.user import User
from app.services import listing_media

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    monkeypatch.setattr(rate_limit, "check_rate_limit", lambda *a, limit, **k: rate_limit.RateLimitResult(True, limit, limit, 0))


@pytest.fixture()
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setattr(listing_media, "LISTING_UPLOAD_ROOT", tmp_path)
    return tmp_path


def _user(db, **kw):
    u = User(email=f"alr-{uuid.uuid4().hex[:10]}@example.com", hashed_password="x", **kw)
    db.add(u)
    db.flush()
    return u


def _partner(db):
    u = _user(db)
    m = Mediator(user_id=u.id, license_number=f"L-{uuid.uuid4().hex[:6]}", phone="0500000001",
                 subscription_status="active", approval_status="approved")
    db.add(m)
    db.flush()
    return u, m


def _listing(db, m, status="Published", **kw):
    d = dict(title=f"ALR {uuid.uuid4().hex[:6]}", area="Al Yasmin", city="Riyadh", listing_type="rent",
             monthly_rent=5000.0, status=status, mediator_id=m.id, contact_phone="0500000001")
    d.update(kw)
    p = Property(**d)
    db.add(p)
    db.flush()
    return p


H = lambda u: {"Authorization": f"Bearer {create_access_token(u.id)}"}


def _upload(client, partner_user, pid):
    r = client.post(f"/api/properties/partner/{pid}/images/upload", files={"file": ("p.png", PNG, "image/png")}, headers=H(partner_user))
    assert r.status_code == 201, r.text
    return r.json()


# ── High 1: photos survive admin edits ───────────────────────────────────────


@pytest.mark.parametrize("status", ["Pending Approval", "Rejected", "Published", "Unpublished"])
def test_admin_edit_preserves_uploaded_photo(client, db_session, upload_root, status):
    pu, m = _partner(db_session)
    admin = _user(db_session, is_admin=True)
    prop = _listing(db_session, m, status="Pending Approval")
    img = _upload(client, pu, prop.id)
    prop.status = status
    db_session.flush()
    r = client.patch(f"/api/properties/{prop.id}", json={"monthly_rent": 5500, "title": "Edited by admin"}, headers=H(admin))
    assert r.status_code == 200, r.text
    images = r.json()["images"]
    assert [i["id"] for i in images] == [img["id"]]
    served = images[0]["url"]
    assert client.get(served[served.index("/api/"):]).status_code == 200


@pytest.mark.parametrize("bad", [
    "/api/media/listing-images/" + "a" * 32 + ".png",
    "http://localhost:8000/api/media/listing-images/" + "a" * 32 + ".png?exp=9999999999&sig=abc",
    "https://maskanai.com/api/media/listing-images/" + "b" * 32 + ".jpg",
])
def test_admin_cannot_attach_maskan_media_url_as_external_image(client, db_session, bad):
    _, m = _partner(db_session)
    admin = _user(db_session, is_admin=True)
    prop = _listing(db_session, m)
    assert client.post(f"/api/properties/{prop.id}/images", json={"url": bad}, headers=H(admin)).status_code == 422
    assert client.post(f"/api/properties/{prop.id}/images", json={"url": "https://example.com/a.jpg"}, headers=H(admin)).status_code == 201


def test_shared_file_is_not_deleted_while_referenced(db_session, upload_root):
    _, m = _partner(db_session)
    p1, p2 = _listing(db_session, m), _listing(db_session, m)
    key = uuid.uuid4().hex + ".png"
    (upload_root / str(p1.id)).mkdir()
    f = upload_root / str(p1.id) / key
    f.write_bytes(PNG)
    db_session.add(ListingImage(property_id=p2.id, url=listing_media.MEDIA_PREFIX + key, display_order=0))
    db_session.flush()
    listing_media.delete_listing_image_file(db_session, p1.id, listing_media.MEDIA_PREFIX + key)
    assert f.is_file(), "file referenced by another record must be kept"


# ── High 2: admin delete archives, never destroys history ───────────────────


def _deal_property(client, db_session):
    pu, m = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, m, listing_type="sale", monthly_rent=None, sale_price=900000.0)
    r = client.post(f"/api/properties/{prop.id}/negotiations", json={"amount": 850000}, headers=H(customer))
    assert r.status_code == 201, r.text
    return pu, m, customer, prop, r.json()["id"]


def test_admin_delete_refused_while_offer_active(client, db_session):
    admin = _user(db_session, is_admin=True)
    _, _, _, prop, nid = _deal_property(client, db_session)
    r = client.delete(f"/api/properties/{prop.id}", headers=H(admin))
    assert r.status_code == 409 and "offer" in r.json()["detail"]
    db_session.refresh(prop)
    assert prop.status == "Published"
    assert db_session.get(PropertyNegotiation, nid) is not None
    # PATCH status=Archived can't bypass the guard
    assert client.patch(f"/api/properties/{prop.id}", json={"status": "Archived"}, headers=H(admin)).status_code == 409


def test_admin_delete_refused_with_active_transaction_and_history_kept(client, db_session):
    admin = _user(db_session, is_admin=True)
    pu, _, customer, prop, nid = _deal_property(client, db_session)
    assert client.post(f"/api/partner/negotiations/{nid}/accept", json={}, headers=H(pu)).status_code == 200
    tx = db_session.query(PropertyTransaction).filter_by(property_id=prop.id).one()
    assert client.delete(f"/api/properties/{prop.id}", headers=H(admin)).status_code == 409
    assert db_session.get(PropertyTransaction, tx.id) is not None
    assert client.get(f"/api/transactions/{tx.id}", headers=H(customer)).status_code == 200


def test_admin_delete_archives_and_preserves_finished_history(client, db_session):
    admin = _user(db_session, is_admin=True)
    _, m = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, m)
    start = datetime.now(timezone.utc) + timedelta(days=3)
    v = client.post("/api/viewings", json={"property_id": prop.id, "requested_start_at": start.isoformat(),
                                           "requested_end_at": (start + timedelta(hours=1)).isoformat()}, headers=H(customer))
    assert v.status_code == 201
    viewing = db_session.get(PropertyViewing, v.json()["id"])
    viewing.status = "completed"  # finished history, not "in progress"
    db_session.flush()
    r = client.delete(f"/api/properties/{prop.id}", headers=H(admin))
    assert r.status_code == 204
    db_session.refresh(prop)
    assert prop.status == "Archived"
    assert db_session.get(Property, prop.id) is not None
    assert db_session.get(PropertyViewing, viewing.id) is not None
    assert client.get(f"/api/properties/{prop.id}").status_code == 404           # gone from the portal
    assert all(p["id"] != prop.id for p in client.get("/api/properties/?limit=500").json())
    assert client.get(f"/api/viewings/{viewing.id}", headers=H(customer)).status_code == 200  # history visible
    assert client.delete(f"/api/properties/{prop.id}", headers=H(admin)).status_code == 204   # idempotent


def test_admin_delete_requires_admin(client, db_session):
    pu, m = _partner(db_session)
    customer = _user(db_session)
    prop = _listing(db_session, m)
    assert client.delete(f"/api/properties/{prop.id}").status_code == 401
    assert client.delete(f"/api/properties/{prop.id}", headers=H(customer)).status_code == 403
    assert client.delete(f"/api/properties/{prop.id}", headers=H(pu)).status_code == 403


def test_no_route_hard_deletes_a_property():
    """Static guard: properties.id cascades into transactions, offers,
    viewings, reports and bookings — no API code may delete a Property row."""
    offenders = []
    for path in (BACKEND / "app").rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        for m in re.finditer(r"db\.delete\(\s*(\w+)\s*\)", src):
            var = m.group(1)
            if re.search(rf"{var}\s*=\s*(db\.get\(Property|db\.scalar\(select\(Property)", src) or var in {"prop", "property_obj", "property"}:
                offenders.append(f"{path.name}: db.delete({var})")
    assert not offenders, offenders


# ── Data correctness ─────────────────────────────────────────────────────────


def test_analytics_excludes_archived_listings(client, db_session):
    admin = _user(db_session, is_admin=True)
    before = client.get("/api/analytics/summary", headers=H(admin)).json()
    _, m = _partner(db_session)
    _listing(db_session, m, status="Archived")
    after = client.get("/api/analytics/summary", headers=H(admin)).json()
    total = lambda d: next(k["value"] for k in d["kpis"] if k["label"] == "Total properties")
    assert total(after) == total(before)
    inv = lambda d: sum(c["published"] + c["pending"] + c["inactive"] for c in d["inventory"])
    assert inv(after) == inv(before)


def test_orphan_cleanup_script(tmp_path, db_session):
    """Dry run deletes nothing; --delete removes only old, unreferenced,
    correctly-named files. Runs the real script against a temp upload root."""
    root = tmp_path / "listings"
    (root / "1").mkdir(parents=True)
    old = time.time() - 48 * 3600
    orphan = root / "1" / (uuid.uuid4().hex + ".png")
    young = root / "1" / (uuid.uuid4().hex + ".png")
    other = root / "1" / "notes.txt"
    for f in (orphan, young, other):
        f.write_bytes(PNG)
    os.utime(orphan, (old, old))
    os.utime(other, (old, old))
    code = (
        "import sys, pathlib\n"
        "from app.services import listing_media\n"
        f"listing_media.LISTING_UPLOAD_ROOT = pathlib.Path(r'{root}')\n"
        "import cleanup_orphan_listing_photos as c\n"
        "sys.argv = ['x'] + sys.argv[1:]\n"
        "raise SystemExit(c.main())\n"
    )
    dry = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True, timeout=120)
    assert dry.returncode == 0, dry.stderr[-1500:]
    assert "dry run" in dry.stdout and orphan.exists()
    real = subprocess.run([sys.executable, "-c", code, "--delete"], cwd=BACKEND, capture_output=True, text=True, timeout=120)
    assert real.returncode == 0, real.stderr[-1500:]
    assert not orphan.exists(), real.stdout
    assert young.exists() and other.exists()
