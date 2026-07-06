import { MapPin, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";

// ── Location options ──────────────────────────────────────────────────────────
// District/neighbourhood names stay in their original form in both languages —
// they're proper nouns matched against backend area data, not free UI copy.

type LocationOption = { label: string; city: string; district: string };

function buildLocationOptions(tCity: (city: string) => string): LocationOption[] {
  return Object.entries(districtsByCity).flatMap(([city, districts]) => [
    { label: tCity(city), city, district: "Any" },
    ...districts.map((d) => ({ label: `${tCity(city)}, ${d}`, city, district: d })),
  ]);
}

// ── Budget options ────────────────────────────────────────────────────────────

const BUDGET_OPTIONS = [
  { min: 0, max: 500000 },
  { min: 50000, max: 80000 },
  { min: 80000, max: 200000 },
  { min: 200000, max: 400000 },
  { min: 400000, max: 500000 },
] as const;

const BUDGET_LABEL_KEYS = [
  "searchBar.anyBudget",
  "searchBar.budget50to80",
  "searchBar.budget80to200",
  "searchBar.budget200to400",
  "searchBar.budget400plus",
];

const PROPERTY_TYPE_KEYS = ["Any", "Apartment", "Villa", "Penthouse", "Townhouse"];

export type SearchBarFilters = {
  city: string;
  district: string;
  minRent: number;
  maxRent: number;
  type: string;
};

// ── LocationPicker ────────────────────────────────────────────────────────────

function LocationPicker({
  options,
  value,
  onChange,
}: {
  options: LocationOption[];
  value: LocationOption | null;
  onChange: (opt: LocationOption | null) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

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
            {t("searchBar.location")}
          </div>
          {open ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) select(filtered[0]);
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder={t("searchBar.searchLocationPlaceholder")}
              className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <div className="flex items-center justify-between gap-1">
              <span
                className={`truncate text-sm font-medium ${!displayText ? "text-muted-foreground" : ""}`}
              >
                {displayText || t("searchBar.cityOrDistrict")}
              </span>
              {value && (
                <button
                  type="button"
                  onClick={clear}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="absolute start-0 top-full z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-elevated overflow-hidden sm:w-72">
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {t("searchBar.noLocationsFound")}
              </div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => select(opt)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-start hover:bg-surface transition-colors"
                >
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className={
                      opt.district === "Any" ? "font-semibold" : "ps-3 text-muted-foreground"
                    }
                  >
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

export function SearchBar({
  onSearch,
}: {
  /** When provided, "Search" reports filters here instead of navigating to /search. */
  onSearch?: (filters: SearchBarFilters) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const locationOptions = buildLocationOptions((city) => t(`cities.${city}`));
  const [location, setLocation] = useState<LocationOption | null>(null);
  const [propertyType, setPropertyType] = useState("Any");
  const [budgetIdx, setBudgetIdx] = useState(0);

  function currentFilters(): SearchBarFilters {
    const budget = BUDGET_OPTIONS[budgetIdx];
    return {
      city: location?.city && location.city !== "Any" ? location.city : "Any",
      district: location?.district && location.district !== "Any" ? location.district : "Any",
      minRent: budget.min,
      maxRent: budget.max,
      type: propertyType,
    };
  }

  function toSearchParams(filters: SearchBarFilters): Record<string, string> {
    const params: Record<string, string> = {};
    if (filters.city !== "Any") params.city = filters.city;
    if (filters.district !== "Any") params.district = filters.district;
    if (filters.minRent > 0) params.minRent = String(filters.minRent);
    if (filters.maxRent < 500000) params.maxRent = String(filters.maxRent);
    if (filters.type !== "Any") params.type = filters.type;
    return params;
  }

  function handleSearch() {
    const filters = currentFilters();
    if (onSearch) {
      onSearch(filters);
      return;
    }
    void navigate({ to: "/search", search: toSearchParams(filters) as never });
  }

  function handleMoreFilters() {
    void navigate({ to: "/search", search: toSearchParams(currentFilters()) as never });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-2 shadow-elevated">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <LocationPicker options={locationOptions} value={location} onChange={setLocation} />

        <label className="flex items-center gap-3 border-t border-border px-4 py-3 md:border-s md:border-t-0 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("searchBar.propertyType")}
            </div>
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
            >
              {PROPERTY_TYPE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`propertyTypes.${key}`)}
                </option>
              ))}
            </select>
          </div>
        </label>

        <label className="flex items-center gap-3 border-t border-border px-4 py-3 md:border-s md:border-t-0 cursor-pointer">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("searchBar.budgetPerYear")}
            </div>
            <select
              value={budgetIdx}
              onChange={(e) => setBudgetIdx(Number(e.target.value))}
              className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
            >
              {BUDGET_OPTIONS.map((_, i) => (
                <option key={i} value={i}>
                  {t(BUDGET_LABEL_KEYS[i])}
                </option>
              ))}
            </select>
          </div>
        </label>

        <div className="flex items-center gap-2 p-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("searchBar.allFilters")}
            onClick={handleMoreFilters}
          >
            <SlidersHorizontal />
          </Button>
          <Button variant="hero" size="lg" className="flex-1 md:flex-none" onClick={handleSearch}>
            <Search /> {t("searchBar.search")}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 overflow-hidden rounded-xl bg-ai-soft px-4 py-2.5 text-sm text-ai">
        <Sparkles className="size-4 shrink-0" />
        <span className="shrink-0 font-medium">{t("searchBar.tryPrefix")}</span>
        <span className="min-w-0 truncate text-ai/80">"{t("searchBar.tryExample")}"</span>
      </div>
    </div>
  );
}
