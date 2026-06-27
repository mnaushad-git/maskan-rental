"""
Seed script — 25 Riyadh rental properties across 11 districts.
Data mirrors realistic Aqar-style listings (prices, sizes, descriptions).
Images sourced from Unsplash (free-to-use, no attribution required for dev).

Run from backend/ directory:
    python seed.py

Safe to re-run: existing records are UPDATED in-place (upsert on external_id).
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.property import Property
from app.models.user import User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ── Unsplash image pool (free-to-use, property/architecture shots) ─────────
# 10 images rotated across 25 properties by property type
_IMG = {
    "villa_white":      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80",
    "villa_pool":       "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=900&q=80",
    "villa_modern":     "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80",
    "villa_luxury":     "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=900&q=80",
    "villa_compound":   "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=900&q=80",
    "villa_sunset":     "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=900&q=80",
    "apt_interior":     "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=900&q=80",
    "apt_living":       "https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=900&q=80",
    "apt_modern":       "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=900&q=80",
    "penthouse_view":   "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=900&q=80",
}

PROPERTIES = [
    # ══════════════════════════════════════════════════════════════════════
    # AL YASMIN  —  North Riyadh, top-rated family district
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-001",
        "title": "5-Bed Super-Lux Villa — Al Yasmin Compound",
        "area": "Al Yasmin",
        "city": "Riyadh",
        "size_sq_m": 480,
        "monthly_rent": 17500,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Faisal Al-Harbi",
        "status": "Published",
        "image_url": _IMG["villa_white"],
        "description": (
            "Ref: MSK-001 | Finishing: Super Lux | Year built: 2022 | Floor: Ground + 1st\n\n"
            "Magnificent 5-bedroom villa inside a fully-managed, gated Al Yasmin compound with 24-hr security. "
            "Ground floor features a grand reception hall (majlis), formal dining room, open-plan family lounge, "
            "and a professional-grade kitchen with Italian marble countertops, built-in Siemens appliances, and a "
            "central island. Upper floor has 5 en-suite bedrooms; the master suite includes a walk-in dressing room "
            "and a rainfall shower. Additional rooms: driver's quarter with separate entrance, maid's room with private "
            "bath, and a home office study.\n\n"
            "Key features: Central A/C (VRV system) | Water softener & filter | Solar water heater | Smart home "
            "automation (lighting, curtains, A/C via app) | 3-car covered parking | Private walled garden with "
            "outdoor kitchen and seating area | Compound amenities: pool, gym, children's playground, mosque.\n\n"
            "Location: 3 min to Al Yasmin Park | 5 min to Yasmin Mall | School bus stops at compound gate | "
            "Close to GEMS International School and Al Nakheel Clinic. Annual rent: SAR 210,000. "
            "Payment: 2 cheques. Commission: one month."
        ),
    },
    {
        "external_id": "MSK-002",
        "title": "3-Bed Family Apartment — Al Yasmin, Floor 4",
        "area": "Al Yasmin",
        "city": "Riyadh",
        "size_sq_m": 195,
        "monthly_rent": 8200,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Noura Al-Qahtani",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-002 | Finishing: Lux | Year built: 2020 | Floor: 4th of 8\n\n"
            "Bright, corner 3-bedroom apartment on the 4th floor of a boutique residential building in Al Yasmin. "
            "The open-plan living and dining area connects to a wide balcony overlooking a tree-lined street. "
            "The kitchen is fully fitted with granite worktops and stainless-steel appliances. All three bedrooms "
            "are en-suite with built-in wardrobes. The master bedroom has a walk-in closet and a double vanity.\n\n"
            "Key features: Central A/C | Water softener | Building backup generator | 2 underground parking spaces "
            "| Storage room | Lift | CCTV and intercom | Masjid 200 m on foot.\n\n"
            "Location: 5 min drive to King Salman Road | Easy access to King Khalid International Airport (KKIA) | "
            "Walking distance to Al Yasmin supermarkets and cafes. Annual rent: SAR 98,400. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-003",
        "title": "4-Bed Premium Villa — Al Yasmin, Private Garden",
        "area": "Al Yasmin",
        "city": "Riyadh",
        "size_sq_m": 380,
        "monthly_rent": 14500,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Omar Bin Saleh",
        "status": "Published",
        "image_url": _IMG["villa_compound"],
        "description": (
            "Ref: MSK-003 | Finishing: Super Lux | Year built: 2021 | Stand-alone villa\n\n"
            "Elegant 4-bedroom stand-alone villa on a 650 sqm plot in a quiet Al Yasmin cul-de-sac. "
            "Ground floor: double-height entrance hall, formal majlis with separate entrance, family lounge, "
            "dining room, large kitchen, and a garden-facing guest suite. Upper floor: 3 en-suite bedrooms including "
            "a master suite with a private terrace, dressing area, and a soaking tub.\n\n"
            "Key features: Central A/C | Water softener | Automatic gate | 2-car garage + driveway for 2 more | "
            "Private landscaped garden with palm trees, BBQ area, and children's play equipment | Maid's room | "
            "Driver's room | Solar water heater | Fibre internet ready.\n\n"
            "Location: 4 min to Al Yasmin Park | 7 min to Riyadh Park Mall | Near Manarat Riyadh School. "
            "Annual rent: SAR 174,000. Payment: 2–4 cheques. Available: immediately."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL NARJIS  —  North Riyadh, best rental value per sqm
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-004",
        "title": "4-Bed Compound Villa — Al Narjis, Shared Pool",
        "area": "Al Narjis",
        "city": "Riyadh",
        "size_sq_m": 360,
        "monthly_rent": 13000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Layla Al-Subaie",
        "status": "Published",
        "image_url": _IMG["villa_pool"],
        "description": (
            "Ref: MSK-004 | Finishing: Lux | Year built: 2019 | Compound unit\n\n"
            "Spacious 4-bedroom villa in the Al Narjis residential compound — one of North Riyadh's most "
            "popular family communities. Living area includes a large reception room, family lounge, dining room, "
            "and a well-equipped kitchen. All 4 bedrooms have en-suite bathrooms and built-in wardrobes. "
            "The master suite features a dressing room and double sinks.\n\n"
            "Compound amenities: 2 shared swimming pools | Gym | Multi-purpose sports court | Children's playgrounds | "
            "24-hr security | CCTV | Masjid | Grocery mini-mart at gate. Villa extras: Maid's room | "
            "2-car garage | Private garden patio.\n\n"
            "Location: 3 min to Al Narjis supermarkets | 8 min to King Abdullah Road | "
            "Bus routes to ISD, BISC, and other international schools. Annual rent: SAR 156,000. "
            "Payment: 4 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-005",
        "title": "3-Bed Apartment — Al Narjis, Floor 3, Corner Unit",
        "area": "Al Narjis",
        "city": "Riyadh",
        "size_sq_m": 180,
        "monthly_rent": 7200,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Saad Al-Dosari",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-005 | Finishing: Standard+ | Year built: 2018 | Floor: 3rd of 6\n\n"
            "Well-maintained corner apartment in a quiet Al Narjis residential building. Corner position means "
            "windows on two sides — excellent natural light throughout. Open living and dining space, fully fitted "
            "kitchen with granite countertops. All 3 bedrooms are en-suite; master bedroom has a walk-in wardrobe "
            "and a double-sink vanity. The large balcony faces east for cooler mornings.\n\n"
            "Key features: Central A/C | 2 covered parking spaces | Dedicated storage room | Building lift | "
            "24-hr doorman | Fibre internet pre-installed | Laundry room inside unit.\n\n"
            "Location: Walking distance to Al Narjis Park | 10 min to Panorama Mall | Near Al Narjis Clinic. "
            "Annual rent: SAR 86,400. Payment: 4–6 cheques. Available from: 1 July 2026."
        ),
    },
    {
        "external_id": "MSK-006",
        "title": "2-Bed Apartment — Al Narjis, New Building 2023",
        "area": "Al Narjis",
        "city": "Riyadh",
        "size_sq_m": 140,
        "monthly_rent": 5800,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Hanan Al-Rashid",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-006 | Finishing: Lux | Year built: 2023 | Floor: 2nd of 5\n\n"
            "Brand-new 2-bedroom apartment in a 2023-built Al Narjis building — never previously occupied. "
            "Modern open-plan layout with living room flowing onto a south-facing balcony. Kitchen is fully "
            "fitted with Bosch appliances and quartz countertops. Both bedrooms are en-suite with floor-to-ceiling "
            "tiles and built-in wardrobes. Porcelain tile flooring throughout.\n\n"
            "Key features: Central A/C (new units) | Solar water heater | 1 parking space | Lift | Intercom | "
            "EV charging point in car park | Water softener | Backup generator.\n\n"
            "Location: 6 min to Al Narjis restaurants and cafes | Near Dar Al Uloom University | "
            "Quick access to King Salman Road. Annual rent: SAR 69,600. Payment: 6 cheques. No commission."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL MALQA  —  North Riyadh, premium compounds & international schools
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-007",
        "title": "6-Bed Mega Villa — Al Malqa Luxury Compound",
        "area": "Al Malqa",
        "city": "Riyadh",
        "size_sq_m": 580,
        "monthly_rent": 23000,
        "bedrooms": 6,
        "bathrooms": 7,
        "owner_name": "Sultan Al-Fayez",
        "status": "Published",
        "image_url": _IMG["villa_luxury"],
        "description": (
            "Ref: MSK-007 | Finishing: Super Lux | Year built: 2020 | Stand-alone in gated compound\n\n"
            "One of Al Malqa's finest villas, situated inside a premium gated compound favoured by senior "
            "executives and diplomatic families. Ground floor: triple-height entrance hall with chandelier, "
            "formal reception (majlis), secondary family lounge, a large formal dining room seating 16, "
            "professional chef's kitchen with a separate preparation kitchen, and a ground-floor en-suite guest bedroom. "
            "Upper floor: 5 en-suite bedrooms including an expansive master suite with his-and-hers walk-in dressing "
            "rooms, a spa-style bathroom with a freestanding tub, and a private terrace with views over the compound garden.\n\n"
            "Extras: Home cinema room | Basement storage | Rooftop terrace | Maid's x2 | Driver's quarters | "
            "Covered parking for 4 cars | Private landscaped garden with heated pool, Jacuzzi, and outdoor kitchen | "
            "Smart home system (Lutron lighting + Crestron A/V) | Water softener + RO system | Backup generator (full load).\n\n"
            "Compound: 24-hr manned gate | Pool & gym | Tennis court | Mosque | Grocery. "
            "Annual rent: SAR 276,000. Payment: 2 cheques. Available: now."
        ),
    },
    {
        "external_id": "MSK-008",
        "title": "3-Bed Apartment — Al Malqa, High Floor, City View",
        "area": "Al Malqa",
        "city": "Riyadh",
        "size_sq_m": 200,
        "monthly_rent": 9000,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Turki Al-Saud",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-008 | Finishing: Lux | Year built: 2021 | Floor: 7th of 10\n\n"
            "High-floor 3-bedroom apartment in a modern Al Malqa tower with panoramic views over North Riyadh. "
            "The large open-plan living and dining area leads to a full-width balcony. The kitchen is fitted with "
            "premium appliances, stone countertops, and a built-in breakfast bar. The master bedroom has a walk-in "
            "wardrobe and a double vanity bathroom. All bedrooms are en-suite with floor-to-ceiling tiles.\n\n"
            "Key features: Central A/C | Lift × 2 | 2 basement parking bays | Storage cage | "
            "Rooftop swimming pool access | Fully-equipped gym | 24-hr concierge | CCTV | Fibre internet included.\n\n"
            "Location: 5 min to Al Malqa supermarkets | 8 min to KAFD | Walking distance to French International School. "
            "Annual rent: SAR 108,000. Payment: 4 cheques."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL OLAYA  —  Central Riyadh, business & luxury high-rises
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-009",
        "title": "4-Bed Penthouse — Al Olaya Tower, Floors 22–23",
        "area": "Al Olaya",
        "city": "Riyadh",
        "size_sq_m": 350,
        "monthly_rent": 32000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Majed Al-Turki",
        "status": "Published",
        "image_url": _IMG["penthouse_view"],
        "description": (
            "Ref: MSK-009 | Finishing: Boutique Ultra Lux | Year built: 2022 | Duplex Penthouse: 22nd & 23rd floors\n\n"
            "The crown jewel of Al Olaya — a duplex penthouse occupying the top two floors of one of the district's "
            "most prestigious residential towers. The lower level (22F) features an expansive open-plan living and "
            "dining area with 4-metre ceilings and floor-to-ceiling glass offering 270° views of the Riyadh skyline, "
            "Al Faisaliyah Tower, and the Kingdom Tower. A private internal staircase leads to the upper level (23F) "
            "with 4 en-suite bedrooms; the master suite spans the full building width and opens onto a wrap-around "
            "private rooftop terrace with a plunge pool and outdoor dining area.\n\n"
            "Exclusive features: Smart home automation (full Crestron system) | Custom Italian kitchen (Arclinea) | "
            "Wine/juice chiller | Home office | Private lift lobby | 4 dedicated parking bays with EV chargers | "
            "Full-time concierge service | Valet parking for guests.\n\n"
            "Annual rent: SAR 384,000. Payment: 2 cheques. Viewing strictly by appointment."
        ),
    },
    {
        "external_id": "MSK-010",
        "title": "2-Bed Apartment — Al Olaya, Walking Distance to Metro",
        "area": "Al Olaya",
        "city": "Riyadh",
        "size_sq_m": 155,
        "monthly_rent": 10500,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Reem Al-Zahrani",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-010 | Finishing: Lux | Year built: 2019 | Floor: 5th of 14\n\n"
            "Smart 2-bedroom apartment in the heart of Al Olaya's business corridor, a 7-minute walk to Al Olaya Metro "
            "Station (Blue Line). Living area is bright with large windows and parquet flooring. Kitchen has granite "
            "counters, a dishwasher, and a built-in microwave. Both bedrooms have en-suite bathrooms; the master "
            "bedroom has a walk-in wardrobe. Comes with a balcony overlooking a quiet side street.\n\n"
            "Key features: Central A/C | Lift | 1 covered parking space | Gym in building | 24-hr security | "
            "Fibre internet included | Pets allowed (max 2 small pets).\n\n"
            "Location: 5 min walk to Kingdom Centre Mall | 3 min to Starbucks, Pret, and dining options on Tahlia St | "
            "2 min to Dr Sulaiman Al Habib Hospital. Annual rent: SAR 126,000. Payment: 4 cheques."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL RAWDAH  —  Central Riyadh, established family neighbourhood
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-011",
        "title": "5-Bed Stand-Alone Villa — Al Rawdah, Quiet Street",
        "area": "Al Rawdah",
        "city": "Riyadh",
        "size_sq_m": 450,
        "monthly_rent": 16500,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Khalid Al-Otaibi",
        "status": "Published",
        "image_url": _IMG["villa_modern"],
        "description": (
            "Ref: MSK-011 | Finishing: Lux | Year built: 2017 | Renovated: 2024 | Stand-alone villa\n\n"
            "Completely renovated 5-bedroom villa on one of Al Rawdah's most desirable tree-lined streets. "
            "The ground floor has been opened up into a contemporary open-plan layout with a new Italian kitchen, "
            "granite island, new flooring throughout, and freshly plastered and painted walls. The formal majlis "
            "has its own entrance. Five en-suite bedrooms on the upper floor; the master suite has a new marble "
            "bathroom with a freestanding tub and a walk-in dressing room.\n\n"
            "Key features: New central A/C system (2024) | New water softener | 3-car garage | Private walled "
            "garden with date palms and lawn | Maid's room | Driver's room | Backup generator | CCTV.\n\n"
            "Location: 5 min to Al Rawdah Park | Near Olympia International School and British School Riyadh | "
            "10 min to King Fahd Road. Annual rent: SAR 198,000. Payment: 2–4 cheques."
        ),
    },
    {
        "external_id": "MSK-012",
        "title": "3-Bed Family Flat — Al Rawdah, Ground Floor with Garden",
        "area": "Al Rawdah",
        "city": "Riyadh",
        "size_sq_m": 185,
        "monthly_rent": 8800,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Aisha Al-Shammari",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-012 | Finishing: Standard Lux | Year built: 2016 | Floor: Ground\n\n"
            "Rare ground-floor apartment in Al Rawdah with its own private walled garden (80 sqm) — perfect "
            "for families with young children. The layout has a large L-shaped living and dining room opening "
            "directly onto the garden. The kitchen is fully fitted with ample storage. Three spacious en-suite "
            "bedrooms; master bedroom faces the garden. Separate laundry room inside the unit.\n\n"
            "Key features: Split A/C units (all new, 2023) | 2 outdoor parking spaces | Storage room | "
            "Quiet building with only 6 units | No shared spaces other than the staircase and lobby.\n\n"
            "Location: 3 min walk to Masjid Al Rawdah | 8 min to King Fahd National Library | "
            "5 min to Panda Hypermarket. Annual rent: SAR 105,600. Payment: 4 cheques. Available: now."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL FAISALIYAH  —  Central Riyadh, near Al Faisaliyah Tower & KAFD
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-013",
        "title": "3-Bed Apartment — Al Faisaliyah, KAFD-Adjacent",
        "area": "Al Faisaliyah",
        "city": "Riyadh",
        "size_sq_m": 220,
        "monthly_rent": 10500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Bader Al-Mutairi",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-013 | Finishing: Lux | Year built: 2021 | Floor: 8th of 12\n\n"
            "Premium 3-bedroom apartment just 10 minutes from the King Abdullah Financial District (KAFD) — "
            "ideal for finance and tech professionals. The wide-format living room has views towards the "
            "Al Faisaliyah Tower. The kitchen is fully equipped with an island breakfast bar and Siemens appliances. "
            "Three en-suite bedrooms; the master suite has a walk-in wardrobe and a soaking tub.\n\n"
            "Key features: Central A/C | 2 basement parking bays | Gym + sauna in building | "
            "Swimming pool on roof | 24-hr security | Fibre internet | Backup generator | Pet-friendly building.\n\n"
            "Location: 5 min to Al Faisaliyah Tower dining and retail | 10 min to KAFD | "
            "Metro access: Al Faisaliyah Station (Blue Line) is 8 min on foot. "
            "Annual rent: SAR 126,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-014",
        "title": "2-Bed Apartment — Al Faisaliyah, Furnished Option Available",
        "area": "Al Faisaliyah",
        "city": "Riyadh",
        "size_sq_m": 145,
        "monthly_rent": 7000,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Nadia Al-Rasheed",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-014 | Finishing: Standard Lux | Year built: 2018 | Floor: 4th of 9\n\n"
            "Clean and well-maintained 2-bedroom apartment in a quiet Al Faisaliyah residential building. "
            "Available unfurnished (as listed) or fully furnished for SAR 8,500/month. "
            "Open living and dining room with parquet floors. Kitchen has granite countertops and built-in appliances. "
            "Both bedrooms are en-suite; the master bedroom has a built-in wardrobe.\n\n"
            "Key features: Central A/C | 1 covered parking space | Building lift | 24-hr security | "
            "Fibre-ready | Laundry room inside unit.\n\n"
            "Location: 5 min to Al Faisaliyah Mall | 12 min to Kingdom Centre | 15 min to Riyadh Front. "
            "Annual rent (unfurnished): SAR 84,000. Payment: 4–6 cheques. Commission: half month."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # UNIVERSITY DISTRICT  —  South Riyadh, near KSU & Princess Nora Uni
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-015",
        "title": "3-Bed Apartment — University District, Academic Families",
        "area": "University District",
        "city": "Riyadh",
        "size_sq_m": 165,
        "monthly_rent": 5800,
        "bedrooms": 3,
        "bathrooms": 2,
        "owner_name": "Ibrahim Al-Sulami",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-015 | Finishing: Standard | Year built: 2015 | Floor: 2nd of 5\n\n"
            "Practical and spacious 3-bedroom apartment in the University District — extremely popular with "
            "academic staff and graduate researchers at King Saud University (KSU) and Princess Nora University. "
            "The apartment has a large living room, a separate formal dining area, and a well-sized kitchen. "
            "Three bedrooms share two full bathrooms. The master bedroom has a built-in wardrobe.\n\n"
            "Key features: Split A/C units | 1 parking space | Building lift | 24-hr gated entry | "
            "Storage room | Nearby supermarkets on foot.\n\n"
            "Location: 5 min to KSU main gate | 10 min to Princess Nora University | Near KSU Teaching Hospital | "
            "Served by multiple bus routes. Annual rent: SAR 69,600. Payment: 6 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-016",
        "title": "2-Bed Apartment — University District, All Utilities Included",
        "area": "University District",
        "city": "Riyadh",
        "size_sq_m": 130,
        "monthly_rent": 4500,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Fahad Al-Anzi",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-016 | Finishing: Standard | Year built: 2013 | Floor: 1st of 4\n\n"
            "Well-priced 2-bedroom apartment with ALL utilities included in the rent (electricity, water, internet). "
            "Ideal for university researchers, teaching staff, or young couples looking for a predictable monthly cost. "
            "The layout has a combined living and dining area, a functional kitchen, and two bedrooms each with "
            "built-in wardrobes and access to an en-suite or nearby bathroom.\n\n"
            "Key features: Split A/C (maintained by landlord) | 1 parking space | Small garden access | "
            "All maintenance handled by management company.\n\n"
            "Location: 8 min to KSU | 5 min to Riyadh Techno Valley | Near Jarir Bookstore University branch. "
            "Annual rent: SAR 54,000 (all-in). Payment: 4 cheques. Immediate handover."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # HITTEEN  —  North Riyadh, rapidly developing upscale area
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-017",
        "title": "5-Bed Villa — Hitteen, Gated Community, Private Pool",
        "area": "Hitteen",
        "city": "Riyadh",
        "size_sq_m": 440,
        "monthly_rent": 17000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Wafa Al-Dossary",
        "status": "Published",
        "image_url": _IMG["villa_pool"],
        "description": (
            "Ref: MSK-017 | Finishing: Super Lux | Year built: 2023 | Gated compound\n\n"
            "Brand-new 5-bedroom villa in the most sought-after new compound in Hitteen, completed in 2023 "
            "and already 80% occupied by expat families. The ground floor has a grand entrance hall, a formal "
            "majlis, a secondary family lounge, an open-plan dining room and kitchen (Miele appliances, waterfall "
            "island), and a guest en-suite bedroom. The upper floor has four bedrooms; the master suite includes "
            "a private balcony overlooking the private pool, a walk-in dressing room, and a spa bathroom.\n\n"
            "Key features: Private heated pool (8×4m) | Landscaped garden with outdoor kitchen | "
            "3-car garage + visitor parking | Maid's room | Driver's room | Home cinema room | "
            "Full smart home system | Central A/C (VRV) | Backup generator.\n\n"
            "Compound: 24-hr manned security | Clubhouse | Children's play zone | Mosque. "
            "Location: 5 min to Riyadh Park Mall | 8 min to KKIA. Annual rent: SAR 204,000. Payment: 2 cheques."
        ),
    },
    {
        "external_id": "MSK-018",
        "title": "3-Bed Apartment — Hitteen, New Tower 2024, Gym & Pool",
        "area": "Hitteen",
        "city": "Riyadh",
        "size_sq_m": 190,
        "monthly_rent": 8500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Tariq Al-Amoudi",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-018 | Finishing: Lux | Year built: 2024 | Floor: 6th of 14 | Never occupied\n\n"
            "First-ever tenancy opportunity in this stunning 2024 residential tower in Hitteen. "
            "The apartment has a very generous open-plan living and dining area, a large balcony with park views, "
            "a premium kitchen with Bosch appliances and quartz countertops, and three fully en-suite bedrooms "
            "with floor-to-ceiling tiles. The master suite has a walk-in wardrobe and a soaking tub.\n\n"
            "Building amenities: Rooftop infinity pool | Fully-equipped gym | Yoga studio | Co-working lounge | "
            "Underground parking (2 bays allocated) | Concierge | EV charging points | Fibre internet included.\n\n"
            "Location: 6 min to Riyadh Park Mall | 10 min to KKIA | Near Hitteen Park. "
            "Annual rent: SAR 102,000. Payment: 4 cheques. Commission: one month."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL SAHAFAH  —  North Riyadh, media & tech corridor, mid-range
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-019",
        "title": "4-Bed Stand-Alone Villa — Al Sahafah, Large Garden",
        "area": "Al Sahafah",
        "city": "Riyadh",
        "size_sq_m": 350,
        "monthly_rent": 13500,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Mohammed Al-Ghamdi",
        "status": "Published",
        "image_url": _IMG["villa_sunset"],
        "description": (
            "Ref: MSK-019 | Finishing: Lux | Year built: 2018 | Stand-alone villa on 700 sqm plot\n\n"
            "Well-proportioned 4-bedroom stand-alone villa on a generous 700 sqm plot in Al Sahafah — one of "
            "Riyadh's fastest-growing residential corridors due to proximity to the Saudi Broadcasting Authority "
            "and several media production studios. Ground floor: formal majlis, family lounge, dining room, and "
            "large fitted kitchen. Upper floor: 4 en-suite bedrooms with the master having a private balcony. "
            "The garden includes a mature date palm and a covered outdoor sitting area.\n\n"
            "Key features: Central A/C | Water softener | 3-car covered parking | Automatic gate | "
            "Maid's room | Storage rooms × 2 | CCTV | Fibre internet ready.\n\n"
            "Location: 5 min to Al Sahafah Park | 8 min to Panorama Mall | "
            "15 min to KAFD. Annual rent: SAR 162,000. Payment: 4 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-020",
        "title": "3-Bed Apartment — Al Sahafah, Metro Access, Floor 5",
        "area": "Al Sahafah",
        "city": "Riyadh",
        "size_sq_m": 175,
        "monthly_rent": 7000,
        "bedrooms": 3,
        "bathrooms": 2,
        "owner_name": "Salma Al-Jabir",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-020 | Finishing: Standard Lux | Year built: 2017 | Floor: 5th of 7\n\n"
            "A clean, well-maintained 3-bedroom apartment in a residential building 12 minutes' walk from "
            "Al Sahafah Metro Station on the Yellow Line — giving easy access to both KAFD and downtown Riyadh. "
            "The apartment has a bright combined living and dining room, a functional fitted kitchen, and two "
            "balconies (one facing east, one facing west). Three bedrooms, two shared bathrooms; master bedroom "
            "has a private en-suite.\n\n"
            "Key features: Central A/C | 1 covered parking | Building lift | Laundry room | 24-hr security.\n\n"
            "Location: 12 min walk to Al Sahafah Metro | 10 min drive to Panorama Mall | "
            "Easy access to King Salman Road. Annual rent: SAR 84,000. Payment: 6 cheques. Immediate entry."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL NAKHEEL  —  North Riyadh, upscale tree-lined residential
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-021",
        "title": "5-Bed Executive Villa — Al Nakheel, Private Pool & Gym",
        "area": "Al Nakheel",
        "city": "Riyadh",
        "size_sq_m": 500,
        "monthly_rent": 19500,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Ahmad Al-Mughamis",
        "status": "Published",
        "image_url": _IMG["villa_white"],
        "description": (
            "Ref: MSK-021 | Finishing: Super Lux | Year built: 2021 | Stand-alone villa\n\n"
            "Exceptional 5-bedroom executive villa in the prestigious Al Nakheel district, favoured by "
            "senior Saudi Aramco executives, bankers, and diplomatic tenants. The villa occupies a corner "
            "plot of 800 sqm. Ground floor: grand double-height reception hall, formal majlis (separate entrance), "
            "family lounge, formal dining room seating 12, and a professional kitchen with Gaggenau appliances. "
            "Upper floor: 5 en-suite bedrooms; the master suite features a private sunrise terrace, "
            "a dressing room with island storage, and a full marble spa bathroom.\n\n"
            "Extras: Private gym (200 sqm, fully equipped) | Private pool (10×5m, heated) | "
            "Home cinema | Maid's room × 2 | Driver's room | 4-car garage | Smart home system | "
            "Full backup generator | Water softener + RO | CCTV.\n\n"
            "Location: On Al Nakheel's most prestigious tree-lined avenue | 6 min to Al Nakheel Mall | "
            "8 min to KKIA. Annual rent: SAR 234,000. Payment: 2 cheques. Viewing by appointment only."
        ),
    },
    {
        "external_id": "MSK-022",
        "title": "3-Bed Apartment — Al Nakheel, High-Rise Tower, Skyline View",
        "area": "Al Nakheel",
        "city": "Riyadh",
        "size_sq_m": 200,
        "monthly_rent": 8800,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Dana Al-Harthy",
        "status": "Published",
        "image_url": _IMG["penthouse_view"],
        "description": (
            "Ref: MSK-022 | Finishing: Lux | Year built: 2022 | Floor: 10th of 18\n\n"
            "Spacious high-floor 3-bedroom apartment in a 2022 Al Nakheel tower, offering clear skyline views "
            "towards the north of Riyadh. The living room has a 3.2-metre ceiling height and floor-to-ceiling "
            "glazing. The open-plan kitchen features Italian cabinetry, a waterfall quartz island, and "
            "integrated Bosch appliances. Three en-suite bedrooms, all with floor-to-ceiling tile finish; "
            "the master suite features a walk-in wardrobe and a double vanity.\n\n"
            "Building amenities: Rooftop pool | Gym | Co-working lounge | Underground parking × 2 | "
            "24-hr concierge | Parcel room | EV charging | Fibre internet included.\n\n"
            "Location: 5 min to Al Nakheel Mall | Near Al Nakheel Medical Centre | "
            "Easy access to King Salman Road. Annual rent: SAR 105,600. Payment: 4 cheques."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # DIPLOMATIC QUARTER  —  Riyadh, most exclusive compound area
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-023",
        "title": "5-Bed DQ Compound Villa — Diplomatic Quarter, Fully Serviced",
        "area": "Diplomatic Quarter",
        "city": "Riyadh",
        "size_sq_m": 600,
        "monthly_rent": 35000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Hessa Al-Qahtani",
        "status": "Published",
        "image_url": _IMG["villa_luxury"],
        "description": (
            "Ref: MSK-023 | Finishing: Super Lux (embassy standard) | Year built: 2016 | Renovated: 2023\n\n"
            "A rare opportunity to rent in the Diplomatic Quarter — Riyadh's most secure and exclusive residential "
            "enclave, home to 60+ embassies and their staff. This fully renovated 5-bedroom villa is inside a "
            "fully-serviced compound with weekly garden and pool maintenance included in the rent. "
            "The layout spans three floors: basement (gym, cinema, storage), ground (majlis, formal lounge, dining, "
            "kitchen), and upper (5 en-suite bedrooms). The master suite has a private rooftop terrace and a "
            "spa-level bathroom.\n\n"
            "Compound services included: 24-hr armed security | Weekly villa cleaning | Garden & pool maintenance | "
            "Concierge service | Tennis courts × 2 | Squash courts | Clubhouse with restaurant | Pool × 2 | "
            "Chapel and mosque | International school bus stop at gate.\n\n"
            "Tenant profile: Primarily embassy staff, multinational executives, and senior government officials. "
            "Annual rent: SAR 420,000. Payment: 2 cheques. Strict vetting required."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # QURTUBA  —  East Riyadh, established family community
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-024",
        "title": "4-Bed Family Villa — Qurtuba, Wide Street, 2 Lounges",
        "area": "Qurtuba",
        "city": "Riyadh",
        "size_sq_m": 380,
        "monthly_rent": 15000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Yara Al-Senan",
        "status": "Published",
        "image_url": _IMG["villa_modern"],
        "description": (
            "Ref: MSK-024 | Finishing: Lux | Year built: 2019 | Stand-alone villa\n\n"
            "Family-sized 4-bedroom villa on a 600 sqm plot in Qurtuba — one of East Riyadh's most established "
            "and safe residential areas. The villa is on a wide, well-lit street with easy access to major roads. "
            "Ground floor: formal majlis, a secondary family lounge, dining room, large kitchen with island, "
            "and a ground-floor en-suite guest room. Upper floor: master suite (walk-in wardrobe + soaking tub), "
            "plus 3 further en-suite bedrooms.\n\n"
            "Key features: New central A/C (2024) | Water softener | 3-car driveway + garage | Private garden "
            "with palm trees and seating | Maid's room | Driver's room | Storage room | CCTV | Fibre internet.\n\n"
            "Location: 5 min to Qurtuba Park | 10 min to Al Tahlia Street dining | "
            "Near Najd National School and Al Qurtuba Medical Centre. Annual rent: SAR 180,000. Payment: 4 cheques."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # AL SULIMANIYAH  —  Central Riyadh, expat & diplomatic families
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-025",
        "title": "4-Bed Penthouse — Al Sulimaniyah, 360° Riyadh Skyline View",
        "area": "Al Sulimaniyah",
        "city": "Riyadh",
        "size_sq_m": 320,
        "monthly_rent": 28000,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Nasser Al-Bakri",
        "status": "Published",
        "image_url": _IMG["penthouse_view"],
        "description": (
            "Ref: MSK-025 | Finishing: Boutique Ultra Lux | Year built: 2020 | Penthouse: 19th & 20th floors\n\n"
            "The finest penthouse in Al Sulimaniyah — an enclave beloved by senior Aramco officials and the "
            "diplomatic community for its central location, quiet streets, and high security. This duplex penthouse "
            "spans two floors with a wrap-around private terrace (180 sqm) offering uninterrupted 360° views of "
            "the Riyadh skyline including the Kingdom Tower, Al Faisaliyah Tower, and Riyadh Front.\n\n"
            "Lower level (19F): Formal reception hall with double-height void, open-plan kitchen (Bulthaup, "
            "Gaggenau appliances), family lounge, dining room seating 10, and two en-suite guest bedrooms. "
            "Upper level (20F): Master suite with a floor-to-ceiling glazed bathroom and private terrace, "
            "plus one additional en-suite bedroom. Roof terrace: infinity plunge pool, outdoor kitchen and bar, "
            "retractable pergola.\n\n"
            "Key features: Full Lutron smart home | Private lift lobby | 4 parking bays | "
            "24-hr white-glove concierge | Valet parking for guests | Weekly housekeeping included.\n\n"
            "Location: 10 min to Kingdom Centre | 5 min to Tahlia Street | 3 min to Dr Sulaiman Al Habib. "
            "Annual rent: SAR 336,000. Payment: 2 cheques. Immediate viewing available."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # JEDDAH — 10 listings across key residential districts
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-026",
        "title": "4-Bed Villa — Al Hamra, Jeddah Corniche, Private Garden",
        "area": "Al Hamra",
        "city": "Jeddah",
        "size_sq_m": 400,
        "monthly_rent": 18000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Faris Al-Ghamdi",
        "status": "Published",
        "image_url": _IMG["villa_modern"],
        "description": (
            "Ref: MSK-026 | Finishing: Super Lux | Year built: 2021 | Stand-alone villa\n\n"
            "Excellent 4-bedroom stand-alone villa in Al Hamra — one of Jeddah's most prestigious seaside "
            "neighbourhoods, just 5 minutes from the Corniche waterfront promenade. Ground floor: grand "
            "entrance hall, formal majlis with separate entrance, family lounge, dining room, and a "
            "professional kitchen with Bosch appliances and a marble island. Upper floor: 4 en-suite "
            "bedrooms; the master suite features a private terrace overlooking the garden, a walk-in "
            "dressing room, and a soaking tub.\n\n"
            "Key features: Central A/C | Water softener | Private walled garden with outdoor kitchen | "
            "3-car covered garage | Maid's room | Driver's room | CCTV | Fibre internet | "
            "Backup generator.\n\n"
            "Location: 5 min to Jeddah Corniche | 8 min to Al Hamra Mall | "
            "Near Al Hamra International School. Annual rent: SAR 216,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-027",
        "title": "3-Bed Apartment — Al Zahraa, Floor 5, Balcony View",
        "area": "Al Zahraa",
        "city": "Jeddah",
        "size_sq_m": 185,
        "monthly_rent": 9500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Huda Al-Zahrani",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-027 | Finishing: Lux | Year built: 2020 | Floor: 5th of 9\n\n"
            "Bright 3-bedroom apartment on the 5th floor of a modern Al Zahraa residential tower. "
            "The open-plan living and dining area connects to a wide balcony with views over a tree-lined "
            "boulevard. Kitchen is fully fitted with granite worktops and stainless-steel appliances. "
            "All three bedrooms are en-suite with built-in wardrobes. Master bedroom has a walk-in "
            "closet and a rainfall shower.\n\n"
            "Key features: Central A/C | 2 underground parking spaces | Building gym | Rooftop terrace | "
            "24-hr security | Lift × 2 | Fibre internet included | Water softener.\n\n"
            "Location: 5 min to Al Zahraa Park | 10 min to Mall of Arabia Jeddah | "
            "Near KFSH Medical Centre. Annual rent: SAR 114,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-028",
        "title": "5-Bed Villa — Obhur Al Shamaliyah Compound, Private Pool",
        "area": "Obhur Al Shamaliyah",
        "city": "Jeddah",
        "size_sq_m": 520,
        "monthly_rent": 28000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Walid Al-Harbi",
        "status": "Published",
        "image_url": _IMG["villa_pool"],
        "description": (
            "Ref: MSK-028 | Finishing: Super Lux | Year built: 2022 | Gated compound\n\n"
            "Stunning 5-bedroom compound villa in North Jeddah's most desirable coastal community — Obhur "
            "Al Shamaliyah. The villa sits on a 900 sqm plot overlooking the compound's marina channel. "
            "Ground floor: triple-height entrance hall, formal majlis, family lounge, dining room, and a "
            "chef's kitchen (Gaggenau appliances). Upper floor: 5 en-suite bedrooms; the master suite "
            "opens directly onto a private terrace with sea glimpses, with a spa bathroom and walk-in dressing room.\n\n"
            "Extras: Private pool (10×5m) | BBQ terrace | Home cinema room | Smart home system | "
            "4-car garage | Maid's × 2 | Driver's room | Full backup generator.\n\n"
            "Compound: 24-hr security | Marina berth option | Beach club access | Gym & tennis courts. "
            "Annual rent: SAR 336,000. Payment: 2 cheques. Viewings strictly by appointment."
        ),
    },
    {
        "external_id": "MSK-029",
        "title": "2-Bed Apartment — Al Khalidiyyah, Near King Road Mall",
        "area": "Al Khalidiyyah",
        "city": "Jeddah",
        "size_sq_m": 145,
        "monthly_rent": 7500,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Maha Al-Qahtani",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-029 | Finishing: Lux | Year built: 2019 | Floor: 4th of 10\n\n"
            "Modern 2-bedroom apartment in the heart of Al Khalidiyyah — Jeddah's premier retail and dining "
            "corridor, walking distance to King Road Tower and Al Khalidiyyah Mall. Open-plan living and "
            "dining area with parquet flooring. Kitchen fitted with Italian cabinetry and integrated Bosch "
            "appliances. Both bedrooms are en-suite; master bedroom has a walk-in wardrobe.\n\n"
            "Key features: Central A/C | 1 covered parking space | Building gym | 24-hr concierge | "
            "Fibre internet included | EV charging in car park.\n\n"
            "Location: 3 min walk to King Road Mall | 5 min to Corniche | "
            "Walking distance to Tahlia Street restaurants. Annual rent: SAR 90,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-030",
        "title": "4-Bed Villa — Al Rawdah Jeddah, Stand-Alone, Quiet Street",
        "area": "Al Rawdah",
        "city": "Jeddah",
        "size_sq_m": 380,
        "monthly_rent": 16000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Saeed Al-Mulla",
        "status": "Published",
        "image_url": _IMG["villa_compound"],
        "description": (
            "Ref: MSK-030 | Finishing: Lux | Year built: 2018 | Stand-alone villa\n\n"
            "Well-maintained 4-bedroom stand-alone villa on a 650 sqm plot in the established Al Rawdah "
            "district — a favourite for Saudi and expat families alike. Ground floor: formal majlis, "
            "secondary lounge, dining room, and large fitted kitchen. Upper floor: 4 en-suite bedrooms "
            "with the master suite featuring a walk-in wardrobe and soaking tub. Private walled garden "
            "with a lawn and date palms.\n\n"
            "Key features: Central A/C | Water softener | 3-car driveway | Automatic gate | "
            "Maid's room | Storage rooms | CCTV | Fibre internet.\n\n"
            "Location: 5 min to Al Rawdah schools | 8 min to Granada Mall | "
            "Near Al Rawdah Clinic. Annual rent: SAR 192,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-031",
        "title": "3-Bed Apartment — Al Shati, Sea-View High Floor",
        "area": "Al Shati",
        "city": "Jeddah",
        "size_sq_m": 210,
        "monthly_rent": 12000,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Rania Al-Shamrani",
        "status": "Published",
        "image_url": _IMG["penthouse_view"],
        "description": (
            "Ref: MSK-031 | Finishing: Super Lux | Year built: 2021 | Floor: 9th of 14\n\n"
            "Premium high-floor apartment in Al Shati — Jeddah's most sought-after seafront neighbourhood. "
            "Direct Red Sea views from the full-width balcony and the master bedroom. The open-plan living "
            "and dining area has 3.2-metre ceilings and floor-to-ceiling glazing. Kitchen is fitted with "
            "Italian cabinetry and a Miele appliance suite. All 3 bedrooms are en-suite with marble "
            "bathrooms; the master suite has a walk-in wardrobe and a soaking tub facing the sea.\n\n"
            "Building amenities: Infinity rooftop pool | Gym | Co-working lounge | "
            "2 underground parking bays | 24-hr concierge | EV charging | Fibre internet included.\n\n"
            "Location: 3 min walk to Corniche beach | 7 min to Al Shati Mall | "
            "Near Jeddah Yacht Club. Annual rent: SAR 144,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-032",
        "title": "2-Bed Apartment — Al Andalus, Near Al Andalus Mall",
        "area": "Al Andalus",
        "city": "Jeddah",
        "size_sq_m": 140,
        "monthly_rent": 6500,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Khalid Bin Nasser",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-032 | Finishing: Standard Lux | Year built: 2017 | Floor: 3rd of 7\n\n"
            "Practical and well-priced 2-bedroom apartment in the Al Andalus residential district — a "
            "mid-range family area with excellent retail access. The apartment has a combined living and "
            "dining area, a fully fitted kitchen, and two en-suite bedrooms with built-in wardrobes. "
            "South-facing balcony with afternoon sun.\n\n"
            "Key features: Central A/C | 1 covered parking space | Building lift | "
            "24-hr security | Laundry room inside unit | Fibre-ready.\n\n"
            "Location: 5 min to Al Andalus Mall | 10 min to King Abdulaziz University | "
            "Near Al Andalus Park. Annual rent: SAR 78,000. Payment: 4–6 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-033",
        "title": "5-Bed Villa — Al Murjaan, Premium Gated Compound",
        "area": "Al Murjaan",
        "city": "Jeddah",
        "size_sq_m": 490,
        "monthly_rent": 24000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Badr Al-Otaibi",
        "status": "Published",
        "image_url": _IMG["villa_luxury"],
        "description": (
            "Ref: MSK-033 | Finishing: Super Lux | Year built: 2020 | Gated compound villa\n\n"
            "Magnificent 5-bedroom villa inside Al Murjaan's premier residential compound — known for its "
            "landscaped streets, 24-hr manned gates, and international community atmosphere. Ground floor: "
            "double-height reception hall, formal majlis, family lounge, formal dining room seating 14, "
            "and a chef's kitchen (Miele appliances, marble countertops). Upper floor: 5 en-suite "
            "bedrooms; master suite has a private balcony, his-and-hers dressing rooms, and a marble spa bathroom.\n\n"
            "Extras: Shared compound pool | Tennis courts | Gym | Playground | Mosque | Grocery store at gate | "
            "Maid's room | Driver's room | 3-car garage | Smart home system | Backup generator.\n\n"
            "Annual rent: SAR 288,000. Payment: 2 cheques. Available immediately."
        ),
    },
    {
        "external_id": "MSK-034",
        "title": "3-Bed Apartment — Al Naim, Affordable Family Living",
        "area": "Al Naim",
        "city": "Jeddah",
        "size_sq_m": 165,
        "monthly_rent": 5500,
        "bedrooms": 3,
        "bathrooms": 2,
        "owner_name": "Eman Al-Dosari",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-034 | Finishing: Standard | Year built: 2015 | Floor: 2nd of 5\n\n"
            "Spacious and affordable 3-bedroom apartment in the family-oriented Al Naim district of East "
            "Jeddah. The apartment has a generous living and dining room, a functional fitted kitchen, "
            "and three bedrooms (two share a bathroom; master has en-suite). Large storage room inside "
            "the unit. Ideal for young Saudi families or those relocating from outside Jeddah.\n\n"
            "Key features: Split A/C units | 1 parking space | Building lift | "
            "24-hr gated entry | Nearby masjid within 200 metres.\n\n"
            "Location: 8 min to Al Naim commercial strip | 12 min to Jeddah Islamic Port | "
            "Near Al Naim Public Schools. Annual rent: SAR 66,000. Payment: 6 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-035",
        "title": "4-Bed Villa — Al Basateen, New Build 2024, Smart Home",
        "area": "Al Basateen",
        "city": "Jeddah",
        "size_sq_m": 420,
        "monthly_rent": 20000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Turki Al-Aqil",
        "status": "Published",
        "image_url": _IMG["villa_white"],
        "description": (
            "Ref: MSK-035 | Finishing: Super Lux | Year built: 2024 | Stand-alone villa | Never occupied\n\n"
            "Brand-new first-tenancy 4-bedroom villa in the fast-developing Al Basateen neighbourhood of "
            "North Jeddah — completed in early 2024 and never previously occupied. The villa features a "
            "contemporary open-plan design with 3-metre ground-floor ceilings, a bespoke Italian kitchen "
            "(Arclinea cabinetry, Gaggenau appliances), and a seamless transition to a landscaped private "
            "garden. Upper floor: 4 en-suite bedrooms; the master suite has a dressing island, rainfall "
            "shower, and a freestanding tub.\n\n"
            "Key features: Full smart home (lighting, A/C, security via app) | Solar water heater | "
            "EV charging point | 3-car garage | Private pool option (plumbing in place) | "
            "Maid's room | CCTV | Fibre internet | Central VRV A/C.\n\n"
            "Location: 5 min to new Al Basateen retail strip | 15 min to King Abdulaziz International Airport. "
            "Annual rent: SAR 240,000. Payment: 2 cheques. Immediate handover."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # DAMMAM — 10 listings across key residential districts
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-036",
        "title": "4-Bed Villa — Al Faisaliyyah, Dammam, Family Community",
        "area": "Al Faisaliyyah",
        "city": "Dammam",
        "size_sq_m": 380,
        "monthly_rent": 15000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Nasser Al-Mutairi",
        "status": "Published",
        "image_url": _IMG["villa_modern"],
        "description": (
            "Ref: MSK-036 | Finishing: Lux | Year built: 2020 | Stand-alone villa\n\n"
            "Well-appointed 4-bedroom stand-alone villa in Al Faisaliyyah — one of Dammam's most established "
            "family residential areas, popular with Saudi Aramco employees and government officials. "
            "Ground floor: formal majlis, family lounge, dining room, and a fitted kitchen with granite "
            "worktops. Upper floor: 4 en-suite bedrooms; master suite with walk-in wardrobe and soaking tub. "
            "Private walled garden with a shaded seating area and palm trees.\n\n"
            "Key features: Central A/C | Water softener | 3-car driveway | Automatic gate | "
            "Maid's room | Driver's room | CCTV | Fibre internet.\n\n"
            "Location: 8 min to Dammam Corniche | 5 min to Al Faisaliyyah Park | "
            "Near DPS and GEMS schools. Annual rent: SAR 180,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-037",
        "title": "3-Bed Apartment — Al Adamah, Dammam, Floor 4",
        "area": "Al Adamah",
        "city": "Dammam",
        "size_sq_m": 175,
        "monthly_rent": 7500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Sameera Al-Shehri",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-037 | Finishing: Lux | Year built: 2019 | Floor: 4th of 8\n\n"
            "Clean and bright 3-bedroom apartment in Al Adamah, one of Dammam's central residential "
            "districts well-connected to the King Fahd Causeway and Eastern Ring Road. Open-plan "
            "living and dining area with large windows. Fully fitted kitchen with granite countertops "
            "and built-in appliances. All 3 bedrooms are en-suite; master bedroom has a walk-in wardrobe "
            "and balcony access.\n\n"
            "Key features: Central A/C | 2 underground parking spaces | Building lift | "
            "24-hr security | Fibre internet included | Water softener.\n\n"
            "Location: 10 min to Dammam Corniche | 7 min to Al Rashid Mall | "
            "Near Prince Mohammed Bin Fahd Hospital. Annual rent: SAR 90,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-038",
        "title": "5-Bed Villa — Al Mazrouiyah, Dammam, Premium Compound",
        "area": "Al Mazrouiyah",
        "city": "Dammam",
        "size_sq_m": 500,
        "monthly_rent": 20000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Abdul Rahman Al-Dosari",
        "status": "Published",
        "image_url": _IMG["villa_compound"],
        "description": (
            "Ref: MSK-038 | Finishing: Super Lux | Year built: 2021 | Gated compound\n\n"
            "Spacious 5-bedroom villa inside one of Dammam's most sought-after gated communities in "
            "Al Mazrouiyah — the premium residential choice for Saudi Aramco senior management. "
            "Ground floor: grand reception hall, formal majlis, secondary lounge, dining room, and "
            "professional kitchen (Siemens appliances). Upper floor: 5 en-suite bedrooms; master "
            "suite has a dressing room, soaking tub, and a private morning terrace.\n\n"
            "Compound amenities: Shared pool | Gym | Children's playground | Mosque | 24-hr security | "
            "Villa extras: Maid's room | Driver's room | 3-car garage | Smart home system | "
            "Backup generator | Water softener + RO.\n\n"
            "Location: 15 min to Saudi Aramco HQ | 10 min to Dammam Airport. "
            "Annual rent: SAR 240,000. Payment: 2 cheques."
        ),
    },
    {
        "external_id": "MSK-039",
        "title": "2-Bed Apartment — Al Nuzha, Dammam, Near Corniche",
        "area": "Al Nuzha",
        "city": "Dammam",
        "size_sq_m": 135,
        "monthly_rent": 5500,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Fatima Al-Qassim",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-039 | Finishing: Standard Lux | Year built: 2016 | Floor: 3rd of 6\n\n"
            "Affordable 2-bedroom apartment in Al Nuzha, a well-established Dammam district close to "
            "the Corniche waterfront. Ideal for small families or couples working in the Eastern Province. "
            "The apartment has a combined living and dining area, a functional kitchen, and two bedrooms "
            "sharing two bathrooms. Master bedroom has a built-in wardrobe.\n\n"
            "Key features: Split A/C units | 1 parking space | Building lift | "
            "24-hr gated entry | Laundry area inside unit.\n\n"
            "Location: 5 min to Al Nuzha Park | 10 min to Dammam Corniche | "
            "Near Panda Supermarket. Annual rent: SAR 66,000. Payment: 6 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-040",
        "title": "3-Bed Apartment — Al Badiyah, Dammam, New Tower 2023",
        "area": "Al Badiyah",
        "city": "Dammam",
        "size_sq_m": 165,
        "monthly_rent": 6800,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Yousef Al-Anzi",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-040 | Finishing: Lux | Year built: 2023 | Floor: 5th of 12 | Never occupied\n\n"
            "Brand-new first-tenancy 3-bedroom apartment in a 2023 Al Badiyah tower — never previously "
            "occupied. Modern open-plan layout with a wide balcony. Kitchen fully fitted with Bosch "
            "appliances and quartz worktops. All 3 bedrooms are en-suite with floor-to-ceiling tiles "
            "and built-in wardrobes. Master suite features a walk-in wardrobe and double-sink vanity.\n\n"
            "Building amenities: Rooftop pool | Gym | Underground parking × 2 | 24-hr concierge | "
            "EV charging | Fibre internet included | Smart intercom.\n\n"
            "Location: 8 min to Al Badiyah shopping strip | 12 min to Dammam Corniche | "
            "Near Eastern Province Technical College. Annual rent: SAR 81,600. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-041",
        "title": "4-Bed Villa — Al Shulah, Dammam, Quiet Residential Street",
        "area": "Al Shulah",
        "city": "Dammam",
        "size_sq_m": 360,
        "monthly_rent": 14000,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Ibrahim Al-Bukhari",
        "status": "Published",
        "image_url": _IMG["villa_sunset"],
        "description": (
            "Ref: MSK-041 | Finishing: Lux | Year built: 2019 | Stand-alone villa\n\n"
            "A solid, well-maintained 4-bedroom stand-alone villa on a quiet Al Shulah street — "
            "an established family area north of Dammam city centre. Ground floor: separate formal "
            "majlis, family lounge, dining room, and a fully fitted kitchen. Upper floor: 4 en-suite "
            "bedrooms with built-in wardrobes; master suite has a double vanity and walk-in wardrobe. "
            "Private garden with covered outdoor seating.\n\n"
            "Key features: Central A/C | 2-car garage | Automatic gate | Maid's room | "
            "Storage rooms | CCTV | Water softener | Fibre internet.\n\n"
            "Location: 5 min to Al Shulah Park | 15 min to Dammam airport | "
            "Near Al Shulah supermarkets. Annual rent: SAR 168,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-042",
        "title": "2-Bed Apartment — Al Fursan, Dammam, Budget Friendly",
        "area": "Al Fursan",
        "city": "Dammam",
        "size_sq_m": 120,
        "monthly_rent": 5000,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Amal Al-Harbi",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-042 | Finishing: Standard | Year built: 2014 | Floor: 2nd of 5\n\n"
            "Practical and budget-friendly 2-bedroom apartment in Al Fursan — an affordable Dammam "
            "residential district ideal for young couples or junior Saudi Aramco employees. "
            "The apartment has a combined living and dining room, a functional kitchen, and two "
            "bedrooms each with access to a full bathroom. Balcony facing east for cool mornings.\n\n"
            "Key features: Split A/C units | 1 parking space | Building lift | "
            "24-hr gated entry | Near local masjid.\n\n"
            "Location: 8 min to Al Fursan commercial area | 12 min to Al Rashid Mall | "
            "Bus route to Saudi Aramco campus. Annual rent: SAR 60,000. Payment: 6 cheques."
        ),
    },
    {
        "external_id": "MSK-043",
        "title": "5-Bed Villa — Al Faisaliyyah, Dammam, Private Pool & Garden",
        "area": "Al Faisaliyyah",
        "city": "Dammam",
        "size_sq_m": 480,
        "monthly_rent": 18000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Sultan Al-Dosari",
        "status": "Published",
        "image_url": _IMG["villa_pool"],
        "description": (
            "Ref: MSK-043 | Finishing: Super Lux | Year built: 2022 | Stand-alone villa\n\n"
            "Exceptional 5-bedroom villa in Al Faisaliyyah with a private pool and landscaped garden — "
            "rarely available in this Dammam neighbourhood. The villa sits on a 750 sqm plot with "
            "full privacy walls. Ground floor: reception hall, formal majlis, family lounge, dining "
            "room, and a professional kitchen. Upper floor: 5 en-suite bedrooms; master suite has a "
            "private balcony overlooking the pool, walk-in dressing room, and marble spa bathroom.\n\n"
            "Key features: Private pool (8×4m) | Landscaped garden with BBQ terrace | "
            "Home cinema room | Maid's × 2 | Driver's room | 3-car garage | VRV central A/C | "
            "Smart home system | Full backup generator | Water softener + RO.\n\n"
            "Annual rent: SAR 216,000. Payment: 2 cheques. Available: now."
        ),
    },
    {
        "external_id": "MSK-044",
        "title": "3-Bed Apartment — Dammam Corniche, High Floor, Sea View",
        "area": "Al Shati",
        "city": "Dammam",
        "size_sq_m": 195,
        "monthly_rent": 8500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Mariam Al-Subaie",
        "status": "Published",
        "image_url": _IMG["penthouse_view"],
        "description": (
            "Ref: MSK-044 | Finishing: Super Lux | Year built: 2021 | Floor: 8th of 12\n\n"
            "Premium high-floor apartment on the Dammam Corniche — one of very few residential "
            "buildings with direct Arabian Gulf sea views from every main room. The wide-format "
            "living and dining area has 3-metre ceilings and floor-to-ceiling glazing with a full "
            "sea panorama. Kitchen features a Cosentino Dekton countertop and integrated Siemens "
            "appliances. All 3 bedrooms are en-suite; master suite faces the sea with a walk-in "
            "wardrobe and soaking tub.\n\n"
            "Building amenities: Infinity pool | Gym | 2 parking bays | 24-hr concierge | "
            "Fibre internet included.\n\n"
            "Location: 1 min walk to Corniche waterfront | 8 min to Al Rashid Mall | "
            "Near Dammam municipality. Annual rent: SAR 102,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-045",
        "title": "4-Bed Villa — Al Mazrouiyah, Dammam, Renovated 2024",
        "area": "Al Mazrouiyah",
        "city": "Dammam",
        "size_sq_m": 400,
        "monthly_rent": 13500,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Tariq Al-Ghamdi",
        "status": "Published",
        "image_url": _IMG["villa_white"],
        "description": (
            "Ref: MSK-045 | Finishing: Lux | Year built: 2015 | Fully renovated 2024 | Stand-alone\n\n"
            "Completely renovated in early 2024, this 4-bedroom stand-alone villa in Al Mazrouiyah "
            "offers brand-new interiors at a competitive price. New Italian kitchen with Bosch "
            "appliances, new central A/C (VRV system), new marble bathrooms throughout, and fresh "
            "flooring on all floors. The ground floor formal majlis has its own street entrance. "
            "Four en-suite bedrooms on the upper floor; master suite has a new walk-in wardrobe "
            "and double-sink vanity.\n\n"
            "Key features: New VRV central A/C | New water softener | 2-car garage | "
            "Private garden | Maid's room | CCTV (all new) | Fibre internet.\n\n"
            "Location: 10 min to Saudi Aramco HQ | 12 min to Dammam airport | "
            "Near DPS Dammam. Annual rent: SAR 162,000. Payment: 4 cheques."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # KHOBAR — 10 listings across key residential districts
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-046",
        "title": "4-Bed Villa — Al Aqrabiyah, Khobar, Prestigious Location",
        "area": "Al Aqrabiyah",
        "city": "Khobar",
        "size_sq_m": 390,
        "monthly_rent": 16000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Hamad Al-Khalid",
        "status": "Published",
        "image_url": _IMG["villa_modern"],
        "description": (
            "Ref: MSK-046 | Finishing: Lux | Year built: 2020 | Stand-alone villa\n\n"
            "4-bedroom stand-alone villa in Al Aqrabiyah — Khobar's most prestigious central "
            "district, favoured by senior Saudi Aramco management and diplomatic families. "
            "Wide plot on a well-lit street. Ground floor: formal majlis with separate entrance, "
            "family lounge, dining room, and professional kitchen with Bosch appliances. "
            "Upper floor: 4 en-suite bedrooms; master suite has a private balcony, walk-in "
            "wardrobe, and a marble spa bathroom.\n\n"
            "Key features: Central A/C | Water softener | 3-car driveway | Automatic gate | "
            "Maid's room | Driver's room | Landscaped garden | CCTV | Fibre internet.\n\n"
            "Location: 5 min to Khobar Corniche | 8 min to Mall of Dhahran | "
            "Near KFUPM and Saudi Aramco campus. Annual rent: SAR 192,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-047",
        "title": "3-Bed Apartment — Al Thuqbah, Khobar, Floor 3, Modern Building",
        "area": "Al Thuqbah",
        "city": "Khobar",
        "size_sq_m": 180,
        "monthly_rent": 8000,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Lina Al-Rasheed",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-047 | Finishing: Lux | Year built: 2019 | Floor: 3rd of 8\n\n"
            "Spacious 3-bedroom apartment in Al Thuqbah — one of Khobar's busiest and most "
            "well-connected residential areas, close to the half-moon bay Corniche and major "
            "shopping centres. Open-plan living and dining area with a wide balcony. Kitchen "
            "is fitted with granite countertops and integrated appliances. All 3 bedrooms are "
            "en-suite; master bedroom has a walk-in wardrobe.\n\n"
            "Key features: Central A/C | 2 underground parking spaces | Gym in building | "
            "Rooftop garden terrace | 24-hr security | Fibre internet included.\n\n"
            "Location: 5 min to Half Moon Bay | 8 min to Al Rashid Mega Mall | "
            "Near Al Thuqbah District Hospital. Annual rent: SAR 96,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-048",
        "title": "5-Bed Villa — Al Bandariyah, Khobar, Compound with Pool",
        "area": "Al Bandariyah",
        "city": "Khobar",
        "size_sq_m": 510,
        "monthly_rent": 22000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Saad Al-Khaldi",
        "status": "Published",
        "image_url": _IMG["villa_pool"],
        "description": (
            "Ref: MSK-048 | Finishing: Super Lux | Year built: 2021 | Gated compound\n\n"
            "Impressive 5-bedroom compound villa in Al Bandariyah — Khobar's top-tier waterfront "
            "residential area close to the Saudi Aramco administration building. The villa is inside "
            "a fully-managed, fully-serviced compound with weekly pool maintenance included. "
            "Ground floor: triple-height entry hall, formal majlis, family lounge, dining room, "
            "and a chef's kitchen. Upper floor: 5 en-suite bedrooms; master suite has a private "
            "terrace, his-and-hers dressing rooms, and a soaking tub.\n\n"
            "Compound amenities: 2 shared pools | Tennis courts | Gym | Playground | "
            "24-hr security | Mosque | Grocery store at gate | Villa extras: Maid's × 2 | "
            "Driver's room | 4-car garage | Full backup generator.\n\n"
            "Annual rent: SAR 264,000. Payment: 2 cheques. Preferred tenant: Aramco executive family."
        ),
    },
    {
        "external_id": "MSK-049",
        "title": "2-Bed Apartment — Khobar Corniche, Sea View, High Floor",
        "area": "Al Aqrabiyah",
        "city": "Khobar",
        "size_sq_m": 150,
        "monthly_rent": 7000,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Dina Al-Mubarak",
        "status": "Published",
        "image_url": _IMG["penthouse_view"],
        "description": (
            "Ref: MSK-049 | Finishing: Super Lux | Year built: 2020 | Floor: 7th of 10\n\n"
            "Sought-after 2-bedroom apartment with direct Arabian Gulf Corniche views in the heart "
            "of Al Aqrabiyah. The living and dining area faces the sea with floor-to-ceiling windows "
            "and a wide balcony. Kitchen has an Cosentino Silestone worktop and Bosch appliances. "
            "Both bedrooms are en-suite; master bedroom faces the sea with a walk-in wardrobe.\n\n"
            "Key features: Central A/C | 1 covered parking | Building gym | "
            "24-hr security | Fibre internet included | EV charging.\n\n"
            "Location: 2 min walk to Corniche promenade | 5 min to Al Aqrabiyah Park | "
            "Near Khobar Four Points Hotel. Annual rent: SAR 84,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-050",
        "title": "3-Bed Apartment — Al Aziziyah, Khobar, New Tower 2023",
        "area": "Al Aziziyah",
        "city": "Khobar",
        "size_sq_m": 170,
        "monthly_rent": 7500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Omar Al-Thubaiti",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-050 | Finishing: Lux | Year built: 2023 | Floor: 6th of 14 | Never occupied\n\n"
            "First-tenancy 3-bedroom apartment in a brand-new Al Aziziyah tower — never previously "
            "occupied. The apartment has an open-plan living and dining area with a wide balcony, "
            "a premium kitchen with quartz countertops and Siemens appliances, and 3 en-suite "
            "bedrooms with floor-to-ceiling tiles. Master suite has a walk-in wardrobe and "
            "a rainfall shower.\n\n"
            "Building amenities: Rooftop pool | Fully-equipped gym | Co-working lounge | "
            "Underground parking × 2 | Concierge | EV charging points | Fibre internet included.\n\n"
            "Location: 5 min to Al Rashid Mega Mall | 10 min to Khobar Corniche | "
            "Near KFUPM university campus. Annual rent: SAR 90,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-051",
        "title": "4-Bed Villa — Al Rawabi, Khobar, Stand-Alone Family Home",
        "area": "Al Rawabi",
        "city": "Khobar",
        "size_sq_m": 370,
        "monthly_rent": 15000,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Ahmad Al-Sayegh",
        "status": "Published",
        "image_url": _IMG["villa_compound"],
        "description": (
            "Ref: MSK-051 | Finishing: Lux | Year built: 2019 | Stand-alone villa\n\n"
            "A family-sized 4-bedroom stand-alone villa in Al Rawabi — a quiet, green Khobar "
            "neighbourhood popular with Saudi families and KFUPM faculty. The villa sits on "
            "a 600 sqm plot with a private garden and shaded terrace. Ground floor: formal "
            "majlis, family lounge, dining room, and fitted kitchen with island. Upper floor: "
            "4 en-suite bedrooms; master suite has a private terrace and walk-in wardrobe.\n\n"
            "Key features: Central A/C | Water softener | 2-car garage + driveway | "
            "Automatic gate | Maid's room | Storage | CCTV | Fibre internet.\n\n"
            "Location: 5 min to Al Rawabi Park | 10 min to Mall of Dhahran | "
            "Near Saudi Aramco campus gate 4. Annual rent: SAR 180,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-052",
        "title": "2-Bed Apartment — Al Thuqbah, Khobar, Near Mall",
        "area": "Al Thuqbah",
        "city": "Khobar",
        "size_sq_m": 130,
        "monthly_rent": 6000,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Rana Al-Shammari",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-052 | Finishing: Standard Lux | Year built: 2017 | Floor: 4th of 7\n\n"
            "Well-maintained 2-bedroom apartment in central Al Thuqbah — an 8-minute walk from "
            "Al Rashid Mega Mall and close to all major services in Khobar. The apartment has a "
            "combined living and dining area, a functional kitchen, and two en-suite bedrooms "
            "with built-in wardrobes. Quiet side street with little traffic noise.\n\n"
            "Key features: Central A/C | 1 covered parking | Building lift | "
            "24-hr security | Fibre-ready | Laundry room inside unit.\n\n"
            "Location: 8 min walk to Al Rashid Mega Mall | 10 min to Khobar Corniche | "
            "Near KFUPM west gate. Annual rent: SAR 72,000. Payment: 4–6 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-053",
        "title": "5-Bed Villa — Al Aqrabiyah, Khobar, Super Lux, Private Pool",
        "area": "Al Aqrabiyah",
        "city": "Khobar",
        "size_sq_m": 540,
        "monthly_rent": 24000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Fahad Al-Subaie",
        "status": "Published",
        "image_url": _IMG["villa_luxury"],
        "description": (
            "Ref: MSK-053 | Finishing: Super Lux | Year built: 2022 | Stand-alone villa\n\n"
            "One of Al Aqrabiyah's finest stand-alone villas — an expansive 5-bedroom super-lux "
            "property set on an 800 sqm plot just 5 minutes from the Arabian Gulf Corniche. "
            "Ground floor: grand reception hall (double height), formal majlis, family lounge, "
            "formal dining room seating 16, professional kitchen (Gaggenau + Sub-Zero appliances), "
            "and a guest en-suite bedroom. Upper floor: master suite with sea-glimpse balcony, "
            "his-and-hers dressing rooms, a freestanding tub, and three further en-suite bedrooms.\n\n"
            "Extras: Private heated pool (9×5m) | Home cinema | Basement gym | Maid's × 2 | "
            "Driver's room | 4-car garage | Full smart home (Crestron) | Backup generator | "
            "Water softener + RO | CCTV.\n\n"
            "Annual rent: SAR 288,000. Payment: 2 cheques. Viewings by appointment."
        ),
    },
    {
        "external_id": "MSK-054",
        "title": "3-Bed Apartment — Al Bandariyah, Khobar, Sea View",
        "area": "Al Bandariyah",
        "city": "Khobar",
        "size_sq_m": 200,
        "monthly_rent": 9000,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Nouf Al-Abdullah",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-054 | Finishing: Super Lux | Year built: 2021 | Floor: 6th of 10\n\n"
            "Premium 3-bedroom apartment in Al Bandariyah with partial Gulf sea views from the "
            "balcony and master bedroom. The open-plan living and dining area has high ceilings "
            "and floor-to-ceiling glazing. Italian kitchen with Bosch appliances and a "
            "waterfall quartz island. All 3 bedrooms are en-suite; master suite features a "
            "walk-in wardrobe and soaking tub.\n\n"
            "Building amenities: Pool deck | Gym | 2 parking bays | 24-hr concierge | "
            "Fibre internet included | EV charging.\n\n"
            "Location: 3 min to Khobar Corniche | 5 min to Saudi Aramco HQ | "
            "Near Al Bandariyah Park. Annual rent: SAR 108,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-055",
        "title": "4-Bed Villa — Al Aziziyah, Khobar, Family Compound",
        "area": "Al Aziziyah",
        "city": "Khobar",
        "size_sq_m": 410,
        "monthly_rent": 14000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Majed Al-Dosari",
        "status": "Published",
        "image_url": _IMG["villa_white"],
        "description": (
            "Ref: MSK-055 | Finishing: Lux | Year built: 2020 | Compound villa\n\n"
            "4-bedroom villa in an established Al Aziziyah residential compound — a popular choice "
            "for Saudi Aramco families seeking a managed community with shared amenities. "
            "The villa has a formal majlis, family lounge, dining room, and a fully fitted kitchen. "
            "Upper floor: 4 en-suite bedrooms with built-in wardrobes; master suite has a walk-in "
            "wardrobe and double-sink vanity.\n\n"
            "Compound amenities: Shared pool | Gym | Children's playground | 24-hr security | "
            "Villa extras: Maid's room | 2-car garage | Garden patio | Water softener.\n\n"
            "Location: 8 min to Mall of Dhahran | 10 min to Khobar Corniche | "
            "Near KFUPM. Annual rent: SAR 168,000. Payment: 4 cheques."
        ),
    },

    # ══════════════════════════════════════════════════════════════════════
    # MADINAH — 10 listings across key residential districts
    # ══════════════════════════════════════════════════════════════════════
    {
        "external_id": "MSK-056",
        "title": "4-Bed Villa — Al Khalidiyya, Madinah, Near Prophet's Mosque",
        "area": "Al Khalidiyya",
        "city": "Madinah",
        "size_sq_m": 360,
        "monthly_rent": 12000,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Hassan Al-Madani",
        "status": "Published",
        "image_url": _IMG["villa_modern"],
        "description": (
            "Ref: MSK-056 | Finishing: Lux | Year built: 2019 | Stand-alone villa\n\n"
            "Distinguished 4-bedroom villa in Al Khalidiyya — one of Madinah's most respected "
            "residential areas, located 15 minutes from Al-Masjid an-Nabawi (Prophet's Mosque). "
            "Ideal for families seeking permanent or long-term residence in the blessed city. "
            "Ground floor: formal majlis, family lounge, dining room, and a fitted kitchen. "
            "Upper floor: 4 en-suite bedrooms; master suite has a walk-in wardrobe and "
            "a private balcony.\n\n"
            "Key features: Central A/C | Water softener | 2-car garage | Automatic gate | "
            "Maid's room | CCTV | Fibre internet | Private garden with lawn.\n\n"
            "Location: 15 min to Al-Masjid an-Nabawi | 10 min to Madinah Mall | "
            "Near Al Khalidiyya Public Hospital. Annual rent: SAR 144,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-057",
        "title": "3-Bed Apartment — Al Aziziyya, Madinah, Floor 3",
        "area": "Al Aziziyya",
        "city": "Madinah",
        "size_sq_m": 160,
        "monthly_rent": 6500,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Umm Khalid Al-Ansari",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-057 | Finishing: Standard Lux | Year built: 2018 | Floor: 3rd of 6\n\n"
            "Well-maintained 3-bedroom apartment in Al Aziziyya — a central Madinah district "
            "popular with families of Islamic university staff and government employees. "
            "The apartment has an open living and dining area, a functional fitted kitchen, "
            "and 3 en-suite bedrooms with built-in wardrobes. Balcony facing west.\n\n"
            "Key features: Central A/C | 1 covered parking | Building lift | "
            "24-hr gated entry | Nearby masjid within 100 metres.\n\n"
            "Location: 20 min to Prophet's Mosque | 8 min to Madinah City Centre Mall | "
            "Near Islamic University of Madinah. Annual rent: SAR 78,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-058",
        "title": "5-Bed Villa — Quba, Madinah, Near Quba Mosque",
        "area": "Quba",
        "city": "Madinah",
        "size_sq_m": 460,
        "monthly_rent": 18000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Abdullah Al-Ansari",
        "status": "Published",
        "image_url": _IMG["villa_luxury"],
        "description": (
            "Ref: MSK-058 | Finishing: Super Lux | Year built: 2021 | Stand-alone villa\n\n"
            "Magnificent 5-bedroom villa in Quba — Madinah's most prestigious residential area, "
            "located next to the historic Quba Mosque, the world's first mosque. This area is "
            "highly sought-after by Hajj and Umrah-related professionals, Islamic scholars, and "
            "senior government officials. Grand reception hall, formal majlis, family lounge, "
            "dining room, and a professional kitchen (Bosch appliances). Upper floor: 5 en-suite "
            "bedrooms; master suite has a walk-in dressing room, freestanding tub, and a "
            "private terrace.\n\n"
            "Key features: Central A/C | Water softener | 3-car covered garage | "
            "Landscaped garden with date palms | Maid's × 2 | Driver's room | Smart home | "
            "CCTV | Backup generator.\n\n"
            "Location: 3 min to Quba Mosque | 25 min to Prophet's Mosque | "
            "Near Madinah International Airport. Annual rent: SAR 216,000. Payment: 2–4 cheques."
        ),
    },
    {
        "external_id": "MSK-059",
        "title": "2-Bed Apartment — Al Salam, Madinah, Affordable Central",
        "area": "Al Salam",
        "city": "Madinah",
        "size_sq_m": 120,
        "monthly_rent": 4500,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Um Ahmed Al-Medini",
        "status": "Published",
        "image_url": _IMG["apt_interior"],
        "description": (
            "Ref: MSK-059 | Finishing: Standard | Year built: 2014 | Floor: 2nd of 5\n\n"
            "Affordable 2-bedroom apartment in Al Salam — a central Madinah district ideal for "
            "families working at the Prophet's Mosque complex or in Madinah's hospitality sector. "
            "The apartment has a combined living and dining area, a functional kitchen, and "
            "two bedrooms sharing two bathrooms. Master bedroom has built-in wardrobes.\n\n"
            "Key features: Split A/C units | 1 parking space | Building lift | "
            "24-hr gated entry | Masjid within 200 metres.\n\n"
            "Location: 18 min to Prophet's Mosque | 10 min to Madinah Convention Centre | "
            "Near Al Salam Hospital. Annual rent: SAR 54,000. Payment: 6 cheques. No commission."
        ),
    },
    {
        "external_id": "MSK-060",
        "title": "3-Bed Apartment — Al Bayan, Madinah, Family Compound",
        "area": "Al Bayan",
        "city": "Madinah",
        "size_sq_m": 155,
        "monthly_rent": 5800,
        "bedrooms": 3,
        "bathrooms": 2,
        "owner_name": "Riyad Al-Zahrani",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-060 | Finishing: Standard Lux | Year built: 2016 | Floor: 1st of 4\n\n"
            "Ground-level 3-bedroom apartment with direct garden access in a small family "
            "compound in Al Bayan — a quiet Madinah residential area popular with university "
            "lecturers and healthcare professionals. The apartment has a large living and "
            "dining area opening to a private patio, a fitted kitchen, and three bedrooms "
            "(master en-suite, two share a bathroom).\n\n"
            "Key features: Central A/C | 2 outdoor parking spaces | Private patio (40 sqm) | "
            "24-hr gated compound | Storage room.\n\n"
            "Location: 20 min to Prophet's Mosque | 5 min to Taibah University | "
            "Near Al Bayan supermarkets. Annual rent: SAR 69,600. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-061",
        "title": "4-Bed Villa — Bani Haritha, Madinah, Stand-Alone",
        "area": "Bani Haritha",
        "city": "Madinah",
        "size_sq_m": 380,
        "monthly_rent": 11000,
        "bedrooms": 4,
        "bathrooms": 4,
        "owner_name": "Khalid Al-Bukhari",
        "status": "Published",
        "image_url": _IMG["villa_sunset"],
        "description": (
            "Ref: MSK-061 | Finishing: Lux | Year built: 2018 | Stand-alone villa\n\n"
            "Solid 4-bedroom stand-alone villa in Bani Haritha — an established Madinah "
            "district named after one of the historic tribes of Madinah, close to the "
            "Madinah Convention Centre and government offices. Ground floor: formal majlis, "
            "family lounge, dining room, and fitted kitchen. Upper floor: 4 en-suite "
            "bedrooms; master suite has a walk-in wardrobe. Private garden with palm trees.\n\n"
            "Key features: Central A/C | Water softener | 2-car garage | Automatic gate | "
            "Maid's room | CCTV | Fibre internet.\n\n"
            "Location: 5 min to Madinah Convention Centre | 22 min to Prophet's Mosque | "
            "Near new Madinah Business District. Annual rent: SAR 132,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-062",
        "title": "2-Bed Apartment — Al Aqoul, Madinah, Near Masjid Nabawi",
        "area": "Al Aqoul",
        "city": "Madinah",
        "size_sq_m": 130,
        "monthly_rent": 5200,
        "bedrooms": 2,
        "bathrooms": 2,
        "owner_name": "Safia Al-Ansari",
        "status": "Published",
        "image_url": _IMG["apt_living"],
        "description": (
            "Ref: MSK-062 | Finishing: Standard Lux | Year built: 2017 | Floor: 3rd of 6\n\n"
            "Comfortable 2-bedroom apartment in Al Aqoul — a residential district very close "
            "to the Prophet's Mosque area, ideal for families wishing to live near the central "
            "haram zone. Popular with Islamic university professors, religious affairs ministry "
            "staff, and long-term pilgrimage families. Living and dining area with balcony. "
            "Fitted kitchen. Both bedrooms en-suite with built-in wardrobes.\n\n"
            "Key features: Central A/C | 1 parking space | Building lift | "
            "24-hr security | Masjid within 5 min walk.\n\n"
            "Location: 10 min to Al-Masjid an-Nabawi | 5 min to central Madinah market | "
            "Near Al Aqoul schools. Annual rent: SAR 62,400. Payment: 4–6 cheques."
        ),
    },
    {
        "external_id": "MSK-063",
        "title": "5-Bed Villa — Al Khalidiyya, Madinah, Gated Compound",
        "area": "Al Khalidiyya",
        "city": "Madinah",
        "size_sq_m": 480,
        "monthly_rent": 16000,
        "bedrooms": 5,
        "bathrooms": 6,
        "owner_name": "Muhannad Al-Qahtani",
        "status": "Published",
        "image_url": _IMG["villa_compound"],
        "description": (
            "Ref: MSK-063 | Finishing: Super Lux | Year built: 2022 | Gated compound\n\n"
            "Expansive 5-bedroom compound villa in Al Khalidiyya — the crown of Madinah's "
            "residential real estate. Inside a boutique gated compound of only 12 villas, "
            "offering a quiet and secure environment for senior families. Grand reception hall, "
            "formal majlis, secondary lounge, formal dining room, and a chef's kitchen "
            "(Bosch + Samsung appliances). Upper floor: 5 en-suite bedrooms; master suite has "
            "a walk-in dressing room, soaking tub, and a sunrise terrace.\n\n"
            "Compound amenities: Shared pool | Gym | Playground | 24-hr security | Mosque nearby | "
            "Villa extras: Maid's × 2 | 3-car garage | Home cinema room | Smart home | "
            "Water softener | Backup generator.\n\n"
            "Annual rent: SAR 192,000. Payment: 2–4 cheques."
        ),
    },
    {
        "external_id": "MSK-064",
        "title": "3-Bed Apartment — Quba, Madinah, Premium Tower",
        "area": "Quba",
        "city": "Madinah",
        "size_sq_m": 175,
        "monthly_rent": 7000,
        "bedrooms": 3,
        "bathrooms": 3,
        "owner_name": "Wafa Al-Harbi",
        "status": "Published",
        "image_url": _IMG["apt_modern"],
        "description": (
            "Ref: MSK-064 | Finishing: Lux | Year built: 2020 | Floor: 5th of 10\n\n"
            "Well-appointed 3-bedroom apartment in the Quba district — Madinah's most "
            "historically significant and prestigious neighbourhood, adjacent to the Quba Mosque. "
            "This modern tower offers high-quality finishes rarely found in Madinah's apartment stock. "
            "Open-plan living and dining area with a balcony. Italian kitchen with Bosch appliances. "
            "All 3 bedrooms en-suite; master suite has a walk-in wardrobe.\n\n"
            "Building amenities: Rooftop terrace | Gym | 2 parking bays | 24-hr security | "
            "Lift × 2 | Fibre internet included | Water softener.\n\n"
            "Location: 3 min to Quba Mosque | 20 min to Prophet's Mosque | "
            "Near Madinah International Airport. Annual rent: SAR 84,000. Payment: 4 cheques."
        ),
    },
    {
        "external_id": "MSK-065",
        "title": "4-Bed Villa — Al Aziziyya, Madinah, New Build 2023",
        "area": "Al Aziziyya",
        "city": "Madinah",
        "size_sq_m": 400,
        "monthly_rent": 13000,
        "bedrooms": 4,
        "bathrooms": 5,
        "owner_name": "Noura Al-Amri",
        "status": "Published",
        "image_url": _IMG["villa_white"],
        "description": (
            "Ref: MSK-065 | Finishing: Super Lux | Year built: 2023 | Stand-alone villa | Never occupied\n\n"
            "Brand-new 4-bedroom stand-alone villa in Al Aziziyya — completed in late 2023 and "
            "never previously occupied. Stunning contemporary architecture with an elevated design "
            "suited to Madinah's climate: deep shaded terraces, south-facing orientation, and "
            "high-performance glazing. Ground floor: formal majlis, family lounge, dining room, "
            "and a premium kitchen (Bosch + Siemens appliances). Upper floor: 4 en-suite bedrooms; "
            "master suite has a walk-in wardrobe, a freestanding tub, and a private shaded balcony.\n\n"
            "Key features: VRV central A/C (new) | Solar water heater | Smart home system | "
            "3-car garage | Landscaped garden | Maid's room | CCTV | Fibre internet | "
            "Backup generator.\n\n"
            "Location: 18 min to Prophet's Mosque | 8 min to Islamic University | "
            "Near Madinah City Centre Mall. Annual rent: SAR 156,000. Payment: 2–4 cheques. "
            "Immediate handover."
        ),
    },
]


def seed():
    db = SessionLocal()
    inserted = 0
    updated = 0

    try:
        for data in PROPERTIES:
            existing = db.scalars(
                select(Property).where(Property.external_id == data["external_id"])
            ).first()

            if existing:
                for key, value in data.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                db.add(Property(**data))
                inserted += 1

        # ── Admin user ────────────────────────────────────────────────────────
        admin_email = "mnaushad.fms@gmail.com"
        admin_exists = db.scalars(select(User).where(User.email == admin_email)).first()
        if not admin_exists:
            db.add(User(
                email=admin_email,
                full_name="Maskan Admin",
                hashed_password=pwd_context.hash("Admin@1234"),
            ))
            print(f"  Admin user created: {admin_email} / Admin@1234")
        else:
            print(f"  Admin user already exists: {admin_email}")

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
