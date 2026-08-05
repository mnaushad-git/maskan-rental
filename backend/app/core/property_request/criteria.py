"""Projects a `PropertyRequest`'s structured fields into the canonical
`PropertyFilterCriteria` shape (app.core.search.filters) so the matcher's
indexed SQL candidate-narrowing step reuses the exact same column
expressions saved searches and search already use — no second filter
vocabulary. Request-specific fields with no `PropertyFilterCriteria`
equivalent (bedrooms_max, excluded_districts, required_amenities,
commute, ...) are evaluated separately in app.services.property_request_matcher.
"""
from app.core.search.filters import CURRENT_FILTER_SCHEMA_VERSION, PropertyFilterCriteria
from app.models.property_request import PropertyRequest


def build_canonical_filters(pr: PropertyRequest) -> PropertyFilterCriteria:
    return PropertyFilterCriteria(
        schema_version=CURRENT_FILTER_SCHEMA_VERSION,
        transaction_type=pr.transaction_type,
        property_type=pr.property_category,
        city=pr.city,
        districts=list(pr.preferred_districts or []),
        min_price=pr.min_price,
        max_price=pr.max_price,
        bedrooms=pr.bedrooms_min,
        bathrooms=pr.bathrooms_min,
        min_area_sq_m=pr.min_area_sq_m,
        max_area_sq_m=pr.max_area_sq_m,
        furnishing=pr.furnishing,
        verified_only=pr.verified_only,
    )


def refresh_canonical_filters(pr: PropertyRequest) -> None:
    """Call whenever structured fields change, before persisting — keeps
    `PropertyRequest.canonical_filters`/`filter_schema_version` in sync with
    the fields it was derived from (mirrors SavedSearch's denormalization)."""
    criteria = build_canonical_filters(pr)
    pr.canonical_filters = criteria.to_dict()
    pr.filter_schema_version = criteria.schema_version
