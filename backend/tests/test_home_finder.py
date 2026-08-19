"""AI Home Finder: deterministic scoring (dimension fits, missing-data
weight renormalization, empty-result suggestions with real recomputed
counts), AI extraction/refinement sanitization (never trusting raw model
output — Section 3), and the HTTP surface (interpret/refine/search/explain/
history, feature-flag gate).
"""
import json

import pytest

from app.core.ai import gateway
from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.schemas.home_finder import HomeFinderCriteria
from app.services import home_finder_ai, home_finder_scoring


def _signup(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, bathrooms=2, status="Published", property_type="Apartment",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _make_area_intel(db, **overrides) -> AreaIntelligence:
    defaults = dict(area_name="Al Yasmin", city="Riyadh", area_score=80, family_score=85, school_score=75, traffic_score=40)
    defaults.update(overrides)
    row = AreaIntelligence(**defaults)
    db.add(row)
    db.flush()
    return row


# ── Scoring dimensions ──────────────────────────────────────────────────────


def test_budget_fit_within_and_over_budget(db_session):
    prop = _make_property(db_session, listing_type="rent", monthly_rent=6000.0)  # annual = 72,000
    within = home_finder_scoring._budget_fit(HomeFinderCriteria(transaction_type="rent", max_price=75000), prop)
    assert within.score is not None and within.trade_off is None and within.reason is not None

    over = home_finder_scoring._budget_fit(HomeFinderCriteria(transaction_type="rent", max_price=60000), prop)
    assert over.trade_off is not None and over.reason is None


def test_budget_fit_unset_excludes_dimension(db_session):
    prop = _make_property(db_session)
    assert home_finder_scoring._budget_fit(HomeFinderCriteria(), prop).score is None


def test_bedrooms_fit_exact_fewer_and_far_fewer(db_session):
    prop = _make_property(db_session, bedrooms=3)
    exact = home_finder_scoring._bedrooms_fit(HomeFinderCriteria(bedrooms=3), prop)
    assert exact.score == 1.0 and exact.trade_off is None

    one_fewer = home_finder_scoring._bedrooms_fit(HomeFinderCriteria(bedrooms=4), prop)
    assert one_fewer.trade_off is not None and one_fewer.score == pytest.approx(0.55)

    far_fewer = home_finder_scoring._bedrooms_fit(HomeFinderCriteria(bedrooms=6), prop)
    assert far_fewer.trade_off is not None and far_fewer.score < one_fewer.score


def test_missing_data_dimensions_excluded_and_weight_renormalizes(db_session):
    """Only `bedrooms` is set on the criteria, and the property's district has
    no AreaIntelligence row — every other dimension must be excluded, and the
    match score must collapse to exactly the bedrooms dimension's own score
    (Section 5: "exclude that dimension and normalize remaining weights")."""
    prop = _make_property(db_session, area="Untracked District", bedrooms=3)
    criteria = HomeFinderCriteria(bedrooms=3)
    scored = home_finder_scoring.score_property(criteria, prop, area_intel={})
    assert set(scored.dimension_scores.keys()) == {"bedrooms_fit"}
    assert scored.match_score == 100  # bedrooms_fit score is 1.0, and it's the only weighted dimension


def test_required_amenities_fit_partial_match(db_session):
    prop = _make_property(db_session, has_elevator=True, has_airconditioners=False)
    dim = home_finder_scoring._required_amenities_fit(
        HomeFinderCriteria(required_amenities=["elevator", "air_conditioning"]), prop
    )
    assert 0 < dim.score < 1
    assert dim.trade_off is not None and "air conditioning" in dim.trade_off


def test_commute_fit_known_landmark_vs_unresolvable_destination(db_session):
    prop = _make_property(db_session, area="Al Yasmin", city="Riyadh")
    known = home_finder_scoring._commute_fit(HomeFinderCriteria(city="Riyadh", commute_destination="KAFD"), prop)
    assert known.score is not None

    unknown = home_finder_scoring._commute_fit(
        HomeFinderCriteria(city="Riyadh", commute_destination="Mars Colony"), prop
    )
    assert unknown.score is None  # never a guessed distance for an unrecognized destination


def test_rank_orders_results_and_picks_categories(db_session, unique_email):
    # A fake, unique city isolates this test from the real seeded inventory
    # the dev DB already carries (this suite runs against real Postgres, not
    # a throwaway test DB — see conftest.py).
    city = f"TestCity-{unique_email}"
    _make_area_intel(db_session, area_name="Al Yasmin", city=city, family_score=90)
    good = _make_property(db_session, title="Good match", area="Al Yasmin", city=city, bedrooms=3, monthly_rent=6000.0)
    _make_property(db_session, title="Weak match", area="Al Malqa", city=city, bedrooms=1, monthly_rent=15000.0)

    criteria = HomeFinderCriteria(transaction_type="rent", city=city, max_price=75000, bedrooms=3, districts=["Al Yasmin"])
    result = home_finder_scoring.rank(db_session, criteria, top_n=10)

    assert result.pool_count == 2
    assert result.top[0].property.id == good.id
    assert result.top[0].match_score >= result.top[-1].match_score

    categories = home_finder_scoring.pick_categories(result.top, criteria)
    assert categories.best_overall == good.id
    assert categories.best_family == good.id  # only property with a family_score on record


def test_empty_result_suggestions_use_real_recomputed_counts(db_session, unique_email):
    city = f"TestCity-{unique_email}"
    _make_property(db_session, title="A", area="Al Yasmin", city=city, bedrooms=3)
    _make_property(db_session, title="B", area="Al Yasmin", city=city, bedrooms=3)

    # Nothing has 4+ bedrooms, so this must be an empty (no exact match) result.
    criteria = HomeFinderCriteria(transaction_type="rent", city=city, bedrooms=4)
    result = home_finder_scoring.rank(db_session, criteria, top_n=10)
    assert result.exact_match_count == 0

    message, restrictive_reasons, suggestions = home_finder_scoring.empty_result_suggestions(db_session, criteria, result)
    assert "4+ bedrooms" in restrictive_reasons[0]
    reduce_suggestion = next(s for s in suggestions if "3+ bedrooms" in s["label"])
    assert reduce_suggestion["estimated_count"] == 2  # both seeded properties have exactly 3 bedrooms


# ── AI extraction/refinement — sanitization is the real security boundary ──


def test_sanitize_criteria_drops_unsupported_amenity_even_if_ai_misbehaves():
    """Section 3: 'AI output must NEVER directly execute arbitrary SQL or
    search parameters.' Even if the model ignores its instructions and puts
    an unsupported amenity like 'parking' directly into required_amenities,
    the sanitizer must drop it rather than let it reach the scoring engine
    silently mis-scored as a real dimension."""
    dirty = {"required_amenities": ["parking", "elevator", "not_a_real_amenity"], "transaction_type": "rent"}
    clean = home_finder_ai._sanitize_criteria(dirty)
    assert clean.required_amenities == ["elevator"]


def test_interpret_query_success(monkeypatch):
    fake_reply = json.dumps({
        "transaction_type": "rent",
        "city": "Riyadh",
        "districts": ["Al Yasmin", "Al Narjis"],
        "bedrooms": 3,
        "max_price": 75000,
        "required_amenities": ["elevator"],
        "unsupported_requests": ["parking"],
        "ai_confidence": 0.8,
        "missing_fields": [],
        "clarifying_questions": [],
    })

    class _FakeResult:
        reply = fake_reply
        input_tokens = 10
        output_tokens = 10
        latency_ms = 5.0

    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: _FakeResult())

    criteria, confidence, missing, questions, generated_by = home_finder_ai.interpret_query(
        text="3-bedroom apartment in Riyadh under 75K near KAFD, parking required",
        locale="en",
        transaction_type_hint=None,
        user_id=None,
    )
    assert generated_by == "ai"
    assert criteria.districts == ["Al Yasmin", "Al Narjis"]
    assert criteria.bedrooms == 3
    assert criteria.unsupported_requests == ["parking"]
    assert confidence == pytest.approx(0.8)


