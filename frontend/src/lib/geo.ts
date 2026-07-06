// Shared district/city coordinates — used both to place map pins (PropertyMapView)
// and to resolve a user's browser geolocation to the nearest known city/district
// (LocationOnboarding), without depending on any external geocoding API.

export const CITY_CENTERS: Record<string, [number, number]> = {
  Riyadh:  [24.7136, 46.6753],
  Jeddah:  [21.4858, 39.1925],
  Dammam:  [26.4207, 50.0888],
  Khobar:  [26.2172, 50.1971],
  Madinah: [24.5247, 39.5692],
};

export const DISTRICT_COORDS: Record<string, [number, number]> = {
  "Al Yasmin|Riyadh":            [24.8341, 46.6349],
  "Al Narjis|Riyadh":            [24.8156, 46.6285],
  "Al Malqa|Riyadh":             [24.8028, 46.6214],
  "Al Olaya|Riyadh":             [24.6939, 46.6868],
  "Al Rawdah|Riyadh":            [24.7082, 46.6786],
  "Al Faisaliyah|Riyadh":        [24.6901, 46.6757],
  "University District|Riyadh":  [24.6458, 46.7116],
  "Hitteen|Riyadh":              [24.7917, 46.6375],
  "Al Sahafah|Riyadh":           [24.7672, 46.6291],
  "Al Nakheel|Riyadh":           [24.7714, 46.6603],
  "Diplomatic Quarter|Riyadh":   [24.6817, 46.6242],
  "Qurtuba|Riyadh":              [24.7229, 46.7342],
  "Al Sulimaniyah|Riyadh":       [24.7008, 46.6834],
  "Al Hamra|Jeddah":             [21.5169, 39.1489],
  "Al Zahraa|Jeddah":            [21.5421, 39.1726],
  "Obhur Al Shamaliyah|Jeddah":  [21.7353, 39.1186],
  "Al Khalidiyyah|Jeddah":       [21.5285, 39.1733],
  "Al Rawdah|Jeddah":            [21.5392, 39.1842],
  "Al Shati|Jeddah":             [21.5622, 39.1341],
  "Al Andalus|Jeddah":           [21.5061, 39.2108],
  "Al Murjaan|Jeddah":           [21.5789, 39.1253],
  "Al Naim|Jeddah":              [21.4658, 39.2244],
  "Al Basateen|Jeddah":          [21.6512, 39.1478],
  "Al Faisaliyyah|Dammam":       [26.4312, 50.1027],
  "Al Adamah|Dammam":            [26.4089, 50.0973],
  "Al Mazrouiyah|Dammam":        [26.4521, 50.1342],
  "Al Nuzha|Dammam":             [26.4178, 50.0834],
  "Al Badiyah|Dammam":           [26.3987, 50.1186],
  "Al Shulah|Dammam":            [26.4634, 50.0741],
  "Al Fursan|Dammam":            [26.3856, 50.1423],
  "Al Shati|Dammam":             [26.4489, 50.0621],
  "Al Aqrabiyah|Khobar":         [26.2198, 50.2014],
  "Al Thuqbah|Khobar":           [26.2031, 50.2187],
  "Al Bandariyah|Khobar":        [26.2312, 50.1876],
  "Al Aziziyah|Khobar":          [26.1942, 50.2341],
  "Al Rawabi|Khobar":            [26.2134, 50.2452],
  "Al Khalidiyya|Madinah":       [24.5389, 39.5842],
  "Al Aziziyya|Madinah":         [24.5012, 39.5634],
  "Quba|Madinah":                [24.4889, 39.6012],
  "Al Salam|Madinah":            [24.5178, 39.5512],
  "Al Bayan|Madinah":            [24.5523, 39.5731],
  "Bani Haritha|Madinah":        [24.5712, 39.5423],
  "Al Aqoul|Madinah":            [24.5089, 39.5978],
};

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest known district (and its city) to a given lat/lng, using only our own seeded coordinates — no external geocoding API required. */
export function nearestDistrict(lat: number, lng: number): { city: string; district: string; distanceKm: number } {
  let best: { city: string; district: string; distanceKm: number } | null = null;
  for (const [key, coords] of Object.entries(DISTRICT_COORDS)) {
    const [district, city] = key.split("|");
    const d = haversineKm([lat, lng], coords);
    if (!best || d < best.distanceKm) best = { city, district, distanceKm: d };
  }
  return best!;
}

/** Nearest known city center (coarser fallback if no district is close enough). */
export function nearestCity(lat: number, lng: number): { city: string; distanceKm: number } {
  let best: { city: string; distanceKm: number } | null = null;
  for (const [city, coords] of Object.entries(CITY_CENTERS)) {
    const d = haversineKm([lat, lng], coords);
    if (!best || d < best.distanceKm) best = { city, distanceKm: d };
  }
  return best!;
}
