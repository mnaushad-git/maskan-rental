"""Trust Center — Listing Consistency: info/warning/blocking severity
classification and the score penalty each severity applies.
"""
from app.models.property import Property
from app.services.listing_consistency import check_listing_consistency


def _base_property(**overrides) -> Property:
    defaults = dict(
        title="Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, bathrooms=2, size_sq_m=150,
    )
    defaults.update(overrides)
    return Property(**defaults)


def test_clean_listing_has_no_issues_and_scores_100():
    prop = _base_property()
    result = check_listing_consistency(prop)
    assert result.issues == []
    assert result.score == 100
    assert result.has_blocking_issues is False


def test_zero_price_is_blocking():
    prop = _base_property(monthly_rent=0)
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["invalid_price"] == "blocking"
    assert result.has_blocking_issues is True
    assert result.score <= 65


def test_negative_size_is_blocking():
    prop = _base_property(size_sq_m=-10)
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["invalid_size"] == "blocking"
    assert result.has_blocking_issues is True


def test_unreasonable_bedroom_count_is_warning():
    prop = _base_property(bedrooms=500)
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["unreasonable_bedrooms"] == "warning"
    assert result.has_blocking_issues is False


def test_unreasonable_bathroom_count_is_warning():
    prop = _base_property(bathrooms=-5)
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["unreasonable_bathrooms"] == "warning"


def test_rent_listing_missing_rent_but_has_sale_price_is_mismatch_warning():
    prop = _base_property(monthly_rent=None, sale_price=500_000.0)
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["rent_sale_mismatch"] == "warning"


def test_sale_listing_missing_sale_price_but_has_rent_is_mismatch_warning():
    prop = _base_property(listing_type="sale", monthly_rent=4000.0, sale_price=None)
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["rent_sale_mismatch"] == "warning"


def test_missing_district_is_info_severity():
    prop = _base_property(area="")
    result = check_listing_consistency(prop)
    codes = {i.code: i.severity for i in result.issues}
    assert codes["missing_district"] == "info"
    # info-only issue should be a small penalty, not blocking
    assert result.has_blocking_issues is False
    assert result.score == 95


def test_score_never_drops_below_zero_with_many_issues():
    prop = _base_property(monthly_rent=0, size_sq_m=-1, bedrooms=999, bathrooms=999, area="")
    result = check_listing_consistency(prop)
    assert result.score == 0