def test_interpret_query_ai_failure_falls_back_with_hint(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    criteria, confidence, missing, _questions, generated_by = home_finder_ai.interpret_query(
        text="anything", locale="en", transaction_type_hint="sale", user_id=None
    )
    assert generated_by == "fallback"
    assert criteria.transaction_type == "sale"
    assert confidence == 0.0
    assert missing == ["all"]


def test_refine_criteria_ai_failure_leaves_criteria_unchanged(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    original = HomeFinderCriteria(transaction_type="rent", max_price=75000, bedrooms=3)
    new_criteria, changes, generated_by = home_finder_ai.refine_criteria(
        criteria=original, instruction="only show below 70K", locale="en", user_id=None
    )
    assert generated_by == "fallback"
    assert new_criteria == original
    assert changes == []


def test_explain_match_ai_failure_uses_deterministic_template(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    summary, generated_by = home_finder_ai.explain_match(
        criteria=HomeFinderCriteria(),
        match_score=94,
        reasons=["Within budget", "3 bedrooms"],
        trade_offs=["28 min from KAFD"],
        user_id=None,
    )
    assert generated_by == "fallback"
    assert summary  # never empty — search results must not block on AI


# ── HTTP surface ─────────────────────────────────────────────────────────


def test_interpret_endpoint_rejects_empty_text(client):
    resp = client.post("/api/v1/ai/home-finder/interpret", json={"text": "   "})
    assert resp.status_code == 422


def test_interpret_endpoint_degrades_on_ai_failure(client, monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    resp = client.post("/api/v1/ai/home-finder/interpret", json={"text": "3 bedroom apartment in Riyadh"})
    assert resp.status_code == 200
    assert resp.json()["generated_by"] == "fallback"


def test_search_endpoint_persists_history_for_authenticated_user(client, db_session, unique_email):
    _make_property(db_session, title="Match me", area="Al Yasmin", city="Riyadh", bedrooms=3, monthly_rent=6000.0)
    token = _signup(client, unique_email)

    payload = {
        "criteria": {"transaction_type": "rent", "city": "Riyadh", "bedrooms": 3, "max_price": 75000},
        "query_text": "Family apartment near KAFD",
    }
    resp = client.post("/api/v1/ai/home-finder/search", json=payload, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pool_count"] >= 1
    assert len(body["results"]) >= 1

    history_resp = client.get("/api/v1/ai/home-finder/history", headers=_auth(token))
    assert history_resp.status_code == 200
    history = history_resp.json()
    assert any(h["query_text"] == "Family apartment near KAFD" for h in history)


def test_search_endpoint_anonymous_has_no_history_access(client, db_session):
    _make_property(db_session, area="Al Yasmin", city="Riyadh")
    resp = client.post(
        "/api/v1/ai/home-finder/search",
        json={"criteria": {"transaction_type": "rent", "city": "Riyadh"}},
    )
    assert resp.status_code == 200

    history_resp = client.get("/api/v1/ai/home-finder/history")
    assert history_resp.status_code == 401


def test_explain_endpoint_404_for_missing_property(client):
    resp = client.post(
        "/api/v1/ai/home-finder/explain",
        json={"criteria": {"transaction_type": "rent"}, "property_id": 9_999_999},
    )
    assert resp.status_code == 404


def test_feature_flag_gate(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "FEATURE_AI_HOME_FINDER", False)
    resp = client.post("/api/v1/ai/home-finder/interpret", json={"text": "anything"})
    assert resp.status_code == 503
