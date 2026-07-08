import { DoorOpen, Key, MapPin, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { districtsByCity } from "@/lib/maskan-search-data";
import { useLanguage } from "@/lib/i18n/context";
import { allCategories, type ListingType } from "@/lib/listingCategories";
import { cn } from "@/lib/utils";

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

const RENT_BUDGET_OPTIONS = [
  { min: 0, max: 500000 },
  { min: 50000, max: 80000 },
  { min: 80000, max: 200000 },
  { min: 200000, max: 400000 },
  { min: 400000, max: 500000 },
] as const;

const RENT_BUDGET_LABEL_KEYS = [
  "searchBar.anyBudget",
  "searchBar.budget50to80",
  "searchBar.budget80to200",
  "searchBar.budget200to400",
  "searchBar.budget400plus",
];

const SALE_BUDGET_OPTIONS = [
  { min: 0, max: 30_000_000 },
  { min: 0, max: 500_000 },
  { min: 500_000, max: 1_500_000 },
  { min: 1_500_000, max: 5_000_000 },
  { min: 5_000_000, max: 30_000_000 },
] as const;

const SALE_BUDGET_LABEL_KEYS = [
  "searchBar.anyBudget",
  "searchBar.saleBudgetUnder500k",
  "searchBar.saleBudget500kTo1_5m",
  "searchBar.saleBudget1_5mTo5m",
  "searchBar.saleBudget5mPlus",
];

export type SearchBarFilters = {
  listingType: ListingType;
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
  onListingTypeChange,
}: {
  /** When provided, "Search" reports filters here instead of navigating to /search. */
  onSearch?: (filters: SearchBarFilters) => void;
  /** Fires immediately on Rent/Sale toggle click (before "Search" is pressed) — lets an
   * embedded map/preview below the bar react live instead of waiting for a full search. */
  onListingTypeChange?: (v: ListingType) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const locationOptions = buildLocationOptions((city) => t(`cities.${city}`));
  const [location, setLocation] = useState<LocationOption | null>(null);
  const [listingType, setListingType] = useState<ListingType>("rent");
  const [propertyType, setPropertyType] = useState("Any");
  const [budgetIdx, setBudgetIdx] = useState(0);

  const budgetOptions = listingType === "sale" ? SALE_BUDGET_OPTIONS : RENT_BUDGET_OPTIONS;
  const budgetLabelKeys = listingType === "sale" ? SALE_BUDGET_LABEL_KEYS : RENT_BUDGET_LABEL_KEYS;
  const propertyTypeKeys = ["Any", ...allCategories(listingType)];

  function switchListingType(v: ListingType) {
    setListingType(v);
    setPropertyType("Any");
    setBudgetIdx(0);
    onListingTypeChange?.(v);
  }

  function currentFilters(): SearchBarFilters {
    const budget = budgetOptions[budgetIdx];
    return {
      listingType,
      city: location?.city && location.city !== "Any" ? location.city : "Any",
      district: location?.district && location.district !== "Any" ? location.district : "Any",
      minRent: budget.min,
      maxRent: budget.max,
      type: propertyType,
    };
  }

  function toSearchParams(filters: SearchBarFilters): Record<string, string> {
    const params: Record<string, string> = { listingType: filters.listingType };
    if (filters.city !== "Any") params.city = filters.city;
    if (filters.district !== "Any") params.district = filters.district;
    const defaultMax = filters.listingType === "sale" ? 30_000_000 : 500_000;
    if (filters.minRent > 0) params.minRent = String(filters.minRent);
    if (filters.maxRent < defaultMax) params.maxRent = String(filters.maxRent);
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
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          onClick={() => switchListingType("rent")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            listingType === "rent" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <DoorOpen className="size-4" /> {t("listingCategories.rent")}
        </button>
        <button
          type="button"
          onClick={() => switchListingType("sale")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
            listingType === "sale" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Key className="size-4" /> {t("listingCategories.sale")}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">
        <LocationPicker options={locationOptions} value={location} onChange={setLocation} />

        <div className="grid grid-cols-2 border-t border-border md:contents">
          <label className="flex items-center gap-3 px-4 py-2.5 md:border-s md:border-t-0 md:py-3 cursor-pointer">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("searchBar.propertyType")}
              </div>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
              >
                {propertyTypeKeys.map((key) => (
                  <option key={key} value={key}>
                    {t(`propertyTypes.${key}`)}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <label className="flex items-center gap-3 border-s border-border px-4 py-2.5 md:border-t-0 md:py-3 cursor-pointer">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {listingType === "sale" ? t("searchBar.budget") : t("searchBar.budgetPerYear")}
              </div>
              <select
                value={budgetIdx}
                onChange={(e) => setBudgetIdx(Number(e.target.value))}
                className="w-full bg-transparent text-sm font-medium outline-none cursor-pointer"
              >
                {budgetOptions.map((_, i) => (
                  <option key={i} value={i}>
                    {t(budgetLabelKeys[i])}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

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
