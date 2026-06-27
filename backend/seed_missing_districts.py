"""Add missing Riyadh districts to area_intelligence so property pages can show data."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.db.session import SessionLocal
from app.models.area_intelligence import AreaIntelligence

EMPTY_LIFESTYLE = {
    "restaurants": {"count": 0, "avg_rating": None, "places": []},
    "gyms":        {"count": 0, "avg_rating": None, "places": []},
    "mosques":     {"count": 0, "avg_rating": None, "places": []},
    "malls":       {"count": 0, "avg_rating": None, "places": []},
}

DISTRICTS = [
    {"area_name": "Al Nakheel",         "city": "Riyadh", "center_lat": 24.7985, "center_lng": 46.6795, "tags": ["Family Friendly"], "overview": "Established residential district in northern Riyadh with good school access and quiet streets."},
    {"area_name": "Al Sahafah",         "city": "Riyadh", "center_lat": 24.7711, "center_lng": 46.6455, "tags": ["Affordable"],       "overview": "Affordable mid-density neighbourhood in northwest Riyadh, popular with mid-income families."},
    {"area_name": "Al Sulimaniyah",     "city": "Riyadh", "center_lat": 24.6836, "center_lng": 46.6973, "tags": ["Business Hub"],      "overview": "Central Riyadh business district with strong demand from professionals and corporate tenants."},
    {"area_name": "Diplomatic Quarter", "city": "Riyadh", "center_lat": 24.6942, "center_lng": 46.6158, "tags": ["Luxury"],            "overview": "Exclusive gated enclave housing embassies and high-end compounds — the most premium address in Riyadh."},
    {"area_name": "Hitteen",            "city": "Riyadh", "center_lat": 24.8175, "center_lng": 46.6502, "tags": ["Family Friendly"],   "overview": "Growing north Riyadh district with new developments, good schools, and family-oriented community feel."},
    {"area_name": "Qurtuba",            "city": "Riyadh", "center_lat": 24.7732, "center_lng": 46.6233, "tags": ["Affordable"],        "overview": "Well-connected northwest Riyadh neighbourhood with affordable villas and easy King Abdullah Road access."},
    {"area_name": "Al Rawdah",          "city": "Riyadh", "center_lat": 24.7803, "center_lng": 46.7224, "tags": ["Family Friendly"],   "overview": "Mature residential district in northeast Riyadh with strong community infrastructure and stable rents."},
    {"area_name": "Al Faisaliyah",      "city": "Riyadh", "center_lat": 24.6904, "center_lng": 46.6849, "tags": ["Business Hub"],      "overview": "Central Riyadh district anchored by Al Faisaliyah Tower — prime location for business and upscale living."},
]

RENT_TRENDS = {
    "Al Nakheel":         [108000, 115000, 120000, 124000, 128000],
    "Al Sahafah":         [72000,  76000,  80000,  83000,  86000],
    "Al Sulimaniyah":     [132000, 138000, 145000, 150000, 155000],
    "Diplomatic Quarter": [180000, 190000, 200000, 210000, 220000],
    "Hitteen":            [96000,  102000, 108000, 112000, 116000],
    "Qurtuba":            [84000,  88000,  92000,  96000,  99000],
    "Al Rawdah":          [90000,  95000,  100000, 104000, 108000],
    "Al Faisaliyah":      [144000, 150000, 158000, 165000, 170000],
}

db = SessionLocal()
try:
    added = 0
    for d in DISTRICTS:
        exists = db.query(AreaIntelligence).filter(
            AreaIntelligence.area_name == d["area_name"],
            AreaIntelligence.city == d["city"],
        ).first()
        if exists:
            print(f"  Already exists: {d['area_name']} ({d['city']})")
            continue

        rents = RENT_TRENDS[d["area_name"]]
        trend = [{"year": str(2021 + i), "avg_rent_annual": r} for i, r in enumerate(rents)]

        row = AreaIntelligence(
            area_name=d["area_name"],
            city=d["city"],
            center_lat=d["center_lat"],
            center_lng=d["center_lng"],
            schools=[],
            hospitals=[],
            lifestyle=EMPTY_LIFESTYLE,
            rent_trend=trend,
            tags=d["tags"],
            overview=d["overview"],
            market_notes=[],
        )
        db.add(row)
        added += 1
        print(f"  Added: {d['area_name']} ({d['city']})")
    db.commit()
    print(f"\nDone — {added} districts added.")
finally:
    db.close()
