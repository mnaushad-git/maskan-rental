"""
Seed the area_intelligence table with the 8 known districts.
Coordinates and initial scores come from the existing static frontend data.
Run once: python seed_area_intelligence.py
The nightly refresh job will overwrite scores with real Google API data once keys are set.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.db.session import SessionLocal
from app.models.area_intelligence import AreaIntelligence

DISTRICTS = [
    {
        "area_name": "Al Yasmin",
        "city": "Riyadh",
        "center_lat": 24.8230,
        "center_lng": 46.6730,
        "schools": [
            {"name": "Multinational School Riyadh", "rating": 9.4, "type": "International", "distance_km": 0.8},
            {"name": "Al Yasmin Public Boys", "rating": 8.1, "type": "Public", "distance_km": 1.2},
            {"name": "Manarat Al Riyadh", "rating": 8.8, "type": "Private", "distance_km": 1.5},
        ],
        "hospitals": [
            {"name": "Kingdom Hospital", "tier": "General", "rating": 9.1, "distance_km": 1.1},
            {"name": "Dr. Sulaiman Al Habib — Al Yasmin", "tier": "Specialty", "rating": 9.3, "distance_km": 0.9},
        ],
        "lifestyle": {"restaurants": {"count": 38, "avg_rating": 4.2}, "gyms": {"count": 7, "avg_rating": 4.0}, "mosques": {"count": 11, "avg_rating": None}, "malls": {"count": 2, "avg_rating": 4.4}},
        "commute_minutes_to_center": 28,
        "school_score": 90.0, "healthcare_score": 86.0, "lifestyle_score": 78.0,
        "traffic_score": 78.0, "family_score": 84.0, "area_score": 83.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 108000}, {"year": "2022", "avg_rent_annual": 118000}, {"year": "2023", "avg_rent_annual": 126000}, {"year": "2024", "avg_rent_annual": 130000}, {"year": "2025", "avg_rent_annual": 135000}],
        "tags": ["Family Friendly", "Luxury"],
        "overview": "Premium north Riyadh district with mature compounds, top-rated international schools and strong family demand.",
        "market_notes": ["Compound supply tightening — vacancy under 4%.", "Top performer for 3+ bedroom family rentals."],
    },
    {
        "area_name": "Al Narjis",
        "city": "Riyadh",
        "center_lat": 24.8450,
        "center_lng": 46.6920,
        "schools": [
            {"name": "Najd National Schools", "rating": 8.2, "type": "Private", "distance_km": 1.0},
            {"name": "Al Narjis Intermediate", "rating": 7.6, "type": "Public", "distance_km": 0.7},
        ],
        "hospitals": [
            {"name": "Specialized Medical Center", "tier": "General", "rating": 8.4, "distance_km": 1.4},
            {"name": "Al Narjis Polyclinic", "tier": "Specialty", "rating": 7.9, "distance_km": 0.8},
        ],
        "lifestyle": {"restaurants": {"count": 29, "avg_rating": 4.0}, "gyms": {"count": 5, "avg_rating": 3.8}, "mosques": {"count": 9, "avg_rating": None}, "malls": {"count": 1, "avg_rating": 4.1}},
        "commute_minutes_to_center": 24,
        "school_score": 84.0, "healthcare_score": 80.0, "lifestyle_score": 64.0,
        "traffic_score": 82.0, "family_score": 78.0, "area_score": 78.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 74000}, {"year": "2022", "avg_rent_annual": 82000}, {"year": "2023", "avg_rent_annual": 88000}, {"year": "2024", "avg_rent_annual": 93000}, {"year": "2025", "avg_rent_annual": 98000}],
        "tags": ["Family Friendly", "Affordable"],
        "overview": "Best-value family district in north Riyadh. Strong rental yield with rapid infrastructure rollout.",
        "market_notes": ["Highest YoY rent growth in North Riyadh corridor.", "Watch: new metro feeder bus line opening Q3."],
    },
    {
        "area_name": "Al Malqa",
        "city": "Riyadh",
        "center_lat": 24.8100,
        "center_lng": 46.6370,
        "schools": [
            {"name": "King Faisal School", "rating": 9.6, "type": "Private", "distance_km": 0.5},
            {"name": "Al Malqa International", "rating": 9.2, "type": "International", "distance_km": 1.1},
        ],
        "hospitals": [
            {"name": "King Faisal Specialist Hospital", "tier": "Specialty", "rating": 9.7, "distance_km": 1.8},
        ],
        "lifestyle": {"restaurants": {"count": 22, "avg_rating": 4.3}, "gyms": {"count": 6, "avg_rating": 4.1}, "mosques": {"count": 8, "avg_rating": None}, "malls": {"count": 3, "avg_rating": 4.5}},
        "commute_minutes_to_center": 32,
        "school_score": 92.0, "healthcare_score": 90.0, "lifestyle_score": 86.0,
        "traffic_score": 70.0, "family_score": 88.0, "area_score": 85.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 152000}, {"year": "2022", "avg_rent_annual": 160000}, {"year": "2023", "avg_rent_annual": 168000}, {"year": "2024", "avg_rent_annual": 172000}, {"year": "2025", "avg_rent_annual": 178000}],
        "tags": ["Luxury", "Family Friendly"],
        "overview": "Premium compounds, embassies and elite schools. Lower turnover with sticky long-term tenants.",
        "market_notes": ["Premium compound waitlists 4-6 months.", "Traffic congestion on King Salman Rd peak hours."],
    },
    {
        "area_name": "Al Olaya",
        "city": "Riyadh",
        "center_lat": 24.6950,
        "center_lng": 46.6860,
        "schools": [
            {"name": "Olaya Schools Complex", "rating": 7.8, "type": "Public", "distance_km": 1.0},
        ],
        "hospitals": [
            {"name": "Saudi German Hospital — Olaya", "tier": "General", "rating": 8.9, "distance_km": 0.6},
        ],
        "lifestyle": {"restaurants": {"count": 55, "avg_rating": 4.1}, "gyms": {"count": 12, "avg_rating": 4.0}, "mosques": {"count": 6, "avg_rating": None}, "malls": {"count": 4, "avg_rating": 4.3}},
        "commute_minutes_to_center": 15,
        "traffic_score": 60.0, "school_score": 78.0, "healthcare_score": 88.0,
        "lifestyle_score": 98.0, "family_score": 80.0, "area_score": 82.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 132000}, {"year": "2022", "avg_rent_annual": 136000}, {"year": "2023", "avg_rent_annual": 140000}, {"year": "2024", "avg_rent_annual": 142000}, {"year": "2025", "avg_rent_annual": 145000}],
        "tags": ["Business Hub", "Walkable"],
        "overview": "Central business spine with strong professional tenant base and metro access.",
        "market_notes": ["Demand led by corporate relocations.", "Studio + 1BR vacancy compressing."],
    },
    {
        "area_name": "Al Shati",
        "city": "Jeddah",
        "center_lat": 21.5990,
        "center_lng": 39.1080,
        "schools": [
            {"name": "Jeddah Knowledge International", "rating": 9.0, "type": "International", "distance_km": 1.2},
        ],
        "hospitals": [
            {"name": "International Medical Center", "tier": "General", "rating": 9.2, "distance_km": 1.5},
        ],
        "lifestyle": {"restaurants": {"count": 31, "avg_rating": 4.3}, "gyms": {"count": 8, "avg_rating": 4.0}, "mosques": {"count": 7, "avg_rating": None}, "malls": {"count": 2, "avg_rating": 4.4}},
        "commute_minutes_to_center": 22,
        "school_score": 80.0, "healthcare_score": 84.0, "lifestyle_score": 72.0,
        "traffic_score": 74.0, "family_score": 79.0, "area_score": 78.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 142000}, {"year": "2022", "avg_rent_annual": 150000}, {"year": "2023", "avg_rent_annual": 158000}, {"year": "2024", "avg_rent_annual": 162000}, {"year": "2025", "avg_rent_annual": 168000}],
        "tags": ["Family Friendly", "Luxury"],
        "overview": "Coastal villa & townhouse district with private beach access and corniche frontage.",
        "market_notes": ["Seasonal premium during summer holidays."],
    },
    {
        "area_name": "Al Rawdah",
        "city": "Jeddah",
        "center_lat": 21.5580,
        "center_lng": 39.1350,
        "schools": [
            {"name": "Manarat Jeddah", "rating": 8.5, "type": "Private", "distance_km": 0.9},
        ],
        "hospitals": [
            {"name": "Dr. Erfan & Bagedo Hospital", "tier": "General", "rating": 8.6, "distance_km": 1.1},
        ],
        "lifestyle": {"restaurants": {"count": 26, "avg_rating": 4.0}, "gyms": {"count": 4, "avg_rating": 3.7}, "mosques": {"count": 9, "avg_rating": None}, "malls": {"count": 1, "avg_rating": 4.0}},
        "commute_minutes_to_center": 25,
        "school_score": 86.0, "healthcare_score": 82.0, "lifestyle_score": 60.0,
        "traffic_score": 68.0, "family_score": 76.0, "area_score": 74.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 102000}, {"year": "2022", "avg_rent_annual": 108000}, {"year": "2023", "avg_rent_annual": 115000}, {"year": "2024", "avg_rent_annual": 119000}, {"year": "2025", "avg_rent_annual": 124000}],
        "tags": ["Family Friendly", "Affordable"],
        "overview": "Mid-market Jeddah favourite — strong school catchment and easy corniche access.",
        "market_notes": ["Family demand outpacing supply for 4BR villas."],
    },
    {
        "area_name": "Al Faisaliyah",
        "city": "Dammam",
        "center_lat": 26.4280,
        "center_lng": 50.0980,
        "schools": [
            {"name": "Dhahran Ahliyya Schools", "rating": 8.7, "type": "Private", "distance_km": 1.3},
        ],
        "hospitals": [
            {"name": "Saad Specialist Hospital", "tier": "Specialty", "rating": 8.4, "distance_km": 2.0},
        ],
        "lifestyle": {"restaurants": {"count": 18, "avg_rating": 3.9}, "gyms": {"count": 3, "avg_rating": 3.6}, "mosques": {"count": 12, "avg_rating": None}, "malls": {"count": 1, "avg_rating": 3.8}},
        "commute_minutes_to_center": 18,
        "school_score": 76.0, "healthcare_score": 80.0, "lifestyle_score": 52.0,
        "traffic_score": 86.0, "family_score": 74.0, "area_score": 74.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 68000}, {"year": "2022", "avg_rent_annual": 72000}, {"year": "2023", "avg_rent_annual": 78000}, {"year": "2024", "avg_rent_annual": 82000}, {"year": "2025", "avg_rent_annual": 86000}],
        "tags": ["Affordable", "Family Friendly"],
        "overview": "Affordable family district close to Aramco corridor with quick highway access.",
        "market_notes": ["Aramco contractor demand pushing 3BR rents."],
    },
    {
        "area_name": "University District",
        "city": "Dammam",
        "center_lat": 26.3620,
        "center_lng": 50.1280,
        "schools": [
            {"name": "Imam Abdulrahman Bin Faisal University", "rating": 9.1, "type": "Public", "distance_km": 0.3},
        ],
        "hospitals": [
            {"name": "IAU Teaching Hospital", "tier": "General", "rating": 8.3, "distance_km": 0.5},
        ],
        "lifestyle": {"restaurants": {"count": 20, "avg_rating": 3.8}, "gyms": {"count": 2, "avg_rating": 3.5}, "mosques": {"count": 8, "avg_rating": None}, "malls": {"count": 0, "avg_rating": None}},
        "commute_minutes_to_center": 22,
        "school_score": 88.0, "healthcare_score": 78.0, "lifestyle_score": 44.0,
        "traffic_score": 80.0, "family_score": 73.0, "area_score": 74.0,
        "rent_trend": [{"year": "2021", "avg_rent_annual": 44000}, {"year": "2022", "avg_rent_annual": 46000}, {"year": "2023", "avg_rent_annual": 48000}, {"year": "2024", "avg_rent_annual": 50000}, {"year": "2025", "avg_rent_annual": 52000}],
        "tags": ["Student Area", "Affordable"],
        "overview": "Adjacent to IAU campus — student rentals, studios and shared apartments dominate supply.",
        "market_notes": ["Seasonal: 70% turnover at academic year start."],
    },
]


def seed():
    db = SessionLocal()
    try:
        inserted = 0
        updated = 0
        for d in DISTRICTS:
            existing = db.query(AreaIntelligence).filter(
                AreaIntelligence.area_name == d["area_name"],
                AreaIntelligence.city == d["city"],
            ).first()
            if existing:
                for k, v in d.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                db.add(AreaIntelligence(**d))
                inserted += 1
        db.commit()
        print(f"Area intelligence seeded: {inserted} inserted, {updated} updated")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
