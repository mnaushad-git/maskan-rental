"""Partner Listing Quality — "Improve with AI" grounding + fallback
(service-level unit tests, mirroring test_property_intelligence_ai.py's
split from its HTTP-level sibling test_partner_quality_api.py). Verifies the
gateway prompt is built ONLY from the property's own already-saved fields
(never a fabricated amenity/dimension/location/price/verification/
availability claim), and that every failure mode (no API key, gateway
exception, unparseable reply) degrades to the original title/description
unchanged rather than a fabricated rewrite.
"""
from app.core.ai import gateway
from app.core.config import settings
from app.models.property import Property
from app.services import partner_listing_ai


def _property(**overrides) -> Property:
    defaults = dict(
        title="Cozy Apartment",
        area="Al Yasmin",
        city="Riyadh",
        listing_type="rent",
        description="Nice place to live.",
        bedrooms=2,
        bathrooms=1,
        size_sq_m=90,
        property_type="Apartment",
        furnished="Furnished",
        has_kitchen=True,
        has_elevator=True,
    )
    defaults.update(overrides)
    return Property(**defaults)


def test_grounding_facts_only_contain_supplied_property_fields(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(
            reply='{"title": "Bright 2BR in Al Yasmin", "description": "A comfortable, well-equipped apartment."}',
            input_tokens=10,
            output_tokens=10,
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    title, description, generated_by = partner_listing_ai.improve_listing_wording(prop, focus="both", language="en")

    assert generated_by == "ai"
    assert title == "Bright 2BR in Al Yasmin"
    assert description == "A comfortable, well-equipped apartment."

    content = captured["content"]
    # Facts that ARE supplied on the property must be present.
    assert "Al Yasmin" in content
    assert "Riyadh" in content
    assert "Bedrooms: 2" in content
    assert "Bathrooms: 1" in content
    assert "Size: 90 sqm" in content
    assert "Equipped kitchen" in content
    assert "Elevator" in content
    # Facts NOT on the property (price, verification, availability, an
    # amenity that's False/unset) must never leak into the prompt.
    assert "price" not in content.lower()
    assert "sar" not in content.lower()
    assert "verified" not in content.lower()
    assert "available" not in content.lower()
    assert "water included" not in content.lower()  # has_water not set on this property


def test_focus_title_only_leaves_description_none(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(
            reply='{"title": "Bright 2BR in Al Yasmin", "description": null}', input_tokens=5, output_tokens=5
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    title, description, generated_by = partner_listing_ai.improve_listing_wording(prop, focus="title", language="en")

    assert generated_by == "ai"
    assert title == "Bright 2BR in Al Yasmin"
    assert description is None  # focus excludes description -> always None, never fabricated


def test_focus_description_only_leaves_title_none(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(
            reply='{"title": null, "description": "A comfortable, well-equipped apartment."}',
            input_tokens=5,
            output_tokens=5,
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    title, description, generated_by = partner_listing_ai.improve_listing_wording(
        prop, focus="description", language="en"
    )

    assert generated_by == "ai"
    assert title is None
    assert description == "A comfortable, well-equipped apartment."


def test_fallback_when_no_api_key(monkeypatch):
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("run_chat should not be called when no API key is set")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    prop = _property()
    title, description, generated_by = partner_listing_ai.improve_listing_wording(prop, focus="both", language="en")

    assert generated_by == "fallback"
    assert not called["run_chat"]
    assert title == prop.title
    assert description == prop.description


def test_fallback_when_ai_call_fails(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _raise)

    prop = _property()
    title, description, generated_by = partner_listing_ai.improve_listing_wording(prop, focus="both", language="en")

    assert generated_by == "fallback"
    assert title == prop.title
    assert description == prop.description


def test_fallback_when_ai_reply_is_unparseable(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="not valid json", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    title, description, generated_by = partner_listing_ai.improve_listing_wording(prop, focus="both", language="en")

    assert generated_by == "fallback"
    assert title == prop.title
    assert description == prop.description


def test_fallback_when_ai_returns_no_usable_change(monkeypatch):
    """AI echoes the exact same title/description back (or returns nulls) —
    treated as "no usable suggestion", falls back rather than reporting a
    no-op change as generated_by="ai"."""
    prop = _property()

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(
            reply=f'{{"title": {prop.title!r}, "description": {prop.description!r}}}'.replace("'", '"'),
            input_tokens=5,
            output_tokens=5,
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    title, description, generated_by = partner_listing_ai.improve_listing_wording(prop, focus="both", language="en")

    assert generated_by == "fallback"
    assert title == prop.title
    assert description == prop.description


def test_arabic_language_requested_is_passed_through(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply='{"title": "شقة مشرقة", "description": null}', input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    title, _description, generated_by = partner_listing_ai.improve_listing_wording(
        prop, focus="title", language="ar"
    )

    assert generated_by == "ai"
    assert title == "شقة مشرقة"
    assert "Language: Arabic" in captured["content"]
