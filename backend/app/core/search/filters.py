"""Canonical property filter criteria — the one filter vocabulary saved
searches, the matching engine, and (in time) the main listing/search
endpoints should all agree on. `PropertyFilterCriteria` is a plain
dataclass so it can be freely serialized into `SavedSearch.filters` (JSON)
and rebuilt later without any FastAPI/Pydantic request-parsing baggage.

`build_property_filters()` returns a list of SQLAlchemy column expressions
(AND-ed together by the caller) so both a real query (`saved-searches
preview/matches`) and the in-Python matcher (`app.services.saved_search_matcher`)
share one definition of "does this property match these criteria" instead of
each hand-rolling their own — the exact duplication the platform plan calls
out to avoid.

`schema_version` lets old saved-search rows keep working if new filter
fields are introduced later: `from_dict()` fills in defaults for any field
missing from an older payload rather than raising.
"""
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import and_, or_

from app.models.mediator import Mediator
from app.models.property import Property

CURRENT_FILTER_SCHEMA_VERSION = 1

VALID_TRANSACTION_TYPES = {"rent", "sale"}
VALID_SORTS = {"newest", "price_asc", "price_desc"}


@dataclass
class PropertyFilterCriteria:
    schema_version: int = CURRENT_FILTER_SCHEMA_VERSION
    keyword: str = ""
    transaction_type: str | None = None  # "rent" | "sale" -> Property.listing_type
    property_type: str | None = None
    city: str | None = None
    districts: list[str] = field(default_factory=list)  # -> Property.area IN (...)
    min_price: float | None = None
    max_price: float | None = None
    bedrooms: int | None = None  # minimum bedrooms
    bathrooms: int | None = None  # minimum bathrooms
    min_area_sq_m: int | None = None
    max_area_sq_m: int | None = None
    furnishing: str | None = None
    amenities: list[str] = field(default_factory=list)  # reserved: no Property column yet, stored for forward-compat
    mediator_id: int | None = None
    verified_only: bool = False
    min_lat: float | None = None
    max_lat: float | None = None
    min_lng: float | None = None
    max_lng: float | None = None
    sort: str = "newest"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "keyword": self.keyword,
            "transaction_type": self.transaction_type,
            "property_type": self.property_type,
            "city": self.city,
            "districts": list(self.districts),
            "min_price": self.min_price,
            "max_price": self.max_price,
            "bedrooms": self.bedrooms,
            "bathrooms": self.bathrooms,
            "min_area_sq_m": self.min_area_sq_m,
            "max_area_sq_m": self.max_area_sq_m,
            "furnishing": self.furnishing,
            "amenities": list(self.amenities),
            "mediator_id": self.mediator_id,
            "verified_only": self.verified_only,
            "min_lat": self.min_lat,
            "max_lat": self.max_lat,
            "min_lng": self.min_lng,
            "max_lng": self.max_lng,
            "sort": self.sort,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "PropertyFilterCriteria":
        """Tolerant of older/partial payloads — any missing/unknown field
        just falls back to the dataclass default, so a filter-schema
        addition never breaks previously-saved searches."""
        data = data or {}
        known = {f: data.get(f) for f in cls.__dataclass_fields__ if f in data}
        known.setdefault("districts", data.get("districts") or [])
        known.setdefault("amenities", data.get("amenities") or [])
        try:
            return cls(**{**{"schema_version": CURRENT_FILTER_SCHEMA_VERSION}, **known})
        except TypeError:
            # Unknown keys from a future schema version — drop anything that
            # doesn't map to a current field rather than failing to load.
            valid_keys = set(cls.__dataclass_fields__)
            filtered = {k: v for k, v in known.items() if k in valid_keys}
            return cls(**filtered)

    def fingerprint(self) -> str:
        """Stable representation used for exact-duplicate detection when
        creating a saved search — order-independent for list fields."""
        import hashlib
        import json

        payload = self.to_dict()
        payload["districts"] = sorted(payload["districts"])
        payload["amenities"] = sorted(payload["amenities"])
        payload.pop("schema_version", None)
        payload.pop("sort", None)
        return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def build_property_filters(criteria: PropertyFilterCriteria, *, published_only: bool = True) -> list:
    """Column-expression list; caller ANDs them (`and_(*filters)`)."""
    filters: list = []
    if published_only:
        filters.append(Property.status == "Published")
    if criteria.keyword:
        needle = f"%{criteria.keyword}%"
        filters.append(or_(Property.title.ilike(needle), Property.description.ilike(needle)))
    if criteria.transaction_type:
        filters.append(Property.listing_type == criteria.transaction_type)
    if criteria.property_type:
        filters.append(Property.property_type == criteria.property_type)
    if criteria.city:
        filters.append(Property.city.ilike(criteria.city))
    if criteria.districts:
        filters.append(or_(*[Property.area.ilike(d) for d in criteria.districts]))
    if criteria.furnishing:
        filters.append(Property.furnished == criteria.furnishing)
    if criteria.bedrooms is not None:
        filters.append(Property.bedrooms >= criteria.bedrooms)
    if criteria.bathrooms is not None:
        filters.append(Property.bathrooms >= criteria.bathrooms)
    if criteria.min_area_sq_m is not None:
        filters.append(Property.size_sq_m >= criteria.min_area_sq_m)
    if criteria.max_area_sq_m is not None:
        filters.append(Property.size_sq_m <= criteria.max_area_sq_m)

    price_column = Property.sale_price if criteria.transaction_type == "sale" else Property.monthly_rent
    if criteria.min_price is not None:
        filters.append(price_column >= criteria.min_price)
    if criteria.max_price is not None:
        filters.append(price_column <= criteria.max_price)

    if criteria.mediator_id is not None:
        filters.append(Property.mediator_id == criteria.mediator_id)
    if criteria.verified_only:
        filters.append(Property.mediator.has(Mediator.is_verified == True))  # noqa: E712

    if criteria.min_lat is not None and criteria.max_lat is not None and criteria.min_lng is not None and criteria.max_lng is not None:
        filters.append(and_(Property.latitude.between(criteria.min_lat, criteria.max_lat), Property.longitude.between(criteria.min_lng, criteria.max_lng)))

    return filters


