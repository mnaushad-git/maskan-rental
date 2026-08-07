"""
Seed script — demo off-plan/new-development "Projects" (developer-built,
multi-unit developments), distinct from the individual-listing Property
seed in seed.py. Districts are chosen to overlap with seed.py/
seed_area_intelligence.py's Riyadh districts so the map pin and "Nearby
Landmarks" section have real data to show.

Run from backend/ directory:
    python seed_projects.py

Safe to re-run: existing records are UPDATED in-place (upsert on external_id).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select

from app.db.session import SessionLocal
import app.models  # noqa: F401 — registers all models so relationship strings resolve
from app.models.project import Project, ProjectUnit, ProjectImage

_IMG = {
    "exterior_1": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80",
    "exterior_2": "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=900&q=80",
    "exterior_3": "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=900&q=80",
    "interior_1": "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=80",
    "interior_2": "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80",
    "aerial_1": "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=900&q=80",
}

PROJECTS = [
    {
        "external_id": "PRJ-001",
        "title": "Maher 10",
        "city": "Riyadh",
        "area": "Al Yasmin",
        "property_category": "Floor",
        "completion_status": "Ready",
        "status": "Available",
        "developer_name": "Maher Real Estate",
        "unit_count": 40,
        "area_min": 305,
        "area_max": 305,
        "price_min": 2399000,
        "price_max": 2399000,
        "is_featured": True,
        "image_url": _IMG["exterior_1"],
        "intro_document_url": "https://example.com/maher-10-brochure.pdf",
        "description": (
            "First Floor with a Modern Design\n\n"
            "Built to high-quality standards with attention to the finest details. "
            "Features: Private parking (1), Balcony (1), Majlis (2), Living room (1), Kitchen (1), "
            "Dining area (1), Laundry room (1), Maid's room (1), Master bedrooms (4), Bathroom (1).\n\n"
            "Technical Features: Smart entry system, Surveillance cameras.\n\n"
            "Utilities & Services: Independent electricity meter, Independent water meter, "
            "Private underground and overhead water tanks.\n\n"
            "Warranty & Quality Assurance: 10-year insurance covering structural integrity and hidden "
            "defects, Engineering supervision throughout all construction stages, Comprehensive "
            "warranties (electrical, plumbing, insulation, water tanks, internal and external finishes)."
        ),
        "images": [_IMG["exterior_1"], _IMG["interior_1"], _IMG["interior_2"], _IMG["exterior_2"]],
        "units": [
            {"unit_type": "Floor", "price": 2399000, "area_sq_m": 305, "bedrooms": 4, "bathrooms": 4, "living_rooms": 1},
        ],
    },
    {
        "external_id": "PRJ-002",
        "title": "Raye Al Mughrizat",
        "city": "Riyadh",
        "area": "Al Malqa",
        "property_category": "Apartment",
        "completion_status": "Ready",
        "status": "Available",
        "developer_name": "Raye Developments",
        "unit_count": 24,
        "area_min": 140,
        "area_max": 220,
        "price_min": 1400000,
        "price_max": 2100000,
        "is_featured": True,
        "image_url": _IMG["exterior_2"],
        "description": (
            "A boutique apartment development in Al Malqa with a mix of 2- and 3-bedroom units, "
            "underground parking, and a shared rooftop terrace. Finishing: Lux. Year built: 2024.\n\n"
            "Key features: Central A/C, smart home entry, private storage per unit, backup generator, "
            "24-hour security."
        ),
        "images": [_IMG["exterior_2"], _IMG["interior_1"], _IMG["aerial_1"]],
        "units": [
            {"unit_type": "Apartment", "price": 1400000, "area_sq_m": 140, "bedrooms": 2, "bathrooms": 2, "living_rooms": 1},
            {"unit_type": "Apartment", "price": 1850000, "area_sq_m": 185, "bedrooms": 3, "bathrooms": 3, "living_rooms": 1},
            {"unit_type": "Apartment", "price": 2100000, "area_sq_m": 220, "bedrooms": 3, "bathrooms": 3, "living_rooms": 2},
        ],
    },
    {
        "external_id": "PRJ-003",
        "title": "Olaya Heights Towers",
        "city": "Riyadh",
        "area": "Al Olaya",
        "property_category": "Apartment",
        "completion_status": "Under Construction",
        "status": "Available",
        "developer_name": "Heights Development Co.",
        "unit_count": 60,
        "area_min": 110,
        "area_max": 260,
        "price_min": 980000,
        "price_max": 2650000,
        "is_featured": False,
        "image_url": _IMG["aerial_1"],
        "description": (
            "A twin-tower residential project in the heart of Al Olaya, walking distance to King Fahd "
            "Road's business district. Expected handover Q4 2027. Studio, 1-, 2-, and 3-bedroom layouts "
            "available.\n\n"
            "Amenities: gym, pool, co-working lounge, dedicated visitor parking, retail podium."
        ),
        "images": [_IMG["aerial_1"], _IMG["exterior_3"], _IMG["interior_2"]],
        "units": [
            {"unit_type": "Apartment", "price": 980000, "area_sq_m": 110, "bedrooms": 1, "bathrooms": 1, "living_rooms": 1},
            {"unit_type": "Apartment", "price": 1650000, "area_sq_m": 175, "bedrooms": 2, "bathrooms": 2, "living_rooms": 1},
            {"unit_type": "Penthouse", "price": 2650000, "area_sq_m": 260, "bedrooms": 3, "bathrooms": 3, "living_rooms": 2},
        ],
    },
    {
        "external_id": "PRJ-004",
        "title": "Yasmin Villas Compound",
        "city": "Riyadh",
        "area": "Al Yasmin",
        "property_category": "Villa",
        "completion_status": "Ready",
        "status": "Available",
        "developer_name": "Maher Real Estate",
        "unit_count": 18,
        "area_min": 400,
        "area_max": 520,
        "price_min": 2900000,
        "price_max": 3800000,
        "is_featured": False,
        "image_url": _IMG["exterior_3"],
        "description": (
            "A fully-gated 18-villa compound in Al Yasmin with 24-hour security, shared pool, gym, and "
            "children's play area. Each villa has a private garden and 3-car garage. Finishing: Super Lux.\n\n"
            "Key features: Smart home automation, solar water heater, VRV central A/C, maid's and "
            "driver's rooms."
        ),
        "images": [_IMG["exterior_3"], _IMG["interior_1"], _IMG["exterior_1"]],
        "units": [
            {"unit_type": "Villa", "price": 2900000, "area_sq_m": 400, "bedrooms": 4, "bathrooms": 5, "living_rooms": 2},
            {"unit_type": "Villa", "price": 3800000, "area_sq_m": 520, "bedrooms": 5, "bathrooms": 6, "living_rooms": 2},
        ],
    },
    {
        "external_id": "PRJ-005",
        "title": "Malqa Business Residences",
        "city": "Riyadh",
        "area": "Al Malqa",
        "property_category": "Floor",
        "completion_status": "Ready",
        "status": "Available",
        "developer_name": "Raye Developments",
        "unit_count": 30,
        "area_min": 260,
        "area_max": 340,
        "price_min": 1950000,
        "price_max": 2450000,
        "is_featured": False,
        "image_url": _IMG["interior_2"],
        "description": (
            "Full-floor residences above a ground-level retail podium in Al Malqa. Each floor is a "
            "private single-unit layout with its own lift lobby. Finishing: Lux. Year built: 2023.\n\n"
            "Key features: Independent electricity and water meters, private roof access, two entrances."
        ),
        "images": [_IMG["interior_2"], _IMG["exterior_2"]],
        "units": [
            {"unit_type": "Floor", "price": 1950000, "area_sq_m": 260, "bedrooms": 3, "bathrooms": 3, "living_rooms": 1},
            {"unit_type": "Floor", "price": 2450000, "area_sq_m": 340, "bedrooms": 4, "bathrooms": 4, "living_rooms": 2},
        ],
    },
]


def seed():
    db = SessionLocal()
    inserted = 0
    updated = 0

    try:
        for raw in PROJECTS:
            data = {k: v for k, v in raw.items() if k not in ("units", "images")}
            existing = db.scalars(
                select(Project).where(Project.external_id == data["external_id"])
            ).first()

            if existing:
                for key, value in data.items():
                    setattr(existing, key, value)
                project = existing
                # Replace units/images on re-seed rather than accumulating duplicates.
                for unit in list(project.units):
                    db.delete(unit)
                for image in list(project.images):
                    db.delete(image)
                db.flush()
                updated += 1
            else:
                project = Project(**data)
                db.add(project)
                db.flush()
                inserted += 1

            for unit_data in raw.get("units", []):
                db.add(ProjectUnit(project_id=project.id, **unit_data))
            for order, url in enumerate(raw.get("images", [])):
                db.add(ProjectImage(project_id=project.id, url=url, display_order=order))

        db.commit()
        print(f"Seed complete — {inserted} inserted, {updated} updated.")

    except Exception as exc:
        db.rollback()
        print(f"Seed failed: {exc}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
