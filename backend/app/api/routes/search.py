from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.metrics import record_search
from app.core.search import SearchQuery, get_search_provider

router = APIRouter()


@router.get("/")
def search_properties(
    q: str = Query(default="", description="Search keyword"),
    area: str | None = Query(default=None),
    city: str | None = Query(default=None),
    listing_type: str | None = Query(default=None),
    min_bedrooms: int | None = Query(default=None, ge=0),
    min_price: float | None = Query(default=None),
    max_price: float | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Search properties with optional filters."""
    provider = get_search_provider(db)
    result = provider.search_properties(
        SearchQuery(
            q=q,
            area=area,
            city=city,
            listing_type=listing_type,
            min_bedrooms=min_bedrooms,
            min_price=min_price,
            max_price=max_price,
            limit=limit,
            offset=offset,
        )
    )
    record_search(endpoint="search", duration_ms=result.query_time_ms, result_count=len(result.items))
    return {
        "query": q,
        "area": area,
        "city": city,
        "count": len(result.items),
        "total": result.total,
        "results": result.items,
    }


@router.get("/autocomplete")
def autocomplete(
    q: str = Query(default="", min_length=1, description="City/area name prefix"),
    limit: int = Query(default=8, ge=1, le=20),
    db: Session = Depends(get_db),
):
    """City/district name suggestions as the user types in the search bar."""
    provider = get_search_provider(db)
    suggestions = provider.autocomplete_locations(q, limit=limit)
    return [{"label": s.label, "kind": s.kind, "city": s.city} for s in suggestions]
