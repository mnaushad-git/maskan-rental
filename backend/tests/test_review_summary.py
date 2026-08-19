"""Review Summary (Prompt 4 — Property Verification & Trust Center, spec
section 12) — service-level grounding/fallback tests for
`app.services.review_summary.summarize_reviews` (mirrors
test_partner_listing_ai.py's split from its HTTP-level sibling), plus a few
HTTP-level tests for `GET /mediators/{id}/review-summary` (minimum-count
gating end-to-end, approved-only visibility, 404).
"""
import uuid
from datetime import datetime, timezone

from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.review import Review
from app.models.user import User
from app.services import review_summary


def _review(rating: int, comment: str | None, review_id: int = 1) -> Review:
    r = Review(mediator_id=1, user_id=1, rating=rating, comment=comment, status="approved")
    r.id = review_id
    r.created_at = datetime.now(timezone.utc)
    return r


def _reviews_with_comments(n: int, comment: str = "Great service, very responsive.") -> list[Review]:
    return [_review(5, comment, review_id=i) for i in range(n)]


# ── Minimum-count gating ─────────────────────────────────────────────────────

def test_below_minimum_review_count_uses_deterministic_fallback_without_calling_gateway(monkeypatch):
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("run_chat should not be called below the minimum review count")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY - 1)
    result = review_summary.summarize_reviews(reviews, avg_rating=5.0, review_count=len(reviews), language="en")

    assert result.generated_by == "fallback"
    assert not called["run_chat"]
    assert result.positive_themes == []
    assert result.considerations == []
    assert result.avg_rating == 5.0
    assert result.review_count == len(reviews)
    assert result.note


