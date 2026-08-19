"""Trust Center — Marketplace Confidence: reuses (never recomputes)
`data_confidence.py`'s `DataConfidence` result, folded into a 0-100 score.
"""
from app.services.data_confidence import DataConfidence
from app.services.marketplace_confidence import compute_marketplace_confidence


def test_none_when_no_data_confidence_supplied():
    assert compute_marketplace_confidence(None) is None


def test_score_mirrors_data_confidence_signal_ratio():
    dc = DataConfidence(level="High", reason="High confidence — ...", signals_present=6, signals_total=6)
    result = compute_marketplace_confidence(dc)
    assert result.score == 100
    assert result.level == "High"
    assert result.reason == dc.reason


def test_moderate_confidence_yields_partial_score():
    dc = DataConfidence(level="Moderate", reason="Moderate confidence — missing ...", signals_present=3, signals_total=6)
    result = compute_marketplace_confidence(dc)
    assert result.score == 50
    assert result.level == "Moderate"


def test_reason_is_passed_through_unmodified():
    dc = DataConfidence(level="Moderate", reason="a custom reason string", signals_present=1, signals_total=6)
    result = compute_marketplace_confidence(dc)
    assert result.reason == "a custom reason string"
