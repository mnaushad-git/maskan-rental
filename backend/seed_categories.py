"""
Seed script — sample listings for every property category, for both Rent
and Sale, so every filter chip and map pin has real data behind it.

Categories mirror the Rent/Sale tabs in the search UI:
  Rent:  Apartment, Villa, Big Flat, Building, Land, Store, Office
         + More: Chalet, Complex, Factory, Farm, Hotel, Kiosk, Lounge,
                  Parking, Room, School, Station, Tower, Warehouse, Workshop
  Sale:  Apartment, Villa, Land, Floor, Building, Lounge
         + More: Chalet, Complex, Factory, Farm, Hotel, Kiosk, Parking,
                  Room, School, Station, Tower, Warehouse, Workshop

Run from backend/ directory:
    python seed_categories.py

Safe to re-run: existing records are UPDATED in-place (upsert on external_id).
"""

import itertools
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select

from app.db.session import SessionLocal
import app.models  # noqa: F401 — registers all models so relationship strings resolve
from app.models.property import Property

# ── District pool (must match frontend/src/lib/geo.ts so map pins resolve) ──
DISTRICTS = [
    ("Al Yasmin", "Riyadh"), ("Al Narjis", "Riyadh"), ("Al Malqa", "Riyadh"),
    ("Al Olaya", "Riyadh"), ("Al Rawdah", "Riyadh"), ("Al Faisaliyah", "Riyadh"),
    ("University District", "Riyadh"), ("Hitteen", "Riyadh"), ("Al Sahafah", "Riyadh"),
    ("Al Nakheel", "Riyadh"), ("Diplomatic Quarter", "Riyadh"), ("Qurtuba", "Riyadh"),
    ("Al Sulimaniyah", "Riyadh"),
    ("Al Hamra", "Jeddah"), ("Al Zahraa", "Jeddah"), ("Obhur Al Shamaliyah", "Jeddah"),
    ("Al Khalidiyyah", "Jeddah"), ("Al Andalus", "Jeddah"),
    ("Al Faisaliyyah", "Dammam"), ("Al Adamah", "Dammam"), ("Al Nuzha", "Dammam"),
    ("Al Aqrabiyah", "Khobar"), ("Al Thuqbah", "Khobar"),
    ("Al Khalidiyya", "Madinah"), ("Al Aziziyya", "Madinah"),
]
_district_cycle = itertools.cycle(DISTRICTS)

_IMG_RESIDENTIAL = [
    "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=900&q=80",
]
_IMG_COMMERCIAL = [
    "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1541746972996-4e0b0f43e02a?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=900&q=80",
]
_IMG_LAND = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=900&q=80"
_IMG_HOTEL = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80"
_IMG_WAREHOUSE = "https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=900&q=80"
_img_cycle_res = itertools.cycle(_IMG_RESIDENTIAL)
_img_cycle_com = itertools.cycle(_IMG_COMMERCIAL)

# type: (rent_range | None, sale_range | None, has_bedrooms, size_range, image_pool)
CATEGORY_CONFIG = {
    "Apartment":   ((3500, 12000),   (350_000, 1_200_000), True,  (90, 220),    "res"),
    "Villa":       ((9000, 25000),   (950_000, 3_500_000), True,  (300, 700),   "res"),
    "Big Flat":    ((6000, 16000),   None,                 True,  (200, 350),   "res"),
    "Floor":       (None,            (550_000, 1_400_000), True,  (220, 400),   "res"),
    "Chalet":      ((4000, 9000),    (500_000, 1_300_000), True,  (120, 250),   "res"),
    "Room":        ((800, 2500),     (80_000, 250_000),    False, (15, 30),     "res"),
    "Building":    ((20000, 70000),  (2_500_000, 9_000_000), False, (600, 2000), "com"),
    "Land":        ((3000, 15000),   (400_000, 6_000_000), False, (300, 3000),  "land"),
    "Store":       ((2500, 9000),    None,                 False, (40, 150),    "com"),
    "Office":      ((3000, 15000),   None,                 False, (60, 300),    "com"),
    "Complex":     ((25000, 80000),  (3_000_000, 12_000_000), False, (800, 3000), "com"),
    "Factory":     ((15000, 50000),  (2_000_000, 8_000_000), False, (500, 2500), "warehouse"),
    "Farm":        ((5000, 20000),   (600_000, 3_000_000), False, (2000, 10000), "land"),
    "Hotel":       ((40000, 150000), (5_000_000, 25_000_000), False, (1000, 5000), "hotel"),
    "Kiosk":       ((1500, 4000),    (100_000, 300_000),   False, (5, 15),      "com"),
    "Lounge":      ((8000, 25000),   (1_000_000, 4_000_000), False, (200, 600), "com"),
    "Parking":     ((300, 1200),     (30_000, 120_000),    False, (12, 25),     "com"),
    "School":      ((20000, 60000),  (3_000_000, 10_000_000), False, (1500, 5000), "com"),
    "Station":     ((10000, 40000),  (1_500_000, 6_000_000), False, (300, 1200), "com"),
    "Tower":       ((50000, 200000), (8_000_000, 30_000_000), False, (2000, 8000), "com"),
    "Warehouse":   ((8000, 30000),   (1_000_000, 5_000_000), False, (500, 3000), "warehouse"),
    "Workshop":    ((4000, 15000),   (500_000, 2_000_000),  False, (100, 500),  "warehouse"),
}

