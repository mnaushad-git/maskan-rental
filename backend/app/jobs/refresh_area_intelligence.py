"""
Weekly job: refresh area intelligence scores from Maskan's place data sources
(live Google Places + Distance Matrix APIs — GOOGLE_PLACES_API_KEY and
GOOGLE_MAPS_API_KEY must be set in .env; falls back to mock data otherwise).

Scheduled in app/main.py's lifespan (APScheduler, Asia/Riyadh) to run every
Thursday at midnight. For a manual one-off run: python -m app.jobs.refresh_area_intelligence
Or triggered on-demand for one district via: POST /api/areas/{area_name}/intelligence/refresh
"""
import logging
import math
import time
from datetime import datetime, timezone

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.area_intelligence import AreaIntelligence

logger = logging.getLogger(__name__)

# Arbitrary, must stay unique across jobs sharing app/core/locks.pg_advisory_lock.
_LOCK_KEY = 7270002

# City centre coordinates used for commute calculations
CITY_CENTRES = {
    "riyadh": (24.6877, 46.7219),
    "jeddah": (21.4858, 39.1925),
    "dammam": (26.3927, 50.0861),
}


# ── Place data helpers (mocked) ───────────────────────────────────────────────

def _fetch_places(lat: float, lng: float, place_type: str, radius_m: int = 3000) -> list[dict]:
    """
    Fetch nearby places for the given coordinates and type.
    TODO: Replace with real httpx call when GOOGLE_PLACES_API_KEY is set.
    """
    if settings.GOOGLE_PLACES_API_KEY:
        import httpx
        url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
        resp = httpx.get(url, params={
            "location": f"{lat},{lng}",
            "radius": radius_m,
            "type": place_type,
            "key": settings.GOOGLE_PLACES_API_KEY,
        }, timeout=10)
        resp.raise_for_status()
        return resp.json().get("results", [])

    # MOCK: return realistic sample data so the job works without an API key
    return [
        {"name": f"Sample {place_type.title()} 1", "rating": 4.2, "geometry": {"location": {"lat": lat + 0.005, "lng": lng + 0.005}}},
        {"name": f"Sample {place_type.title()} 2", "rating": 3.9, "geometry": {"location": {"lat": lat - 0.003, "lng": lng + 0.008}}},
        {"name": f"Sample {place_type.title()} 3", "rating": 4.5, "geometry": {"location": {"lat": lat + 0.010, "lng": lng - 0.006}}},
    ]


