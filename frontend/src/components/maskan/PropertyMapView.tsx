import { useEffect, useRef, useState } from "react";
import { BedDouble, Bath, MapPin, ExternalLink, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Map as LeafletMap, Marker } from "leaflet";
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
  return DISTRICT_COORDS[`${p.district}|${p.city}`] ?? CITY_CENTERS[p.city] ?? CITY_CENTERS.Riyadh;
}

function jitter(val: number, seed: number, scale = 0.007): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return val + (x - Math.floor(x) - 0.5) * scale;
}

function injectLeafletCss() {
  if (document.getElementById("leaflet-css")) return;
  const link = document.createElement("link");
  link.id = "leaflet-css";
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PropertyMapView({ properties }: { properties: SearchProperty[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [selected, setSelected] = useState<SearchProperty | null>(null);
  const [ready, setReady] = useState(false);

  // Init map once on mount, destroy on unmount
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      injectLeafletCss();

      const firstCity = properties[0]?.city ?? "Riyadh";
      const [clat, clng] = CITY_CENTERS[firstCity] ?? CITY_CENTERS.Riyadh;

      const map = L.map(mapRef.current, {
        center: [clat, clng],
        zoom: 12,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      mapObjRef.current = map;
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapObjRef.current) {
        mapObjRef.current.remove();
        mapObjRef.current = null;
        markersRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh markers whenever filtered results change
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !ready) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    if (properties.length === 0) return;

    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled) return;
      const currentMap = mapObjRef.current;
      if (!currentMap) return;

      const latLngs: [number, number][] = [];

      properties.forEach((p, i) => {
        const [baseLat, baseLng] = getCoords(p);
        const lat = jitter(baseLat, Number(p.id) * 3 + i);
        const lng = jitter(baseLng, Number(p.id) * 7 + i + 13);
        latLngs.push([lat, lng]);

        const priceLabel = `SAR ${Math.round(p.price / 12).toLocaleString()}/mo`;

        const icon = L.divIcon({
          className: "",
          html: `<div style="background:#5B21B6;color:white;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.30);cursor:pointer;border:2px solid white;font-family:system-ui,sans-serif;transition:transform 0.1s;">${priceLabel}</div>`,
          iconSize: undefined,
          iconAnchor: [0, 0],
        });

        const marker = L.marker([lat, lng], { icon });
        marker.addTo(currentMap);
        marker.on("click", () => setSelected(p));
        markersRef.current.push(marker);
      });

      if (properties.length === 1) {
        currentMap.setView(latLngs[0], 14);
      } else {
        currentMap.fitBounds(L.latLngBounds(latLngs), { padding: [60, 60] });
      }
    })();

    return () => { cancelled = true; };
  }, [properties, ready]);

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
        <div className="absolute left-3 top-3 z-[1000] rounded-xl border border-border bg-card/95 px-3 py-1.5 text-xs font-semibold shadow-card backdrop-blur">
          <MapPin className="mr-1 inline size-3.5 text-primary" />
          {properties.length} {properties.length === 1 ? "property" : "properties"} on map
        </div>
      )}

      {selected && (
        <div className="absolute bottom-4 left-1/2 z-[1000] w-full max-w-sm -translate-x-1/2 px-3">
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
