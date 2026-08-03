from app.core.search.base import (
    AreaCount,
    LocationSuggestion,
    NearbyQuery,
    SearchFacetValue,
    SearchProvider,
    SearchQuery,
    SearchResult,
)
from app.core.search.postgres_provider import PostgresSearchProvider

__all__ = [
    "AreaCount",
    "LocationSuggestion",
    "NearbyQuery",
    "SearchFacetValue",
    "SearchProvider",
    "SearchQuery",
    "SearchResult",
    "PostgresSearchProvider",
    "get_search_provider",
]


def get_search_provider(db) -> SearchProvider:
    """Single point of construction — swap the returned type to change
    provider for the whole app without touching any call site."""
    return PostgresSearchProvider(db)
