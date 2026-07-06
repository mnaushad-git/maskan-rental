import { useEffect, useRef, useState } from "react";
import { BedDouble, Bath, MapPin, ExternalLink, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { SearchProperty } from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import { CITY_CENTERS, DISTRICT_COORDS } from "@/lib/geo";
import { useLanguage } from "@/lib/i18n/context";

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
  const { t } = useLanguage();
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
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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

    return () => {
      cancelled = true;
    };
  }, [properties, ready]);

  return (
    <div className="relative h-[calc(100vh-220px)] min-h-[520px] overflow-hidden rounded-2xl border border-border shadow-card">
      <div ref={mapRef} className="size-full" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            {t("map.loadingMap")}
          </div>
        </div>
      )}

      {ready && (
        <div className="absolute start-3 top-3 z-[1000] rounded-xl border border-border bg-card/95 px-3 py-1.5 text-xs font-semibold shadow-card backdrop-blur">
          <MapPin className="me-1 inline size-3.5 text-primary" />
          {t(properties.length === 1 ? "map.propertyCountSingular" : "map.propertyCountPlural", {
            count: properties.length,
          })}
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
                className="absolute end-2 top-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background"
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
                <span className="flex items-center gap-1">
                  <BedDouble className="size-3.5" />
                  {selected.bedrooms} {t("map.bedroomsAbbr")}
                </span>
                <span className="flex items-center gap-1">
                  <Bath className="size-3.5" />
                  {selected.bathrooms} {t("map.bathroomsAbbr")}
                </span>
                <span className="ms-auto font-display text-base font-bold text-foreground">
                  SAR {formatSAR(selected.price)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("map.perYear")}
                  </span>
                </span>
              </div>
              <Link
                to="/property/$id"
                params={{ id: selected.id }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ExternalLink className="size-3.5" /> {t("map.viewFullDetails")}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
