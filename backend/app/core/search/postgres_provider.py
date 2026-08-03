import math
import time

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.search.base import (
    AreaCount,
    LocationSuggestion,
    NearbyQuery,
    SearchFacetValue,
    SearchProvider,
    SearchQuery,
    SearchResult,
)
from app.models.property import Property
from app.schemas.property import PropertyOut

EARTH_RADIUS_KM = 6371.0


def _property_filters(query: SearchQuery) -> list:
    filters = [Property.status == "Published"]
    if query.q:
        filters.append((Property.title.ilike(f"%{query.q}%")) | (Property.description.ilike(f"%{query.q}%")))
    if query.area:
        filters.append(Property.area.ilike(f"%{query.area}%"))
    if query.city:
        filters.append(Property.city.ilike(f"%{query.city}%"))
    if query.listing_type:
        filters.append(Property.listing_type == query.listing_type)
    if query.property_type:
        filters.append(Property.property_type == query.property_type)
    if query.min_bedrooms is not None:
        filters.append(Property.bedrooms >= query.min_bedrooms)
    if query.min_price is not None:
        filters.append(Property.monthly_rent >= query.min_price)
    if query.max_price is not None:
        filters.append(Property.monthly_rent <= query.max_price)
    return filters


def _bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """Degree-delta bounding box around (lat, lng) for a given radius — cheap
    pre-filter so the DB only scans nearby rows before the exact haversine
    distance check narrows it further in Python."""
    lat_delta = radius_km / 111.0  # ~111km per degree latitude, everywhere
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))
    return lat - lat_delta, lat + lat_delta, lng - lng_delta, lng + lng_delta


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


class PostgresSearchProvider(SearchProvider):
    def __init__(self, db: Session):
        self.db = db

    def search_properties(self, query: SearchQuery) -> SearchResult:
        started = time.monotonic()
        filters = _property_filters(query)

        total = self.db.scalar(select(func.count()).select_from(Property).where(and_(*filters))) or 0
        stmt = (
            select(Property)
            .where(and_(*filters))
            .order_by(Property.id.desc())
            .offset(query.offset)
            .limit(query.limit)
        )
        rows = self.db.scalars(stmt).all()
        items = [PropertyOut.model_validate(r, from_attributes=True).model_dump(mode="json") for r in rows]

        return SearchResult(
            items=items,
            total=total,
            facets=self.get_facets(query),
            query_time_ms=(time.monotonic() - started) * 1000,
        )

    def autocomplete_locations(self, prefix: str, limit: int = 8) -> list[LocationSuggestion]:
        if not prefix:
            return []
        needle = f"{prefix}%"
        cities = self.db.scalars(
            select(Property.city)
            .where(Property.status == "Published", Property.city.ilike(needle))
            .distinct()
            .limit(limit)
        ).all()
        areas = self.db.execute(
            select(Property.area, Property.city)
            .where(Property.status == "Published", Property.area.ilike(needle))
            .distinct()
            .limit(limit)
        ).all()
        suggestions = [LocationSuggestion(label=c, kind="city") for c in cities]
        suggestions += [LocationSuggestion(label=a, kind="area", city=c) for a, c in areas]
        return suggestions[:limit]

    def get_facets(self, query: SearchQuery) -> dict[str, list[SearchFacetValue]]:
        # Facets ignore the field they'd otherwise facet on, e.g. city facet
        # counts are computed without the city filter, so the UI can show
        # "what if I picked a different city" counts rather than only the
        # count for the city already selected.
        base_filters = [f for f in _property_filters(query)]

        city_rows = self.db.execute(
            select(Property.city, func.count(Property.id)).where(and_(*base_filters)).group_by(Property.city)
        ).all()
        type_rows = self.db.execute(
            select(Property.listing_type, func.count(Property.id)).where(and_(*base_filters)).group_by(Property.listing_type)
        ).all()

        return {
            "city": [SearchFacetValue(value=c, count=n) for c, n in city_rows],
            "listing_type": [SearchFacetValue(value=t, count=n) for t, n in type_rows if t],
        }

    def search_nearby(self, query: NearbyQuery) -> SearchResult:
        started = time.monotonic()
        min_lat, max_lat, min_lng, max_lng = _bounding_box(query.lat, query.lng, query.radius_km)

        rows = self.db.scalars(
            select(Property)
            .where(
                Property.status == "Published",
                Property.latitude.between(min_lat, max_lat),
                Property.longitude.between(min_lng, max_lng),
            )
            .limit(query.limit * 4)  # over-fetch the box, then trim to the exact radius below
        ).all()

        within_radius = [
            r for r in rows
            if r.latitude is not None and r.longitude is not None
            and _haversine_km(query.lat, query.lng, r.latitude, r.longitude) <= query.radius_km
        ]
        within_radius = within_radius[: query.limit]
        items = [PropertyOut.model_validate(r, from_attributes=True).model_dump(mode="json") for r in within_radius]

        return SearchResult(items=items, total=len(items), query_time_ms=(time.monotonic() - started) * 1000)

    def count_by_area(self, city: str | None = None) -> list[AreaCount]:
        stmt = (
            select(Property.area, Property.city, func.count(Property.id))
            .where(Property.status == "Published")
            .group_by(Property.area, Property.city)
        )
        if city:
            stmt = stmt.where(Property.city.ilike(city))
        rows = self.db.execute(stmt).all()
        return [AreaCount(area=a, city=c, count=n) for a, c, n in rows]
