"""District/city center coordinates used to assign each property a map
location, mirrored from mobile/src/lib/geo.ts (kept in sync manually — no
external geocoding API is used since properties only have area/city, not a
street address).
"""

CITY_CENTERS: dict[str, tuple[float, float]] = {
    "Riyadh": (24.7136, 46.6753),
    "Jeddah": (21.4858, 39.1925),
    "Dammam": (26.4207, 50.0888),
    "Khobar": (26.2172, 50.1971),
    "Madinah": (24.5247, 39.5692),
}

DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Al Yasmin|Riyadh": (24.8341, 46.6349),
    "Al Narjis|Riyadh": (24.8156, 46.6285),
    "Al Malqa|Riyadh": (24.8028, 46.6214),
    "Al Olaya|Riyadh": (24.6939, 46.6868),
    "Al Rawdah|Riyadh": (24.7082, 46.6786),
    "Al Faisaliyah|Riyadh": (24.6901, 46.6757),
    "University District|Riyadh": (24.6458, 46.7116),
    "Hitteen|Riyadh": (24.7917, 46.6375),
    "Al Sahafah|Riyadh": (24.7672, 46.6291),
    "Al Nakheel|Riyadh": (24.7714, 46.6603),
    "Diplomatic Quarter|Riyadh": (24.6817, 46.6242),
    "Qurtuba|Riyadh": (24.7229, 46.7342),
    "Al Sulimaniyah|Riyadh": (24.7008, 46.6834),
    "Al Hamra|Jeddah": (21.5169, 39.1489),
    "Al Zahraa|Jeddah": (21.5421, 39.1726),
    "Obhur Al Shamaliyah|Jeddah": (21.7353, 39.1186),
    "Al Khalidiyyah|Jeddah": (21.5285, 39.1733),
    "Al Rawdah|Jeddah": (21.5392, 39.1842),
    "Al Shati|Jeddah": (21.5622, 39.1341),
    "Al Andalus|Jeddah": (21.5061, 39.2108),
    "Al Murjaan|Jeddah": (21.5789, 39.1253),
    "Al Naim|Jeddah": (21.4658, 39.2244),
    "Al Basateen|Jeddah": (21.6512, 39.1478),
    "Al Faisaliyyah|Dammam": (26.4312, 50.1027),
    "Al Adamah|Dammam": (26.4089, 50.0973),
    "Al Mazrouiyah|Dammam": (26.4521, 50.1342),
    "Al Nuzha|Dammam": (26.4178, 50.0834),
    "Al Badiyah|Dammam": (26.3987, 50.1186),
    "Al Shulah|Dammam": (26.4634, 50.0741),
    "Al Fursan|Dammam": (26.3856, 50.1423),
    "Al Shati|Dammam": (26.4489, 50.0621),
    "Al Aqrabiyah|Khobar": (26.2198, 50.2014),
    "Al Thuqbah|Khobar": (26.2031, 50.2187),
    "Al Bandariyah|Khobar": (26.2312, 50.1876),
    "Al Aziziyah|Khobar": (26.1942, 50.2341),
    "Al Rawabi|Khobar": (26.2134, 50.2452),
    "Al Khalidiyya|Madinah": (24.5389, 39.5842),
    "Al Aziziyya|Madinah": (24.5012, 39.5634),
    "Quba|Madinah": (24.4889, 39.6012),
    "Al Salam|Madinah": (24.5178, 39.5512),
    "Al Bayan|Madinah": (24.5523, 39.5731),
    "Bani Haritha|Madinah": (24.5712, 39.5423),
    "Al Aqoul|Madinah": (24.5089, 39.5978),
}


def _jitter(val: float, seed: float, scale: float = 0.007) -> float:
    import math

    x = math.sin(seed * 127.1) * 43758.5453
    frac = x - math.floor(x)
    return val + (frac - 0.5) * scale


def coords_for(area: str, city: str, seed: int) -> tuple[float, float]:
    """Deterministic lat/lng for a property: district (or city) center, nudged
    by a small per-property jitter so pins in the same district don't stack.
    Matches the formula mobile's PropertyMapView used to compute client-side
    (jitter(lat, id*3), jitter(lng, id*7+13)) so existing pin placement for
    already-seeded properties doesn't visibly move once this becomes server-driven.
    """
    base_lat, base_lng = DISTRICT_COORDS.get(f"{area}|{city}") or CITY_CENTERS.get(city) or CITY_CENTERS["Riyadh"]
    lat = _jitter(base_lat, seed * 3)
    lng = _jitter(base_lng, seed * 7 + 13)
    return lat, lng
