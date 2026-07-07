import { useEffect, useRef, useState } from "react";
import { BedDouble, Bath, MapPin, ExternalLink, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
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

// Compact "150K" / "1.3M" style labels so the pin stays small — a full
// "SAR 1,300,000" figure would overwhelm a map-pin-sized tag.
function formatPinPrice(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

// Hides business/transit POI clutter so the map reads clean, matching the
// rest of the product's minimal aesthetic instead of default Google chrome.
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

declare global {
  interface Window {
    __initGoogleMaps?: () => void;
  }
}

let mapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  // google.maps.Map etc. are only guaranteed present once the classic
  // callback fires — window.google can exist as a stub before that.
  if (window.google?.maps?.Map) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      reject(new Error("Missing VITE_GOOGLE_MAPS_API_KEY"));
      return;
    }
    if (document.getElementById("google-maps-script")) {
      // Script tag already exists from a previous mount — poll until the
      // callback it's waiting on has populated google.maps.Map.
      const check = setInterval(() => {
        if (window.google?.maps?.Map) {
          clearInterval(check);
          resolve();
        }
      }, 50);
      return;
    }
    window.__initGoogleMaps = () => resolve();
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__initGoogleMaps`;
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return mapsLoadPromise;
}

// Custom HTML pin (Google's classic Marker only supports image icons — this
// OverlayView subclass renders the same styled price-bubble the old Leaflet
// divIcon used, without requiring a Cloud Map ID for Advanced Markers).
type HtmlMarkerCtor = new (
  position: google.maps.LatLng,
  html: string,
  onClick: () => void,
) => google.maps.OverlayView;

let HtmlMarkerImpl: HtmlMarkerCtor | null = null;

function getHtmlMarkerClass(): HtmlMarkerCtor {
  if (HtmlMarkerImpl) return HtmlMarkerImpl;

  class HtmlMarker extends google.maps.OverlayView {
    private div: HTMLDivElement | null = null;
    constructor(
      private position: google.maps.LatLng,
      private html: string,
      private onClickHandler: () => void,
    ) {
      super();
    }
    onAdd() {
      const div = document.createElement("div");
      div.style.position = "absolute";
      div.style.cursor = "pointer";
      div.innerHTML = this.html;
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onClickHandler();
      });
      this.div = div;
      this.getPanes()?.overlayMouseTarget.appendChild(div);
    }
    draw() {
      if (!this.div) return;
      const point = this.getProjection()?.fromLatLngToDivPixel(this.position);
      if (point) {
        this.div.style.left = `${point.x}px`;
        this.div.style.top = `${point.y}px`;
        this.div.style.transform = "translate(-50%, -100%)";
      }
    }
    onRemove() {
      this.div?.remove();
      this.div = null;
    }
  }

  HtmlMarkerImpl = HtmlMarker;
  return HtmlMarker;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PropertyMapView({ properties }: { properties: SearchProperty[] }) {
  const { t } = useLanguage();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.OverlayView[]>([]);
  const [selected, setSelected] = useState<SearchProperty | null>(null);
  const [ready, setReady] = useState(false);

  // Init map once on mount
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapRef.current) return;

        const firstCity = properties[0]?.city ?? "Riyadh";
        const [clat, clng] = CITY_CENTERS[firstCity] ?? CITY_CENTERS.Riyadh;

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: clat, lng: clng },
          zoom: 12,
          styles: MAP_STYLES,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
        });

        mapObjRef.current = map;
        setReady(true);
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      cancelled = true;
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
      mapObjRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh markers whenever filtered results change
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !ready) return;

    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];

    if (properties.length === 0) return;

    const HtmlMarker = getHtmlMarkerClass();
    const positions: google.maps.LatLng[] = [];

    properties.forEach((p, i) => {
      const [baseLat, baseLng] = getCoords(p);
      const lat = jitter(baseLat, Number(p.id) * 3 + i);
      const lng = jitter(baseLng, Number(p.id) * 7 + i + 13);
      const position = new google.maps.LatLng(lat, lng);
      positions.push(position);

      const isSale = p.listingType === "sale";
      const color = isSale ? "#D97706" : "#16A34A";
      const priceLabel = isSale
        ? formatPinPrice(p.price)
        : `${formatPinPrice(p.price / 12)}/mo`;
      // Small pin-style tag (rounded badge + downward pointer), matching a
      // classic map-pin look rather than a large pill.
      const html = `
        <div style="display:flex;flex-direction:column;align-items:center;">
          <div style="background:${color};color:white;border-radius:6px;padding:3px 7px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.35);border:1.5px solid white;font-family:system-ui,sans-serif;line-height:1.3;">${priceLabel}</div>
          <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color};margin-top:-1px;"></div>
        </div>`;

      const marker = new HtmlMarker(position, html, () => setSelected(p));
      marker.setMap(map);
      markersRef.current.push(marker);
    });

    if (positions.length === 1) {
      map.setCenter(positions[0]);
      map.setZoom(14);
    } else {
      const bounds = new google.maps.LatLngBounds();
      positions.forEach((pos) => bounds.extend(pos));
      map.fitBounds(bounds, 60);
    }
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
                  {selected.listingType !== "sale" && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("map.perYear")}
                    </span>
                  )}
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
