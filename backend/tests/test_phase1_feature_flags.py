"""myMakan Phase-1 feature-flag coverage (see docs/implementation/mymakan-phase1.md
"Feature flags"). Added by Prompt 10 per the original brief's ask for minimal,
focused checks that feature flags work and that an out-of-scope route is
actually hidden/gated — not just skipped elsewhere because it's off.

Kept deliberately small: this isn't a new test suite, just enough to catch a
regression if a future change accidentally flips a default or drops the
router-gating in app/main.py.
"""
import pytest

from app.core.config import settings
from app.core.feature_flags import is_enabled

# Flags that ship on by default for myMakan Phase-1 — the in-scope surface.
_DEFAULT_ON_FLAGS = ["rent", "buy", "ai_advisor", "area_intelligence", "saved_searches", "notifications", "leads"]

# Flags that ship off by default — hidden-but-preserved for a later phase.
_DEFAULT_OFF_FLAGS = ["projects", "booking", "short_stay", "financing", "property_management", "external_transaction"]


def test_phase1_default_on_flags_are_enabled():
    for flag in _DEFAULT_ON_FLAGS:
        assert is_enabled(flag) is True, f"{flag} should default on for myMakan Phase-1"


def test_phase1_default_off_flags_are_disabled():
    for flag in _DEFAULT_OFF_FLAGS:
        assert is_enabled(flag) is False, f"{flag} should default off for myMakan Phase-1"


def test_is_enabled_reflects_settings_value(monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_PROJECTS", True)
    assert is_enabled("projects") is True
    monkeypatch.setattr(settings, "FEATURE_PROJECTS", False)
    assert is_enabled("projects") is False


def test_is_enabled_unknown_flag_defaults_false():
    assert is_enabled("not_a_real_flag") is False


@pytest.mark.skipif(settings.FEATURE_PROJECTS, reason="projects.router is registered when FEATURE_PROJECTS is on")
def test_projects_route_gated_by_default(client):
    resp = client.get("/api/projects/")
    assert resp.status_code == 404


@pytest.mark.skipif(settings.FEATURE_BOOKING, reason="bookings.router is registered when FEATURE_BOOKING is on")
def test_bookings_route_gated_by_default(client):
    resp = client.get("/api/bookings/availability", params={"property_id": 1, "check_in": "2026-09-01", "check_out": "2026-09-02"})
    assert resp.status_code == 404


@pytest.mark.skipif(settings.FEATURE_FINANCING, reason="financing.router is registered when FEATURE_FINANCING is on")
def test_financing_route_gated_by_default(client):
    resp = client.post("/api/financing/", json={"property_id": 1, "stated_budget": 10000})
    assert resp.status_code == 404
