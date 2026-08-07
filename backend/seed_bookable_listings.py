"""
Seed script — demo short-term "bookable stay" listings (is_bookable=True
properties with a real nightly_rate, elevator/AC flags, and Unit Rules),
distinct from the long-term-rent PROPERTIES in seed.py. Districts overlap
with seed.py/seed_area_intelligence.py's Riyadh districts so the map pin
and area-insight sections have real data.

Run from backend/ directory:
    python seed_bookable_listings.py

Safe to re-run: existing records are UPDATED in-place (upsert on external_id).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select

from app.db.session import SessionLocal
import app.models  # noqa: F401 — registers all models so relationship strings resolve
from app.models.property import Property
from app.models.listing_image import ListingImage

_IMG = {
    "living_1": "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=900&q=80",
    "living_2": "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=80",
    "bedroom_1": "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=900&q=80",
    "bedroom_2": "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=900&q=80",
    "kitchen_1": "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=900&q=80",
    "exterior_1": "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=900&q=80",
}

BOOKABLE_LISTINGS = [
    {
        "external_id": "BOOK-001",
        "title": "Apartment for booking — Al Qirawan",
        "area": "Al Qirawan",
        "city": "Riyadh",
        "size_sq_m": 100,
        "listing_type": "rent",
        "bedrooms": 3,
        "bathrooms": 2,
        "living_rooms": 2,
        "owner_name": "Nightly Stays Co.",
        "status": "Published",
        "property_type": "Apartment",
        "furnished": "Furnished",
        "nightly_rate": 1240,
        "is_bookable": True,
        "has_kitchen": True,
        "has_water": True,
        "has_electricity": True,
        "has_elevator": True,
        "has_airconditioners": True,
        "arrival_time": "01:00 pm",
        "departure_time": "12:00 pm",
        "latest_booking_time": "12:00 am",
        "insurance_amount": 0,
        "commission_percent": 0,
        "image_url": _IMG["living_1"],
        "description": (
            "Fully furnished 3-bedroom apartment available for short-term booking in Al Qirawan. "
            "Modern open-plan living area, fully equipped kitchen, and fast Wi-Fi throughout.\n\n"
            "Key features: Central A/C, elevator access, 24-hour maintenance line, weekly housekeeping "
            "available on request."
        ),
        "images": [_IMG["living_1"], _IMG["bedroom_1"], _IMG["kitchen_1"], _IMG["exterior_1"]],
    },
    {
        "external_id": "BOOK-002",
        "title": "Studio for booking — Al Yasmin",
        "area": "Al Yasmin",
        "city": "Riyadh",
        "size_sq_m": 45,
        "listing_type": "rent",
        "bedrooms": 1,
        "bathrooms": 1,
        "living_rooms": 1,
        "owner_name": "Nightly Stays Co.",
        "status": "Published",
        "property_type": "Apartment",
        "furnished": "Furnished",
        "nightly_rate": 358.80,
        "is_bookable": True,
        "has_kitchen": True,
        "has_water": True,
        "has_electricity": True,
        "has_elevator": True,
        "has_airconditioners": True,
        "arrival_time": "02:00 pm",
        "departure_time": "11:00 am",
        "latest_booking_time": "10:00 pm",
        "insurance_amount": 150,
        "commission_percent": 0,
        "image_url": _IMG["bedroom_2"],
        "description": (
            "Cozy studio in Al Yasmin, ideal for solo travelers or short business trips. Compact "
            "kitchenette, smart TV, and a private balcony.\n\n"
            "Key features: Central A/C, high-speed Wi-Fi, in-building gym access."
        ),
        "images": [_IMG["bedroom_2"], _IMG["living_2"], _IMG["kitchen_1"]],
    },
    {
        "external_id": "BOOK-003",
        "title": "2-Bedroom stay — Al Malqa",
        "area": "Al Malqa",
        "city": "Riyadh",
        "size_sq_m": 140,
        "listing_type": "rent",
        "bedrooms": 2,
        "bathrooms": 2,
        "living_rooms": 1,
        "owner_name": "Nightly Stays Co.",
        "status": "Published",
        "property_type": "Apartment",
        "furnished": "Furnished",
        "nightly_rate": 620,
        "is_bookable": True,
        "has_kitchen": True,
        "has_water": True,
        "has_electricity": True,
        "has_elevator": False,
        "has_airconditioners": True,
        "arrival_time": "03:00 pm",
        "departure_time": "12:00 pm",
        "latest_booking_time": "11:00 pm",
        "insurance_amount": 200,
        "commission_percent": 0,
        "image_url": _IMG["living_2"],
        "description": (
            "Bright 2-bedroom ground-floor unit in Al Malqa with private parking and a small garden "
            "patio. Great for families visiting Riyadh for a few nights.\n\n"
            "Key features: Central A/C, fully equipped kitchen, washer/dryer."
        ),
        "images": [_IMG["living_2"], _IMG["bedroom_1"], _IMG["exterior_1"]],
    },
    {
        "external_id": "BOOK-004",
        "title": "Apartment for booking — Al Olaya",
        "area": "Al Olaya",
        "city": "Riyadh",
        "size_sq_m": 120,
        "listing_type": "rent",
        "bedrooms": 2,
        "bathrooms": 2,
        "living_rooms": 1,
        "owner_name": "Nightly Stays Co.",
        "status": "Published",
        "property_type": "Apartment",
        "furnished": "Furnished",
        "nightly_rate": 890,
        "is_bookable": True,
        "has_kitchen": True,
        "has_water": True,
        "has_electricity": True,
        "has_elevator": True,
        "has_airconditioners": True,
        "arrival_time": "01:00 pm",
        "departure_time": "12:00 pm",
        "latest_booking_time": "12:00 am",
        "insurance_amount": 100,
        "commission_percent": 0,
        "image_url": _IMG["kitchen_1"],
        "description": (
            "Central Al Olaya apartment, walking distance to King Fahd Road's business district. "
            "Ideal for short business trips.\n\n"
            "Key features: Central A/C, elevator, dedicated workspace, high-speed Wi-Fi."
        ),
        "images": [_IMG["kitchen_1"], _IMG["living_1"], _IMG["bedroom_2"]],
    },
]


def seed():
    db = SessionLocal()
    inserted = 0
    updated = 0

    try:
        for raw in BOOKABLE_LISTINGS:
            data = {k: v for k, v in raw.items() if k != "images"}
            existing = db.scalars(
                select(Property).where(Property.external_id == data["external_id"])
            ).first()

            if existing:
                for key, value in data.items():
                    setattr(existing, key, value)
                prop = existing
                for image in list(prop.listing_images):
                    db.delete(image)
                db.flush()
                updated += 1
            else:
                prop = Property(**data)
                db.add(prop)
                db.flush()
                inserted += 1

            for order, url in enumerate(raw.get("images", [])):
                db.add(ListingImage(property_id=prop.id, url=url, display_order=order))

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
