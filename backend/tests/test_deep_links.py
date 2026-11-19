"""Permanent Maskan deep-link identity: every backend-generated notification
link uses `maskan://`, and no emitter hardcodes a scheme of its own."""
import pathlib
import re

from app.core.deep_links import DEEP_LINK_SCHEME, LEGACY_DEEP_LINK_SCHEMES, app_link


def test_primary_scheme_is_maskan():
    assert DEEP_LINK_SCHEME == "maskan"
    assert set(LEGACY_DEEP_LINK_SCHEMES) == {"myhome", "mymakan"}


def test_app_link_shapes():
    assert app_link("property/5") == "maskan://property/5"
    assert app_link("/lead/7") == "maskan://lead/7"
    assert app_link("partner/viewings/3") == "maskan://partner/viewings/3"


def test_no_hardcoded_app_schemes_in_backend_source():
    app_dir = pathlib.Path(__file__).resolve().parents[1] / "app"
    pattern = re.compile(r"""f?["'](?:myhome|mymakan|maskan)://""")
    offenders = [
        str(p.relative_to(app_dir))
        for p in app_dir.rglob("*.py")
        if p.name != "deep_links.py" and pattern.search(p.read_text(encoding="utf-8"))
    ]
    assert offenders == []
