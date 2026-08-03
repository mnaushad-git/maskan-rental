"""SearchProvider abstraction tests. Uses uniquely-named test areas so
assertions can't collide with the 145 pre-existing seeded properties in the
dev DB this test suite runs against (see conftest.py for the transaction-
rollback isolation strategy)."""
import uuid

import pytest

from app.core.search import NearbyQuery, PostgresSearchProvider, SearchQuery, get_search_provider
from app.models.property import Property


@pytest.fixture()
def unique_area() -> str:
    return f"SearchTestArea-{uuid.uuid4().hex[:8]}"


def _make_property(area: str, city: str = "Riyadh", **overrides) -> Property:
    defaults = dict(
        title="Test Listing", area=area, city=city, listing_type="rent",
        monthly_rent=4000, bedrooms=2, status="Published",
    )
    defaults.update(overrides)
    return Property(**defaults)


def test_search_properties_filters_by_area_and_status(db_session, unique_area):
    published = _make_property(unique_area)
    draft = _make_property(unique_area, status="Draft", title="Draft listing")
    db_session.add_all([published, draft])
    db_session.commit()

    provider = PostgresSearchProvider(db_session)
    result = provider.search_properties(SearchQuery(area=unique_area))

    assert result.total == 1
    assert result.items[0]["title"] == "Test Listing"
    assert result.query_time_ms >= 0


def test_search_properties_price_range(db_session, unique_area):
    cheap = _make_property(unique_area, monthly_rent=2000)
    expensive = _make_property(unique_area, monthly_rent=9000)
    db_session.add_all([cheap, expensive])
    db_session.commit()

    provider = PostgresSearchProvider(db_session)
    result = provider.search_properties(SearchQuery(area=unique_area, min_price=1000, max_price=3000))

    assert result.total == 1
    assert result.items[0]["monthly_rent"] == 2000


def test_search_properties_facets_include_city_and_listing_type(db_session, unique_area):
    db_session.add_all([
        _make_property(unique_area, listing_type="rent"),
        _make_property(unique_area, listing_type="sale", monthly_rent=None, sale_price=500000),
    ])
    db_session.commit()

    provider = PostgresSearchProvider(db_session)
    result = provider.search_properties(SearchQuery(area=unique_area))

    listing_type_facet = {f.value: f.count for f in result.facets["listing_type"]}
    assert listing_type_facet.get("rent") == 1
    assert listing_type_facet.get("sale") == 1


def test_autocomplete_locations_matches_prefix(db_session, unique_area):
    db_session.add(_make_property(unique_area))
    db_session.commit()

    provider = PostgresSearchProvider(db_session)
    suggestions = provider.autocomplete_locations(unique_area[:12])

    assert any(s.label == unique_area and s.kind == "area" for s in suggestions)


def test_autocomplete_locations_empty_prefix_returns_nothing(db_session):
    provider = PostgresSearchProvider(db_session)
    assert provider.autocomplete_locations("") == []


def test_search_nearby_returns_only_properties_within_radius(db_session, unique_area):
    # Riyadh center ~ (24.7136, 46.6753). ~1km away vs ~50km away.
    near = _make_property(unique_area, title="Near", latitude=24.7136, longitude=46.6753)
    far = _make_property(unique_area, title="Far", latitude=25.2000, longitude=46.6753)
    db_session.add_all([near, far])
    db_session.commit()

    provider = PostgresSearchProvider(db_session)
    result = provider.search_nearby(NearbyQuery(lat=24.7136, lng=46.6753, radius_km=5, limit=50))

    titles = {item["title"] for item in result.items if item["area"] == unique_area}
    assert "Near" in titles
    assert "Far" not in titles


def test_count_by_area_groups_published_properties(db_session, unique_area):
    db_session.add_all([_make_property(unique_area), _make_property(unique_area)])
    db_session.commit()

    provider = PostgresSearchProvider(db_session)
    counts = {row.area: row.count for row in provider.count_by_area(city="Riyadh")}

    assert counts.get(unique_area) == 2


def test_get_search_provider_factory_returns_postgres_provider(db_session):
    provider = get_search_provider(db_session)
    assert isinstance(provider, PostgresSearchProvider)


def test_index_remove_refresh_are_safe_noops(db_session):
    provider = PostgresSearchProvider(db_session)
    provider.index_property(1)
    provider.remove_property(1)
    provider.refresh_index()


# ── End-to-end: the real /api/search routes use the provider ────────────

def test_search_endpoint_returns_matching_properties(client, db_session, unique_area):
    db_session.add(_make_property(unique_area))
    db_session.commit()

    resp = client.get("/api/search/", params={"area": unique_area})
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert body["results"][0]["area"] == unique_area


def test_autocomplete_endpoint_returns_suggestions(client, db_session, unique_area):
    db_session.add(_make_property(unique_area))
    db_session.commit()

    resp = client.get("/api/search/autocomplete", params={"q": unique_area[:12]})
    assert resp.status_code == 200
    labels = [s["label"] for s in resp.json()]
    assert unique_area in labels
