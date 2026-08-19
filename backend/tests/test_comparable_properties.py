"""Comparable Properties: district-first ordering, value labels, match-
similarity calc, bounded limit (cap 10), and no N+1 when callers touch
`listing_images` on the results (eager-loaded via `selectinload`).
"""
import uuid

from sqlalchemy import event

from app.db.session import engine
from app.models.property import Property
from app.services.comparable_properties import MAX_COMPARABLES, find_comparable_properties


def _city() -> str:
    return f"TestCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Test Property", area="Test District", city="TestCity", listing_type="rent",
        status="Published", bedrooms=2, size_sq_m=100, property_type="Apartment", monthly_rent=5000.0,
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def test_district_first_ordering(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, area="District A", monthly_rent=5000)
    same_district = _make_property(db_session, city=city, area="District A", monthly_rent=9000)
    other_district_closer_price = _make_property(db_session, city=city, area="District B", monthly_rent=5100)

    results = find_comparable_properties(db_session, subject)
    ids_in_order = [r.property.id for r in results]
    assert ids_in_order.index(same_district.id) < ids_in_order.index(other_district_closer_price.id)


def test_value_labels(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, monthly_rent=10_000)
    better = _make_property(db_session, city=city, monthly_rent=8_000)   # -20%
    similar = _make_property(db_session, city=city, monthly_rent=10_200)  # +2%
    higher = _make_property(db_session, city=city, monthly_rent=13_000)   # +30%

    results = {r.property.id: r for r in find_comparable_properties(db_session, subject)}
    assert results[better.id].value_label == "Better Value"
    assert results[similar.id].value_label == "Similar Price"
    assert results[higher.id].value_label == "Higher Price"
    assert results[better.id].price_difference == -2_000
    assert results[higher.id].price_difference == 3_000


def test_match_similarity_calc(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, area="District A", property_type="Apartment", bedrooms=2, size_sq_m=100, monthly_rent=5000)
    exact_match = _make_property(db_session, city=city, area="District A", property_type="Apartment", bedrooms=2, size_sq_m=100, monthly_rent=5000)
    partial_match = _make_property(db_session, city=city, area="District B", property_type="Apartment", bedrooms=3, size_sq_m=100, monthly_rent=5000)

    results = {r.property.id: r for r in find_comparable_properties(db_session, subject)}
    assert results[exact_match.id].match_similarity_percent == 100
    assert results[partial_match.id].match_similarity_percent < 100


def test_bounded_to_max_comparables(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, monthly_rent=5000)
    for i in range(MAX_COMPARABLES + 10):
        _make_property(db_session, city=city, monthly_rent=5000 + i)

    results = find_comparable_properties(db_session, subject, limit=50)
    assert len(results) == MAX_COMPARABLES


def test_no_n_plus_1_when_touching_listing_images(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, monthly_rent=5000)
    for i in range(5):
        _make_property(db_session, city=city, monthly_rent=5000 + i)
    db_session.flush()

    results = find_comparable_properties(db_session, subject)

    queries: list[str] = []

    def _count(conn, cursor, statement, *args):
        queries.append(statement)

    event.listen(engine, "before_cursor_execute", _count)
    try:
        for r in results:
            _ = r.property.listing_images  # already eager-loaded — must not issue a new query
    finally:
        event.remove(engine, "before_cursor_execute", _count)

    assert len(queries) == 0, f"expected 0 additional queries (listing_images eager-loaded), got {len(queries)}"
