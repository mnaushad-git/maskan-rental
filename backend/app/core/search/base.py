"""Provider-agnostic property search interface. `PostgresSearchProvider` (in
postgres_provider.py) is the only implementation today — it wraps the
existing Postgres/SQLAlchemy queries almost unchanged. A future OpenSearch or
Elasticsearch provider can implement this same interface so frontend clients
and route handlers never need to change when/if that migration happens.

Not implemented now (per the platform plan: don't add OpenSearch until it's
actually needed) — this module exists purely to draw the boundary early.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class SearchQuery:
    q: str = ""
    city: str | None = None
    area: str | None = None
    listing_type: str | None = None
    property_type: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_bedrooms: int | None = None
    limit: int = 50
    offset: int = 0


@dataclass
class SearchFacetValue:
    value: str
    count: int


@dataclass
class SearchResult:
    items: list[dict]
    total: int
    facets: dict[str, list[SearchFacetValue]] = field(default_factory=dict)
    query_time_ms: float = 0.0


@dataclass
class LocationSuggestion:
    label: str
    kind: str  # "city" | "area"
    city: str | None = None


@dataclass
class NearbyQuery:
    lat: float
    lng: float
    radius_km: float
    limit: int = 50


@dataclass
class AreaCount:
    area: str
    city: str
    count: int


class SearchProvider(ABC):
    @abstractmethod
    def search_properties(self, query: SearchQuery) -> SearchResult: ...

    @abstractmethod
    def autocomplete_locations(self, prefix: str, limit: int = 8) -> list[LocationSuggestion]: ...

    @abstractmethod
    def get_facets(self, query: SearchQuery) -> dict[str, list[SearchFacetValue]]: ...

    @abstractmethod
    def search_nearby(self, query: NearbyQuery) -> SearchResult: ...

    @abstractmethod
    def count_by_area(self, city: str | None = None) -> list[AreaCount]: ...

    def index_property(self, property_id: int) -> None:
        """No-op for Postgres (the table IS the index). A search-engine
        provider would push/update a document here."""
        return None

    def remove_property(self, property_id: int) -> None:
        return None

    def refresh_index(self) -> None:
        return None