RENT_TYPES = [
    "Apartment", "Villa", "Big Flat", "Building", "Land", "Store", "Office",
    "Chalet", "Complex", "Factory", "Farm", "Hotel", "Kiosk", "Lounge",
    "Parking", "Room", "School", "Station", "Tower", "Warehouse", "Workshop",
]
SALE_TYPES = [
    "Apartment", "Villa", "Land", "Floor", "Building", "Lounge",
    "Chalet", "Complex", "Factory", "Farm", "Hotel", "Kiosk",
    "Parking", "Room", "School", "Station", "Tower", "Warehouse", "Workshop",
]

SAMPLES_PER_COMBO = 2


def _image_for(pool: str) -> str:
    if pool == "res":
        return next(_img_cycle_res)
    if pool == "land":
        return _IMG_LAND
    if pool == "hotel":
        return _IMG_HOTEL
    if pool == "warehouse":
        return _IMG_WAREHOUSE
    return next(_img_cycle_com)


def _spread(lo: float, hi: float, i: int, n: int) -> float:
    """Deterministic value spread across [lo, hi] for sample i of n."""
    if n <= 1:
        return round((lo + hi) / 2, -2)
    frac = i / (n - 1)
    return round((lo + (hi - lo) * frac), -2)


def build_listings() -> list[dict]:
    listings = []
    for listing_type, types in (("rent", RENT_TYPES), ("sale", SALE_TYPES)):
        for prop_type in types:
            rent_range, sale_range, has_bedrooms, size_range, img_pool = CATEGORY_CONFIG[prop_type]
            price_range = rent_range if listing_type == "rent" else sale_range
            if price_range is None:
                continue  # this type isn't offered for this listing_type

            for i in range(SAMPLES_PER_COMBO):
                district, city = next(_district_cycle)
                price = _spread(price_range[0], price_range[1], i, SAMPLES_PER_COMBO)
                size = int(_spread(size_range[0], size_range[1], i, SAMPLES_PER_COMBO))
                bedrooms = (2 + i) if has_bedrooms else None
                bathrooms = (1 + i) if has_bedrooms else None

                verb = "for Rent" if listing_type == "rent" else "for Sale"
                title = f"{prop_type} {verb} — {district}"
                external_id = f"MSK-CAT-{prop_type.replace(' ', '')}-{listing_type.upper()}-{i + 1}"

                listing = {
                    "external_id": external_id,
                    "title": title,
                    "area": district,
                    "city": city,
                    "size_sq_m": size,
                    "listing_type": listing_type,
                    "monthly_rent": price if listing_type == "rent" else None,
                    "sale_price": price if listing_type == "sale" else None,
                    "bedrooms": bedrooms,
                    "bathrooms": bathrooms,
                    "owner_name": "Maskan Verified Owner",
                    "status": "Published",
                    "image_url": _image_for(img_pool),
                    "property_type": prop_type,
                    "furnished": "Semi-furnished" if has_bedrooms else None,
                    "description": (
                        f"{prop_type} available {verb.lower()} in {district}, {city}. "
                        f"Approx. {size} m². Listed by a Maskan-verified owner."
                    ),
                }
                listings.append(listing)
    return listings


def main():
    db = SessionLocal()
    inserted = 0
    updated = 0
    try:
        for data in build_listings():
            existing = db.scalars(
                select(Property).where(Property.external_id == data["external_id"])
            ).first()
            if existing:
                for field, value in data.items():
                    setattr(existing, field, value)
                updated += 1
            else:
                db.add(Property(**data))
                inserted += 1
        db.commit()
        print(f"Done. Inserted {inserted}, updated {updated}, total {inserted + updated} category listings.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
