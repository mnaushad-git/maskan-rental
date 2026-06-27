import { MapPin, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { districtsByCity } from "@/lib/maskan-search-data";

// ── Location options ──────────────────────────────────────────────────────────

type LocationOption = { label: string; city: string; district: string };

const LOCATION_OPTIONS: LocationOption[] = Object.entries(districtsByCity).flatMap(
  ([city, districts]) => [
    { label: city, city, district: "Any" },
    ...districts.map(d => ({ label: `${city}, ${d}`, city, district: d })),
  ]
);

// ── Budget options ────────────────────────────────────────────────────────────

const BUDGET_OPTIONS = [
  { label: "Any budget",       min: 0,      max: 500000 },
  { label: "SAR 50K — 80K",   min: 50000,  max: 80000  },
  { label: "SAR 80K — 200K",  min: 80000,  max: 200000 },
  { label: "SAR 200K — 400K", min: 200000, max: 400000 },
  { label: "SAR 400K+",       min: 400000, max: 500000 },
];

const PROPERTY_TYPES = ["Any type", "Apartment", "Villa", "Penthouse", "Townhouse"];

// ── LocationPicker ────────────────────────────────────────────────────────────

function LocationPicker({
  value,
  onChange,
}: {
  value: LocationOption | null;
  onChange: (opt: LocationOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? LOCATION_OPTIONS.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : LOCATION_OPTIONS;

  function select(opt: LocationOption) {
    onChange(opt);
    setQuery("");
    setOpen(false);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
    setQuery("");
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const displayText = value ? value.label : "";

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-surface cursor-text"
        onClick={() => setOpen(true)}
      >
        <MapPin className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Location
          </div>
          {open ? (
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && filtered.length > 0) select(filtered[0]);
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search city or district…"
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <div className="flex items-center justify-between gap-1">
              <span className={`truncate text-sm font-medium ${!displayText ? "text-muted-foreground" : ""}`}>
                {displayText || "City or district"}
              </span>
              {value && (
                <button type="button" onClick={clear} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-card shadow-elevated overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">No locations found</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => select(opt)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-surface transition-colors"
                >
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className={opt.district === "Any" ? "font-semibold" : "pl-3 text-muted-foreground"}>
                    {opt.label}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SearchBar ─────────────────────────────────────────────────────────────────

export function SearchBar() {
  const navigate = useNavigate();
  const [location, setLocation] = useState<LocationOption | null>(null);
  const [propertyType, setPropertyType] = useState("Any type");
  const [budgetIdx, setBudgetIdx] = useState(0);

  function handleSearch() {
    const budget = BUDGET_OPTIONS[budgetIdx];
    const params: Record<string, string> = {};
    if (location?.city && location.city !== "Any") params.city = location.city;
    if (location?.district && location.district !== "Any") params.district = location.district;
    if (budget.min > 0) params.minRent = String(budget.min);
    if (budget.max < 500000) params.maxRent = String(budget.max);
    if (propertyType !== "Any type") params.type = propertyType;
    void navigate({ to: "/search", search: params as never });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-2 shadow-elevated">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">

        <LocationPicker value={location} onChange={setLocation} />

        <label className="flex items-center gap-3 border-t border-border px-4 py-3 md:border-l md:border-t-0 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Property type
            </div>
            <select
              value={propertyType}
              onChange={e => setPropertyType(e.target.value)}
              className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
            >
              {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </label>

        <label className="flex items-center gap-3 border-t border-border px-4 py-3 md:border-l md:border-t-0 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Budget / year
            </div>
            <select
              value={budgetIdx}
              onChange={e => setBudgetIdx(Number(e.target.value))}
              className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
            >
              {BUDGET_OPTIONS.map((b, i) => <option key={b.label} value={i}>{b.label}</option>)}
            </select>
          </div>
        </label>

        <div className="flex items-center gap-2 p-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="All filters"
            onClick={() => void navigate({ to: "/search", search: {} as never })}
          >
            <SlidersHorizontal />
          </Button>
          <Button variant="hero" size="lg" className="flex-1 md:flex-none" onClick={handleSearch}>
            <Search /> Search
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 rounded-xl bg-ai-soft px-4 py-2.5 text-sm text-ai">
        <Sparkles className="size-4 shrink-0" />
        <span className="font-medium">Try:</span>
        <span className="truncate text-ai/80">
          "3 bedroom family villa in North Riyadh near international schools under SAR 200K"
        </span>
      </div>
    </div>
  );
}
