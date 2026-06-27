import { useEffect, useRef, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
import { BedDouble, Bath, MapPin, ExternalLink, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";

// ── Coordinates ───────────────────────────────────────────────────────────────

const CITY_CENTERS: Record<string, [number, number]> = {
  Riyadh:  [24.7136, 46.6753],
  Jeddah:  [21.4858, 39.1925],
  Dammam:  [26.4207, 50.0888],
  Khobar:  [26.2172, 50.1971],
  Madinah: [24.5247, 39.5692],
};

// "District|City" → [lat, lng]
const DISTRICT_COORDS: Record<string, [number, number]> = {
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

function getCoords(p: SearchProperty): [number, number] {
  const c = DISTRICT_COORDS[`${p.district}|${p.city}`];
  if (c) return c;
  return CITY_CENTERS[p.city] ?? CITY_CENTERS.Riyadh;
}

function jitter(val: number, seed: number, scale = 0.007): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return val + (x - Math.floor(x) - 0.5) * scale;
}

// ── Google Maps init ──────────────────────────────────────────────────────────

setOptions({
  key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string,
  v: "weekly",
});

type GMap = google.maps.Map;
type Marker = google.maps.marker.AdvancedMarkerElement;

// ── Component ─────────────────────────────────────────────────────────────────

export function PropertyMapView({ properties }: { properties: SearchProperty[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<GMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [selected, setSelected] = useState<SearchProperty | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Load Maps API once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Map: GMap } = await importLibrary("maps");
        if (cancelled || !mapRef.current) return;

        const firstCity = properties[0]?.city ?? "Riyadh";
        const [clat, clng] = CITY_CENTERS[firstCity] ?? CITY_CENTERS.Riyadh;

        mapObjRef.current = new GMap(mapRef.current, {
          center: { lat: clat, lng: clng },
          zoom: 12,
          mapId: "maskan_property_map",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        });
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setMapError("Unable to load Google Maps. Check your API key or network.");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh markers on every filter change
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !ready) return;

    // Always clear old markers synchronously so stale pins never linger
    for (const m of markersRef.current) m.map = null;
    markersRef.current = [];

    if (properties.length === 0) return;

    let cancelled = false;

    (async () => {
      const { AdvancedMarkerElement } = await importLibrary("marker") as google.maps.MarkerLibrary;
      if (cancelled) return;

      const bounds = new google.maps.LatLngBounds();

      properties.forEach((p, i) => {
        const [baseLat, baseLng] = getCoords(p);
        const lat = jitter(baseLat, Number(p.id) * 3 + i);
        const lng = jitter(baseLng, Number(p.id) * 7 + i + 13);
        bounds.extend({ lat, lng });

        const pin = document.createElement("div");
        Object.assign(pin.style, {
          background: "#5B21B6",
          color: "white",
          borderRadius: "20px",
          padding: "4px 10px",
          fontSize: "11px",
          fontWeight: "700",
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
          cursor: "pointer",
          border: "2px solid white",
          fontFamily: "system-ui,sans-serif",
          transition: "transform 0.1s",
        });
        pin.textContent = `SAR ${Math.round(p.price / 12).toLocaleString()}/mo`;
        pin.onmouseenter = () => { pin.style.transform = "scale(1.1)"; };
        pin.onmouseleave = () => { pin.style.transform = ""; };

        const marker = new AdvancedMarkerElement({ map, position: { lat, lng }, content: pin, title: p.title });
        marker.addListener("click", () => setSelected(p));
        markersRef.current.push(marker);
      });

      if (properties.length === 1) {
        const [lat, lng] = getCoords(properties[0]);
        map.setCenter({ lat, lng });
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
      }
    })();

    return () => { cancelled = true; };
  }, [properties, ready]);

  if (mapError) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-2xl border border-dashed border-border bg-card text-sm text-muted-foreground">
        {mapError}
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-220px)] min-h-[520px] overflow-hidden rounded-2xl border border-border shadow-card">
      <div ref={mapRef} className="size-full" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading map…
          </div>
        </div>
      )}

      {ready && (
        <div className="absolute left-3 top-3 rounded-xl border border-border bg-card/95 px-3 py-1.5 text-xs font-semibold shadow-card backdrop-blur">
          <MapPin className="mr-1 inline size-3.5 text-primary" />
          {properties.length} {properties.length === 1 ? "property" : "properties"} on map
        </div>
      )}

      {selected && (
        <div className="absolute bottom-4 left-1/2 w-full max-w-sm -translate-x-1/2 px-3">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
            <div className="relative aspect-[16/7] overflow-hidden bg-surface-2">
              <img src={selected.image} alt={selected.title} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="p-4">
              <p className="truncate font-display text-sm font-bold">{selected.title}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" /> {selected.district}, {selected.city}
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><BedDouble className="size-3.5" />{selected.bedrooms} BR</span>
                <span className="flex items-center gap-1"><Bath className="size-3.5" />{selected.bathrooms} BA</span>
                <span className="ml-auto font-display text-base font-bold text-foreground">
                  SAR {formatSAR(selected.price)}
                  <span className="text-xs font-normal text-muted-foreground">/yr</span>
                </span>
              </div>
              <Link
                to="/property/$id"
                params={{ id: selected.id }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ExternalLink className="size-3.5" /> View full details
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