def property_matches_criteria(criteria: PropertyFilterCriteria, prop: Property, *, require_published: bool = True) -> bool:
    """Pure-Python equivalent of `build_property_filters`, evaluated against
    an already-loaded `Property` instance. Used by the matching engine so a
    single property event doesn't need one SQL round-trip per candidate
    saved search — semantics are kept identical to the SQL builder above by
    construction (same field-by-field checks, just evaluated in memory)."""
    if require_published and prop.status != "Published":
        return False
    if criteria.keyword:
        needle = criteria.keyword.lower()
        if needle not in (prop.title or "").lower() and needle not in (prop.description or "").lower():
            return False
    if criteria.transaction_type and prop.listing_type != criteria.transaction_type:
        return False
    if criteria.property_type and prop.property_type != criteria.property_type:
        return False
    if criteria.city and (prop.city or "").lower() != criteria.city.lower():
        return False
    if criteria.districts and (prop.area or "").lower() not in {d.lower() for d in criteria.districts}:
        return False
    if criteria.furnishing and prop.furnished != criteria.furnishing:
        return False
    if criteria.bedrooms is not None and (prop.bedrooms or 0) < criteria.bedrooms:
        return False
    if criteria.bathrooms is not None and (prop.bathrooms or 0) < criteria.bathrooms:
        return False
    if criteria.min_area_sq_m is not None and (prop.size_sq_m or 0) < criteria.min_area_sq_m:
        return False
    if criteria.max_area_sq_m is not None and (prop.size_sq_m or 0) > criteria.max_area_sq_m:
        return False

    price = prop.sale_price if criteria.transaction_type == "sale" else prop.monthly_rent
    if criteria.min_price is not None and (price is None or price < criteria.min_price):
        return False
    if criteria.max_price is not None and (price is None or price > criteria.max_price):
        return False

    if criteria.mediator_id is not None and prop.mediator_id != criteria.mediator_id:
        return False
    if criteria.verified_only and not prop.mediator_is_verified:
        return False

    if criteria.min_lat is not None and (prop.latitude is None or prop.latitude < criteria.min_lat):
        return False
    if criteria.max_lat is not None and (prop.latitude is None or prop.latitude > criteria.max_lat):
        return False
    if criteria.min_lng is not None and (prop.longitude is None or prop.longitude < criteria.min_lng):
        return False
    if criteria.max_lng is not None and (prop.longitude is None or prop.longitude > criteria.max_lng):
        return False

    return True
