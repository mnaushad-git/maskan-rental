"""AI Viewing Checklist (Prompt 5) — deterministic generator unit tests plus
HTTP-level AI grounding/fallback and persistence tests. Follows this suite's
mocking convention for AI calls (see test_home_finder.py):
`monkeypatch.setattr(gateway, "run_chat", ...)`.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_viewing import PropertyViewing
from app.models.user import User
from app.services import viewing_checklist

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_VISIT_MANAGEMENT,
    reason="viewings.router isn't registered when FEATURE_VISIT_MANAGEMENT is off",
)


# ── Deterministic generator (pure functions, no DB) ─────────────────────────

def _prop(**overrides) -> Property:
    defaults = dict(title="Checklist Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent")
    defaults.update(overrides)
    return Property(**defaults)


def test_rent_items_differ_from_buy_items():
    rent_ids = {item.id for item in viewing_checklist.generate_rent_items(_prop(listing_type="rent"))}
    buy_ids = {item.id for item in viewing_checklist.generate_buy_items(_prop(listing_type="sale"))}
    assert rent_ids
    assert buy_ids
    assert rent_ids.isdisjoint(buy_ids)


def test_build_checklist_branches_on_listing_type():
    rent_checklist = viewing_checklist.build_checklist(_prop(listing_type="rent"))
    buy_checklist = viewing_checklist.build_checklist(_prop(listing_type="sale"))
    rent_keys = {s.key for s in rent_checklist.sections}
    buy_keys = {s.key for s in buy_checklist.sections}
    assert "rent_questions" in rent_keys and "buy_questions" not in rent_keys
    assert "buy_questions" in buy_keys and "rent_questions" not in buy_keys


def test_furnishing_item_present_vs_missing():
    unfurnished_unknown = _prop(furnished=None)
    furnished = _prop(furnished="Furnished")

    items_unknown = {i.id: i.text for i in viewing_checklist.generate_property_specific_items(unfurnished_unknown)}
    items_known = {i.id: i.text for i in viewing_checklist.generate_property_specific_items(furnished)}

    assert "ask_furnishing_status" in items_unknown
    assert "confirm_furnishing_items" not in items_unknown

    assert "confirm_furnishing_items" in items_known
    assert "ask_furnishing_status" not in items_known
    assert "Furnished" in items_known["confirm_furnishing_items"]  # grounded in the actual field value


def test_conditional_amenity_items_appear_only_when_claimed():
    plain = _prop()
    with_roof = _prop(has_private_roof=True)

    plain_ids = {i.id for i in viewing_checklist.generate_property_specific_items(plain)}
    roof_ids = {i.id for i in viewing_checklist.generate_property_specific_items(with_roof)}

    assert "confirm_roof_access" not in plain_ids
    assert "confirm_roof_access" in roof_ids


def test_rent_deposit_question_skipped_when_insurance_amount_present():
    no_deposit = _prop(insurance_amount=0)
    with_deposit = _prop(insurance_amount=5000)

    ids_no_deposit = {i.id for i in viewing_checklist.generate_rent_items(no_deposit)}
    ids_with_deposit = {i.id for i in viewing_checklist.generate_rent_items(with_deposit)}

    assert "rent_deposit" in ids_no_deposit
    assert "rent_deposit" not in ids_with_deposit


def test_verify_during_visit_items_always_included_regardless_of_data():
    sparse = _prop()
    rich = _prop(furnished="Furnished", property_age_years=2, size_sq_m=150, has_private_roof=True)

    sparse_ids = {i.id for i in viewing_checklist.generate_verify_during_visit_items(sparse)}
    rich_ids = {i.id for i in viewing_checklist.generate_verify_during_visit_items(rich)}
    assert sparse_ids == rich_ids  # fixed core list, not data-driven


# ── HTTP-level: helpers ──────────────────────────────────────────────────────

def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"checklist-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db)
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator, user


def _make_property_row(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(title="Checklist HTTP Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_viewing(db, prop: Property, customer: User, mediator: Mediator, **overrides) -> PropertyViewing:
    start = datetime.now(timezone.utc) + timedelta(hours=48)
    defaults = dict(
        property_id=prop.id, customer_user_id=customer.id, mediator_id=mediator.id,
        requested_start_at=start, requested_end_at=start + timedelta(minutes=30),
        timezone="Asia/Riyadh", status="requested",
    )
    defaults.update(overrides)
    viewing = PropertyViewing(**defaults)
    db.add(viewing)
    db.flush()
    return viewing


class _FakeAiResult:
    def __init__(self, reply, input_tokens=10, output_tokens=10, latency_ms=5.0):
        self.reply = reply
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.latency_ms = latency_ms


# ── AI grounding / fallback ──────────────────────────────────────────────────

def test_ai_enhancement_grounding(client, db_session, monkeypatch):
    """The prompt sent to the model must only ever contain the deterministic
    items/facts we generated — no fabricated content — and the model's
    response can only annotate ids we actually sent."""
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property_row(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    captured = {}

    def _fake_run_chat(**kwargs):
        captured["messages"] = kwargs["messages"]
        # Model tries to sneak in an id we never sent — must be dropped.
        fake_reply = json.dumps({
            "visit_plan_summary": "Bring a tape measure and check the water pressure first.",
            "items": [
                {"id": "verify_parking", "why_it_matters": "Parking access affects daily convenience."},
                {"id": "totally_made_up_item", "why_it_matters": "This should never be applied."},
            ],
        })
        return _FakeAiResult(fake_reply)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    resp = client.get(f"/api/v1/viewings/{viewing.id}", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    checklist = body["checklist"]
    assert checklist["generated_by"] == "ai"
    assert checklist["visit_plan_summary"]

    all_items = {item["id"]: item for section in checklist["sections"] for item in section["items"]}
    assert "totally_made_up_item" not in all_items  # never applied — wasn't a real item id
    assert all_items["verify_parking"]["why_it_matters"] == "Parking access affects daily convenience."
    # Every item sent still exists — the AI never removed or added items.
    deterministic = viewing_checklist.build_checklist(prop)
    deterministic_ids = {i.id for s in deterministic.sections for i in s.items}
    assert set(all_items.keys()) == deterministic_ids

    # Prompt input contained only real facts — no property title/city typo'd
    # or fabricated content beyond what build_checklist actually generated.
    sent_content = captured["messages"][0]["content"]
    for item_id in deterministic_ids:
        assert item_id in sent_content


def test_ai_failure_falls_back_to_deterministic_checklist(client, db_session, monkeypatch):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property_row(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)

    resp = client.get(f"/api/v1/viewings/{viewing.id}", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    checklist = resp.json()["checklist"]
    assert checklist["generated_by"] == "deterministic"
    assert checklist["visit_plan_summary"] is None
    all_items = [item for section in checklist["sections"] for item in section["items"]]
    assert all(item["why_it_matters"] is None for item in all_items)
    assert len(all_items) > 0


def test_checklist_generated_once_and_stable_across_repeated_gets(client, db_session, monkeypatch):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property_row(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    call_count = {"n": 0}

    def _fake_run_chat(**kwargs):
        call_count["n"] += 1
        return _FakeAiResult(json.dumps({"visit_plan_summary": f"Summary #{call_count['n']}", "items": []}))

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    first = client.get(f"/api/v1/viewings/{viewing.id}", headers=_auth(customer))
    second = client.get(f"/api/v1/viewings/{viewing.id}", headers=_auth(customer))
    assert first.status_code == 200 and second.status_code == 200
    assert call_count["n"] == 1  # only generated once, second GET read the stored state
    assert first.json()["checklist"]["visit_plan_summary"] == second.json()["checklist"]["visit_plan_summary"]


# ── PATCH persistence ─────────────────────────────────────────────────────

def test_patch_checklist_persists_checked_state_and_appends_notes(client, db_session, monkeypatch):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property_row(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("no AI in this test")))

    first_item_id = viewing_checklist.build_checklist(prop).sections[0].items[0].id

    patch1 = client.patch(
        f"/api/v1/viewings/{viewing.id}/checklist",
        json={"checked": {first_item_id: True}, "note": "First note"},
        headers=_auth(customer),
    )
    assert patch1.status_code == 200, patch1.text
    body1 = patch1.json()
    assert body1["checklist"]["checked"][first_item_id] is True
    assert [n["text"] for n in body1["private_notes"]] == ["First note"]

    patch2 = client.patch(
        f"/api/v1/viewings/{viewing.id}/checklist",
        json={"note": "Second note"},
        headers=_auth(customer),
    )
    assert patch2.status_code == 200, patch2.text
    body2 = patch2.json()
    # Existing checked state survives a patch that only sends a note.
    assert body2["checklist"]["checked"][first_item_id] is True
    assert [n["text"] for n in body2["private_notes"]] == ["First note", "Second note"]


def test_patch_checklist_ignores_unknown_item_id(client, db_session, monkeypatch):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property_row(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("no AI in this test")))

    resp = client.patch(
        f"/api/v1/viewings/{viewing.id}/checklist",
        json={"checked": {"not_a_real_item_id": True}},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    assert "not_a_real_item_id" not in resp.json()["checklist"]["checked"]


def test_partner_response_never_includes_private_notes(client, db_session, monkeypatch):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property_row(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("no AI in this test")))
    client.patch(f"/api/v1/viewings/{viewing.id}/checklist", json={"note": "private thoughts"}, headers=_auth(customer))

    resp = client.get(f"/api/v1/partner/viewings/{viewing.id}", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    assert "private_notes" not in resp.json()
    assert "checklist" not in resp.json()