def _fetch_commute_minutes(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> int:
    """
    Estimate peak-hour commute time between two coordinates.
    TODO: Replace with real httpx call when GOOGLE_MAPS_API_KEY is set.
    """
    if settings.GOOGLE_MAPS_API_KEY:
        import httpx
        url = "https://maps.googleapis.com/maps/api/distancematrix/json"
        resp = httpx.get(url, params={
            "origins": f"{origin_lat},{origin_lng}",
            "destinations": f"{dest_lat},{dest_lng}",
            "mode": "driving",
            "departure_time": "now",
            "key": settings.GOOGLE_MAPS_API_KEY,
        }, timeout=10)
        resp.raise_for_status()
        rows = resp.json().get("rows", [])
        if rows and rows[0].get("elements"):
            duration = rows[0]["elements"][0].get("duration_in_traffic") or rows[0]["elements"][0].get("duration", {})
            return max(5, duration.get("value", 1800) // 60)

    # MOCK: estimate based on straight-line distance
    dist_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    return max(5, int(dist_km * 2.5))  # ~25 km/h average in traffic


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


# ── Score calculation ──────────────────────────────────────────────────────────

def _rescale_rating(avg_rating: float) -> float:
    """Map Google's clustered [3.0, 5.0] range → [45, 95] so real differences register."""
    return max(45.0, min(95.0, 45 + (avg_rating - 3.0) / 2.0 * 50))


def _compute_school_score(schools: list[dict]) -> float:
    """
    Covers: number of schools within 3 km, their Google rating, and whether
    any international / bilingual schools are present (bonus for expat/mixed areas).
    """
    if not schools:
        return 40.0
    avg_rating = sum(s.get("rating") or 3.5 for s in schools) / len(schools)
    rating_base = _rescale_rating(avg_rating)
    count_bonus = min(18, len(schools) * 3)  # up to +18 for 6+ schools
    intl_bonus = min(10, 5 * sum(
        1 for s in schools
        if any(w in s.get("name", "") for w in ["International", "American", "British", "French", "German", "Pakistani", "Indian"])
    ))
    return min(100.0, rating_base + count_bonus * 0.3 + intl_bonus)


def _compute_healthcare_score(hospitals: list[dict]) -> float:
    """
    Covers: number of hospitals / clinics within 3 km, their Google rating,
    and whether major / specialty centres are present.
    """
    if not hospitals:
        return 40.0
    avg_rating = sum(h.get("rating") or 3.5 for h in hospitals) / len(hospitals)
    rating_base = _rescale_rating(avg_rating)
    count_bonus = min(15, len(hospitals) * 2.5)
    specialty_bonus = min(15, 5 * sum(
        1 for h in hospitals
        if any(w in h.get("name", "") for w in ["Specialist", "Medical Center", "Medical Centre", "King", "National", "Saudi German", "Dr. Sulaiman"])
    ))
    return min(100.0, rating_base + count_bonus * 0.3 + specialty_bonus)


def _compute_lifestyle_score(lifestyle: dict) -> float:
    """
    Covers: restaurants (variety, 2 km), gyms (2 km), mosques (1.5 km),
    shopping malls (5 km), and parks / green spaces (3 km).
    Mosque count is capped low because all Riyadh districts have many —
    proximity to a good mosque matters more than raw count.
    """
    score = 0.0
    score += min(22, lifestyle.get("restaurants", {}).get("count", 0) * 0.5)
    score += min(15, lifestyle.get("gyms",        {}).get("count", 0) * 3.5)
    score += min(8,  lifestyle.get("mosques",     {}).get("count", 0) * 1.5)   # reduced: ubiquitous in Riyadh
    score += min(25, lifestyle.get("malls",       {}).get("count", 0) * 10)
    score += min(15, lifestyle.get("parks",       {}).get("count", 0) * 7)     # new: parks & green spaces
    return min(100.0, score)


def _compute_traffic_score(commute_minutes: int) -> float:
    """
    Covers: estimated peak-hour driving time to city centre (KAFD / Olaya).
    Riyadh context: ≤20 min = excellent, 45 min = average, 60+ = poor.
    """
    if commute_minutes <= 15:  return 95.0
    if commute_minutes <= 20:  return 88.0
    if commute_minutes <= 30:  return 78.0
    if commute_minutes <= 40:  return 65.0
    if commute_minutes <= 50:  return 50.0
    if commute_minutes <= 60:  return 35.0
    return max(0.0, 20.0)


# ── Core refresh logic ────────────────────────────────────────────────────────

def _refresh_district(row: AreaIntelligence, db) -> None:
    lat, lng = row.center_lat, row.center_lng
    city_key = row.city.lower()
    city_centre = CITY_CENTRES.get(city_key, CITY_CENTRES["riyadh"])

    try:
        # Schools
        raw_schools = _fetch_places(lat, lng, "school", radius_m=3000)
        schools = [
            {
                "name": p["name"],
                "rating": p.get("rating", 0),
                "distance_km": round(_haversine_km(lat, lng, p["geometry"]["location"]["lat"], p["geometry"]["location"]["lng"]), 2),
                "type": "International" if any(w in p["name"] for w in ["International", "American", "British", "French"]) else "Public",
            }
            for p in raw_schools[:10]
        ]

        # Hospitals
        raw_hospitals = _fetch_places(lat, lng, "hospital", radius_m=3000)
        hospitals = [
            {
                "name": p["name"],
                "rating": p.get("rating", 0),
                "distance_km": round(_haversine_km(lat, lng, p["geometry"]["location"]["lat"], p["geometry"]["location"]["lng"]), 2),
                "tier": "Specialty" if any(w in p["name"] for w in ["Specialist", "Medical Center", "Medical Centre"]) else "General",
            }
            for p in raw_hospitals[:10]
        ]

        # Lifestyle categories
        raw_restaurants = _fetch_places(lat, lng, "restaurant",     radius_m=2000)
        raw_gyms        = _fetch_places(lat, lng, "gym",            radius_m=2000)
        raw_mosques     = _fetch_places(lat, lng, "mosque",         radius_m=1500)
        raw_malls       = _fetch_places(lat, lng, "shopping_mall",  radius_m=5000)
        raw_parks       = _fetch_places(lat, lng, "park",           radius_m=3000)

        def _places_list(raw, include_rating=True):
            out = []
            for p in raw[:5]:
                entry = {
                    "name": p["name"],
                    "distance_km": round(_haversine_km(lat, lng, p["geometry"]["location"]["lat"], p["geometry"]["location"]["lng"]), 2),
                }
                if include_rating:
                    entry["rating"] = p.get("rating", 0)
                out.append(entry)
            return out

        lifestyle = {
            "restaurants": {
                "count": len(raw_restaurants),
                "avg_rating": round(sum(r.get("rating", 0) for r in raw_restaurants) / max(1, len(raw_restaurants)), 1),
                "places": _places_list(raw_restaurants),
            },
            "gyms": {
                "count": len(raw_gyms),
                "avg_rating": round(sum(r.get("rating", 0) for r in raw_gyms) / max(1, len(raw_gyms)), 1),
                "places": _places_list(raw_gyms),
            },
            "mosques": {
                "count": len(raw_mosques),
                "avg_rating": None,
                "places": _places_list(raw_mosques, include_rating=False),
            },
            "malls": {
                "count": len(raw_malls),
                "avg_rating": round(sum(r.get("rating", 0) for r in raw_malls) / max(1, len(raw_malls)), 1),
                "places": _places_list(raw_malls),
            },
            "parks": {
                "count": len(raw_parks),
                "avg_rating": round(sum(r.get("rating", 0) for r in raw_parks) / max(1, len(raw_parks)), 1) if raw_parks else None,
                "places": _places_list(raw_parks),
            },
        }

        # Commute
        commute_minutes = _fetch_commute_minutes(lat, lng, city_centre[0], city_centre[1])

        # Scores
        school_score = round(_compute_school_score(schools), 1)
        healthcare_score = round(_compute_healthcare_score(hospitals), 1)
        lifestyle_score = round(_compute_lifestyle_score(lifestyle), 1)
        traffic_score = round(_compute_traffic_score(commute_minutes), 1)
        family_score = round(0.35 * school_score + 0.30 * healthcare_score + 0.20 * lifestyle_score + 0.15 * traffic_score, 1)
        area_score = round(0.30 * school_score + 0.25 * healthcare_score + 0.25 * traffic_score + 0.20 * lifestyle_score, 1)

        # Persist
        row.schools = schools
        row.hospitals = hospitals
        row.lifestyle = lifestyle
        row.commute_minutes_to_center = commute_minutes
        row.school_score = school_score
        row.healthcare_score = healthcare_score
        row.lifestyle_score = lifestyle_score
        row.traffic_score = traffic_score
        row.family_score = family_score
        row.area_score = area_score
        row.last_refreshed_at = datetime.now(timezone.utc)
        db.commit()

        from app.core.cache import CacheService
        cache = CacheService()
        cache.delete("area-intel", "list")
        cache.delete("area-intel-detail", f"{row.area_name.lower()}:{(row.city or '').lower()}")

        logger.info(f"Refreshed: {row.area_name} ({row.city}) — area={area_score}, family={family_score}")

    except Exception as exc:
        logger.error(f"Failed to refresh {row.area_name}: {exc}")
        db.rollback()




def refresh_all() -> None:
    """Called weekly by cron. Refreshes districts that have coordinates set
    and currently have at least one published listing on the platform —
    no point spending Google API calls on districts nobody can search in."""
    from app.core.locks import pg_advisory_lock
    from app.models.property import Property

    db = SessionLocal()
    try:
        with pg_advisory_lock(db, _LOCK_KEY) as acquired:
            if not acquired:
                logger.info("Weekly refresh already running on another worker, skipping")
                return

            listed_pairs = (
                db.query(Property.area, Property.city)
                .filter(Property.status == "Published")
                .distinct()
                .all()
            )
            listed = {(area.strip().lower(), city.strip().lower()) for area, city in listed_pairs}

            rows = db.query(AreaIntelligence).filter(
                AreaIntelligence.center_lat.isnot(None),
                AreaIntelligence.center_lng.isnot(None),
            ).all()
            rows = [r for r in rows if (r.area_name.strip().lower(), (r.city or "").strip().lower()) in listed]

            logger.info(f"Starting weekly refresh for {len(rows)} districts with published listings")
            for row in rows:
                _refresh_district(row, db)
                time.sleep(0.5)  # respect Google API rate limits
            logger.info("Weekly refresh complete")
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    refresh_all()