def test_at_or_above_minimum_with_comments_calls_ai(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(
            reply='{"positive_themes": ["Responsive communication"], "considerations": []}',
            input_tokens=10, output_tokens=10,
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    result = review_summary.summarize_reviews(reviews, avg_rating=4.8, review_count=len(reviews), language="en")

    assert result.generated_by == "ai"
    assert result.positive_themes == ["Responsive communication"]
    assert result.review_count == len(reviews)
    assert result.avg_rating == 4.8


def test_enough_reviews_but_no_comment_text_falls_back(monkeypatch):
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("run_chat should not be called when no review has comment text")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    # Enough reviews numerically, but none carry any written comment.
    reviews = [_review(5, None, review_id=i) for i in range(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)]
    result = review_summary.summarize_reviews(reviews, avg_rating=5.0, review_count=len(reviews), language="en")

    assert result.generated_by == "fallback"
    assert not called["run_chat"]


# ── Grounding ─────────────────────────────────────────────────────────────

def test_grounding_prompt_only_contains_supplied_review_text(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(
            reply='{"positive_themes": ["Accurate listing photos"], "considerations": ["Slow to reply on weekends"]}',
            input_tokens=10, output_tokens=10,
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    reviews = [
        _review(5, "The photos matched exactly what we saw in person.", review_id=1),
        _review(4, "Great agent, though slow to reply on weekends.", review_id=2),
        _review(5, "Very professional and accurate listing photos.", review_id=3),
        _review(3, "Decent experience overall.", review_id=4),
        _review(4, "Would recommend, communicative throughout.", review_id=5),
    ]
    result = review_summary.summarize_reviews(reviews, avg_rating=4.2, review_count=len(reviews), language="en")

    assert result.generated_by == "ai"
    content = captured["content"]
    # Every supplied review comment must be present in the prompt.
    for r in reviews:
        assert r.comment in content
    # No fabricated topic (e.g. "price", "verification") the reviews never mention.
    assert "verified" not in content.lower()
    assert "government" not in content.lower()


def test_grounding_only_includes_approved_style_reviews_passed_in(monkeypatch):
    """summarize_reviews trusts its caller to have pre-filtered to approved
    reviews (the route does this) — verifies that whatever list is passed is
    exactly and only what reaches the prompt, nothing added or dropped
    except blank-comment rows."""
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply='{"positive_themes": ["Good"], "considerations": []}', input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    included = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY, comment="Included review text.")
    excluded_blank = _review(2, None, review_id=999)  # blank comment, should be skipped even though "passed in"

    review_summary.summarize_reviews(included + [excluded_blank], avg_rating=4.0, review_count=len(included) + 1, language="en")

    content = captured["content"]
    assert content.count("Included review text.") == len(included)


# ── Fallback on AI failure ───────────────────────────────────────────────────

def test_fallback_when_gateway_raises(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _raise)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    result = review_summary.summarize_reviews(reviews, avg_rating=4.5, review_count=len(reviews), language="en")

    assert result.generated_by == "fallback"
    assert result.positive_themes == []
    assert result.avg_rating == 4.5
    assert result.review_count == len(reviews)


def test_fallback_when_reply_is_unparseable(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="not json", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    result = review_summary.summarize_reviews(reviews, avg_rating=4.5, review_count=len(reviews), language="en")

    assert result.generated_by == "fallback"


def test_fallback_when_ai_returns_no_usable_themes(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply='{"positive_themes": [], "considerations": []}', input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    result = review_summary.summarize_reviews(reviews, avg_rating=4.5, review_count=len(reviews), language="en")

    assert result.generated_by == "fallback"


def test_fallback_when_no_api_key(monkeypatch):
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("run_chat should not be called with no API key")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    result = review_summary.summarize_reviews(reviews, avg_rating=4.5, review_count=len(reviews), language="en")

    assert result.generated_by == "fallback"
    assert not called["run_chat"]


def test_arabic_language_passed_through(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply='{"positive_themes": ["تواصل جيد"], "considerations": []}', input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    result = review_summary.summarize_reviews(reviews, avg_rating=4.5, review_count=len(reviews), language="ar")

    assert result.generated_by == "ai"
    assert "Language: Arabic" in captured["content"]


def test_never_modifies_original_review_rows(monkeypatch):
    """The service only reads comment/rating — it must never mutate the
    Review objects passed to it (no db writes, no attribute changes)."""
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply='{"positive_themes": ["Good"], "considerations": []}', input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    reviews = _reviews_with_comments(review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY)
    snapshot = [(r.rating, r.comment, r.status) for r in reviews]

    review_summary.summarize_reviews(reviews, avg_rating=5.0, review_count=len(reviews), language="en")

    assert [(r.rating, r.comment, r.status) for r in reviews] == snapshot


# ── HTTP endpoint ─────────────────────────────────────────────────────────

def _city() -> str:
    return f"ReviewSummaryCity-{uuid.uuid4().hex[:8]}"


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"rs-user-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_mediator(db, **overrides) -> Mediator:
    user = _make_user(db)
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001", subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    return mediator


def test_review_summary_endpoint_fallback_below_minimum(client, db_session):
    mediator = _make_mediator(db_session)
    reviewer = _make_user(db_session)
    db_session.add(Review(mediator_id=mediator.id, user_id=reviewer.id, rating=5, comment="Nice.", status="approved"))
    db_session.commit()

    resp = client.get(f"/api/v1/mediators/{mediator.id}/review-summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert body["review_count"] == 1
    assert body["positive_themes"] == []


def test_review_summary_endpoint_excludes_pending_and_rejected_reviews(client, db_session):
    mediator = _make_mediator(db_session)
    for status in ("pending", "rejected"):
        reviewer = _make_user(db_session)
        db_session.add(Review(mediator_id=mediator.id, user_id=reviewer.id, rating=1, comment="Bad.", status=status))
    db_session.commit()

    resp = client.get(f"/api/v1/mediators/{mediator.id}/review-summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["review_count"] == 0
    assert body["avg_rating"] is None


def test_review_summary_endpoint_404_for_unknown_mediator(client, db_session):
    resp = client.get("/api/v1/mediators/999999999/review-summary")
    assert resp.status_code == 404
