import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Bath,
  BedDouble,
  Briefcase,
  Building2,
  Car,
  CheckCircle2,
  ChevronLeft,
  Dumbbell,
  GitCompare,
  Heart,
  LayoutGrid,
  List,
  Map,
  MapPin,
  Maximize,
  Phone,
  Search,
  SlidersHorizontal,
  Sofa,
  Sparkles,
  Trees,
  Waves,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { ScoreRing } from "@/components/maskan/ScoreIndicator";
import { fetchProperties, fetchSavedProperties, saveProperty, deleteSavedProperty, mapApiSearchProperty, fetchAreaIntelligenceList, fetchAreas, enrichPropertiesWithScores, type ApiAreaIntelligenceSummary, type ApiAreaSummary } from "@/lib/api/maskan";
import { PropertyMapView } from "@/components/maskan/PropertyMapView";
import { useAuth } from "@/lib/auth-context";
import {
  districtsByCity,
  type SearchProperty,
} from "@/lib/maskan-search-data";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";
import { ListingCategoryBar } from "@/components/maskan/ListingCategoryBar";
import { allCategories, type ListingType } from "@/lib/listingCategories";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search Rentals — Maskan" },
      {
        name: "description",
        content:
          "Search verified rental properties across Saudi Arabia. Filter by city, district, rent, bedrooms and amenities. Ranked by property score.",
      },
      { property: "og:title", content: "Search Rentals — Maskan" },
      {
        property: "og:description",
        content: "AI-powered rental search across Saudi Arabia.",
      },
    ],
  }),
  component: SearchPage,
});

type Filters = {
  listingType: ListingType;
  city: string;
  district: string;
  minRent: number;
  maxRent: number;
  bedrooms: number; // 0 = any
  bathrooms: number;
  type: string;
  furnishing: string;
  parking: boolean;
  balcony: boolean;
  gym: boolean;
  pool: boolean;
};

const DEFAULTS: Filters = {
  listingType: "rent",
  city: "Any",
  district: "Any",
  minRent: 0,
  maxRent: 500000,
  bedrooms: 0,
  bathrooms: 0,
  type: "Any",
  furnishing: "Any",
  parking: false,
  balcony: false,
  gym: false,
  pool: false,
};

// Small helper so call sites can write tSearch("clear") instead of t("search.clear").
function useSearchT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`search.${key}`, vars);
}

function SearchPage() {
  const { user } = useAuth();
  const tSearch = useSearchT();
  const rawSearch = useRouterState({ select: s => s.location.searchStr });
  const _qs = new URLSearchParams(rawSearch);
  const initialListingType = (_qs.get("listingType") as ListingType) ?? "rent";
  const [filters, setFilters] = useState<Filters>({
    ...DEFAULTS,
    listingType: initialListingType,
    city:     _qs.get("city")     ?? "Any",
    district: _qs.get("district") ?? "Any",
    minRent:  Number(_qs.get("minRent") ?? 0),
    maxRent:  Number(_qs.get("maxRent") ?? (initialListingType === "sale" ? 30_000_000 : 500_000)),
    type:     _qs.get("type")     ?? "Any",
  });
  const [view, setView] = useState<"grid" | "list" | "map">("map");
  const [sort, setSort] = useState<"match" | "price-asc" | "price-desc" | "value">("match");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  // Maps property id (string) → saved-record id (number) for API delete calls
  const [savedMap, setSavedMap] = useState<Record<string, number>>({});
  const [properties, setProperties] = useState<SearchProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        setLoading(true);
        setError(null);
        const [data, savedList] = await Promise.all([
          fetchProperties(),
          user ? fetchSavedProperties(user.id) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const mapped = data.map(mapApiSearchProperty);
        setProperties(mapped);
        const map: Record<string, number> = {};
        for (const s of savedList) map[String(s.property_id)] = s.id;
        setSavedMap(map);
        setLoading(false);

        // Enrich scores with area intel in the background (non-blocking)
        const [intelList, areaList] = await Promise.all([
          fetchAreaIntelligenceList().catch((): ApiAreaIntelligenceSummary[] => []),
          fetchAreas().catch((): ApiAreaSummary[] => []),
        ]);
        if (cancelled) return;
        const avgMap: Record<string, number> = {};
        for (const a of areaList) avgMap[a.name.toLowerCase()] = a.average_rent;
        setProperties((prev) => enrichPropertiesWithScores(prev, intelList, avgMap));
      } catch {
        if (!cancelled) {
          setError(tSearch("errorLoading"));
          setProperties([]);
          setLoading(false);
        }
      }
    }

    void loadAll();

    // Re-fetch silently when admin switches tabs back to the user portal
    function onVisible() {
      if (!document.hidden && !cancelled) void loadAll();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
    // tSearch intentionally omitted — switching language shouldn't re-fetch listings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const results = useMemo(() => {
    const list = properties.filter((p) => {
      if (p.listingType !== filters.listingType) return false;
      if (filters.city !== "Any" && p.city !== filters.city) return false;
      if (filters.district !== "Any" && p.district !== filters.district) return false;
      if (p.price < filters.minRent || p.price > filters.maxRent) return false;
      if (filters.bedrooms && p.bedrooms < filters.bedrooms) return false;
      if (filters.bathrooms && p.bathrooms < filters.bathrooms) return false;
      if (filters.type !== "Any" && p.type !== filters.type) return false;
      if (filters.furnishing !== "Any" && p.furnished !== filters.furnishing) return false;
      if (filters.parking && !p.amenities.parking) return false;
      if (filters.balcony && !p.amenities.balcony) return false;
      if (filters.gym && !p.amenities.gym) return false;
      if (filters.pool && !p.amenities.pool) return false;
      return true;
    });
    const sorted = [...list];
    if (sort === "match") sorted.sort((a, b) => b.matchScore - a.matchScore);
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "value") sorted.sort((a, b) => b.rentalScore - a.rentalScore);
    return sorted;
  }, [filters, properties, sort]);

  const toggleCompare = (id: string) =>
    setCompare((c) =>
      c.includes(id) ? c.filter((x) => x !== id) : c.length < 3 ? [...c, id] : c,
    );

  const toggleSave = async (id: string) => {
    if (!user) return;
    if (id in savedMap) {
      const recordId = savedMap[id];
      setSavedMap((m) => { const next = { ...m }; delete next[id]; return next; });
      try {
        await deleteSavedProperty(recordId);
      } catch {
        setSavedMap((m) => ({ ...m, [id]: recordId }));
      }
    } else {
      setSavedMap((m) => ({ ...m, [id]: -1 }));
      try {
        const record = await saveProperty(user.id, Number(id));
        setSavedMap((m) => ({ ...m, [id]: record.id }));
      } catch {
        setSavedMap((m) => { const next = { ...m }; delete next[id]; return next; });
      }
    }
  };

  const activeFilterCount = [
    filters.city !== "Any",
    filters.district !== "Any",
    filters.minRent > 0,
    filters.maxRent < 500000,
    filters.bedrooms > 0,
    filters.bathrooms > 0,
    filters.type !== "Any",
    filters.furnishing !== "Any",
    filters.parking,
    filters.balcony,
    filters.gym,
    filters.pool,
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-6">
        <Breadcrumbs city={filters.city} />

        <ListingCategoryBar
          className="mt-4"
          listingType={filters.listingType}
          onListingTypeChange={(v) => setFilters({
            ...filters,
            listingType: v,
            type: "Any",
            minRent: 0,
            maxRent: v === "sale" ? 30_000_000 : 500_000,
          })}
          propertyType={filters.type}
          onPropertyTypeChange={(v) => setFilters({ ...filters, type: v })}
        />

        <ResultsHeader
          count={results.length}
          listingType={filters.listingType}
          sort={sort}
          setSort={setSort}
          view={view}
          setView={setView}
        />

        {loading && (
          <p className="mt-3 text-sm text-muted-foreground">{tSearch("loadingListings")}</p>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {/* Mobile-only filter trigger bar */}
        <div className="mt-4 flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-sm"
          >
            <SlidersHorizontal className="size-4" />
            {tSearch("filters")}
            {activeFilterCount > 0 && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULTS)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" /> {tSearch("clear")}
            </button>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <FiltersPanel filters={filters} setFilters={setFilters} />
          {view === "map" ? (
            <PropertyMapView properties={results} />
          ) : (
            <ResultsPanel
              results={results}
              view={view}
              compare={compare}
              savedMap={savedMap}
              city={filters.city}
              district={filters.district}
              onToggleCompare={toggleCompare}
              onToggleSave={toggleSave}
            />
          )}
        </div>
      </div>

      {compare.length > 0 && (
        <CompareBar
          count={compare.length}
          onClear={() => setCompare([])}
        />
      )}

      <MobileFilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        setFilters={setFilters}
        resultsCount={results.length}
      />
    </div>
  );
}

function Breadcrumbs({ city }: { city: string }) {
  const { t } = useLanguage();
  const tSearch = useSearchT();
  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground">
        <ChevronLeft className="size-3.5 rtl:rotate-180" /> {tSearch("backToHome")}
      </Link>
      <span>·</span>
      <span>{tSearch("breadcrumb")}</span>
      {city !== "Any" && (
        <>
          <span>·</span>
          <span className="text-foreground">{t(`cities.${city}`)}</span>
        </>
      )}
    </nav>
  );
}

function ResultsHeader({
  count,
  listingType,
  sort,
  setSort,
  view,
  setView,
}: {
  count: number;
  listingType: ListingType;
  sort: string;
  setSort: (s: "match" | "price-asc" | "price-desc" | "value") => void;
  view: "grid" | "list" | "map";
  setView: (v: "grid" | "list" | "map") => void;
}) {
  const tSearch = useSearchT();
  const headingKey = listingType === "sale"
    ? (count === 1 ? "resultsHeadingSaleSingular" : "resultsHeadingSalePlural")
    : (count === 1 ? "resultsHeadingSingular" : "resultsHeadingPlural");
  return (
    <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {tSearch(headingKey, { count })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{tSearch("rankedBy")}</p>
      </div>
      <div className="flex items-center gap-2">
        {view !== "map" && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-sm">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as never)}
              className="bg-transparent text-sm font-medium outline-none"
            >
              <option value="match">{tSearch("sortBestScore")}</option>
              <option value="value">{tSearch("sortBestValue")}</option>
              <option value="price-asc">{tSearch("sortPriceLowHigh")}</option>
              <option value="price-desc">{tSearch("sortPriceHighLow")}</option>
            </select>
          </div>
        )}
        <div className="flex items-center rounded-xl border border-border bg-card p-1 shadow-sm">
          <button
            onClick={() => setView("grid")}
            aria-label={tSearch("gridView")}
            className={cn(
              "grid size-8 place-items-center rounded-lg transition-colors",
              view === "grid" ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            onClick={() => setView("list")}
            aria-label={tSearch("listView")}
            className={cn(
              "grid size-8 place-items-center rounded-lg transition-colors",
              view === "list" ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="size-4" />
          </button>
          <button
            onClick={() => setView("map")}
            aria-label={tSearch("mapView")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
              view === "map"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Map className="size-3.5" /> {tSearch("mapView")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Filters -------------------------------- */

// Inner filter fields — shared between desktop sidebar and mobile bottom sheet
function FilterFields({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const { t } = useLanguage();
  const tSearch = useSearchT();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters({ ...filters, [k]: v });

  const cities = ["Any", "Riyadh", "Jeddah", "Dammam", "Khobar", "Madinah"];
  const districts =
    filters.city === "Any" ? ["Any"] : ["Any", ...(districtsByCity[filters.city] ?? [])];
  const types = ["Any", ...allCategories(filters.listingType)];
  const furnishings = ["Any", "Furnished", "Semi-furnished", "Unfurnished"];

  return (
    <div className="space-y-5">
      <Field label={tSearch("city")}>
        <Select value={filters.city} onChange={(v) => setFilters({ ...filters, city: v, district: "Any" })}>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c === "Any" ? t("onboarding.any") : t(`cities.${c}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={tSearch("district")}>
        <Select value={filters.district} onChange={(v) => set("district", v)}>
          {districts.map((d) => (
            <option key={d} value={d}>
              {d === "Any" ? t("onboarding.any") : d}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={tSearch(filters.listingType === "sale" ? "minPrice" : "minRent")}>
          <NumberInput value={filters.minRent} onChange={(v) => set("minRent", v)} step={5000} placeholder="0" />
        </Field>
        <Field label={tSearch(filters.listingType === "sale" ? "maxPrice" : "maxRent")}>
          <NumberInput value={filters.maxRent} onChange={(v) => set("maxRent", v)} step={5000} placeholder="500,000" />
        </Field>
      </div>

      <Field label={tSearch("bedrooms")}>
        <SegmentedControl
          value={String(filters.bedrooms)}
          options={["0", "1", "2", "3", "4", "5"]}
          labels={[
            t("onboarding.any"),
            tSearch("anyPlus1"),
            tSearch("anyPlus2"),
            tSearch("anyPlus3"),
            tSearch("anyPlus4"),
            tSearch("anyPlus5"),
          ]}
          onChange={(v) => set("bedrooms", Number(v))}
        />
      </Field>

      <Field label={tSearch("bathrooms")}>
        <SegmentedControl
          value={String(filters.bathrooms)}
          options={["0", "1", "2", "3", "4"]}
          labels={[
            t("onboarding.any"),
            tSearch("anyPlus1"),
            tSearch("anyPlus2"),
            tSearch("anyPlus3"),
            tSearch("anyPlus4"),
          ]}
          onChange={(v) => set("bathrooms", Number(v))}
        />
      </Field>

      <Field label={tSearch("propertyType")}>
        <Select value={filters.type} onChange={(v) => set("type", v)}>
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`propertyTypes.${type}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={tSearch("furnishing")}>
        <Select value={filters.furnishing} onChange={(v) => set("furnishing", v)}>
          {furnishings.map((f) => (
            <option key={f} value={f}>
              {t(`furnishing.${f}`)}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {tSearch("amenities")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle label={tSearch("parking")} icon={<Car className="size-3.5" />} active={filters.parking} onToggle={() => set("parking", !filters.parking)} />
          <Toggle label={tSearch("balcony")} icon={<Trees className="size-3.5" />} active={filters.balcony} onToggle={() => set("balcony", !filters.balcony)} />
          <Toggle label={tSearch("gym")} icon={<Dumbbell className="size-3.5" />} active={filters.gym} onToggle={() => set("gym", !filters.gym)} />
          <Toggle label={tSearch("pool")} icon={<Waves className="size-3.5" />} active={filters.pool} onToggle={() => set("pool", !filters.pool)} />
        </div>
      </div>
    </div>
  );
}

// Desktop sidebar (hidden on mobile)
function FiltersPanel({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
}) {
  const tSearch = useSearchT();
  return (
    <aside className="hidden h-fit rounded-2xl border border-border bg-card p-5 shadow-card lg:block lg:sticky lg:top-20">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{tSearch("filters")}</h2>
        </div>
        <button type="button" onClick={() => setFilters(DEFAULTS)} className="text-xs font-semibold text-primary hover:underline">
          {tSearch("reset")}
        </button>
      </div>
      <FilterFields filters={filters} setFilters={setFilters} />
    </aside>
  );
}

// Mobile bottom-sheet for filters
function MobileFilterSheet({
  open,
  onClose,
  filters,
  setFilters,
  resultsCount,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  resultsCount: number;
}) {
  const tSearch = useSearchT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Sheet */}
      <div className="absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-3xl bg-background shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="text-base font-semibold">{tSearch("filters")}</div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <FilterFields filters={filters} setFilters={setFilters} />
        </div>
        <div className="shrink-0 border-t border-border bg-background px-5 py-4">
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setFilters(DEFAULTS)}>
              {tSearch("reset")}
            </Button>
            <Button variant="hero" className="flex-[2]" onClick={onClose}>
              {tSearch(
                resultsCount === 1 ? "showNPropertiesSingular" : "showNPropertiesPlural",
                { count: resultsCount },
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-semibold text-foreground">{label}</div>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-focus"
    >
      {children}
    </select>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      min={0}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-focus"
    />
  );
}

function SegmentedControl({
  value,
  options,
  labels,
  onChange,
}: {
  value: string;
  options: string[];
  labels?: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-background p-1">
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
            value === o ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labels?.[i] ?? o}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  icon,
  active,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary-soft text-accent-foreground"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* -------------------------------- Results -------------------------------- */
function ResultsPanel({
  results,
  view,
  compare,
  savedMap,
  city,
  district,
  onToggleCompare,
  onToggleSave,
}: {
  results: SearchProperty[];
  view: "grid" | "list" | "map";
  compare: string[];
  savedMap: Record<string, number>;
  city: string;
  district: string;
  onToggleCompare: (id: string) => void;
  onToggleSave: (id: string) => void | Promise<void>;
}) {
  const tSearch = useSearchT();
  const leadCity = city !== "Any" ? city : "Riyadh";
  const leadArea = district !== "Any" ? district : "";

  if (results.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card p-16 text-center">
          <Building2 className="size-10 text-muted-foreground" />
          <h3 className="mt-4 font-display text-lg font-bold">{tSearch("noMatchesTitle")}</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {tSearch("noMatchesDesc")}
          </p>
        </div>
        <LeadCTABanner city={leadCity} area={leadArea} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "grid gap-5",
          view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1",
        )}
      >
        {results.map((p) => (
          <ResultCard
            key={p.id}
            p={p}
            variant={view === "map" ? "grid" : view}
            compared={compare.includes(p.id)}
            saved={p.id in savedMap}
            onCompare={() => onToggleCompare(p.id)}
            onSave={() => onToggleSave(p.id)}
          />
        ))}
      </div>
      <LeadCTABanner city={leadCity} area={leadArea} />
    </div>
  );
}

function LeadCTABanner({ city, area }: { city: string; area: string }) {
  const { t } = useLanguage();
  const tSearch = useSearchT();
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Briefcase className="size-5 shrink-0 text-primary mt-0.5" />
        <div>
          <p className="font-semibold text-sm">{tSearch("cantFindTitle")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tSearch("cantFindDesc", { city: t(`cities.${city}`) })}
          </p>
        </div>
      </div>
      <Link to="/lead/new" search={{ area, city }} className="shrink-0">
        <Button size="sm">{tSearch("submitLeadRequest")}</Button>
      </Link>
    </div>
  );
}

function ResultCard({
  p,
  variant,
  compared,
  saved,
  onCompare,
  onSave,
}: {
  p: SearchProperty;
  variant: "grid" | "list";
  compared: boolean;
  saved: boolean;
  onCompare: () => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();
  const tSearch = useSearchT();
  const isList = variant === "list";
  const hasPhone = !!p.agentPhone;
  const waLink = hasPhone
    ? `https://wa.me/${p.agentPhone!.replace(/\D/g, "").replace(/^0/, "966")}`
    : undefined;

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated",
        isList ? "grid grid-cols-1 gap-0 md:grid-cols-[240px_1fr]" : "flex flex-col",
      )}
    >
      <Link to="/property/$id" params={{ id: p.id }} className={cn("flex flex-col", isList && "contents")}>
        <div className={cn("relative shrink-0 overflow-hidden bg-surface-2", isList ? "aspect-[4/3] md:aspect-auto md:h-full" : "aspect-[4/3]")}>
          <img
            src={p.image}
            alt={p.title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <Badge tone="ai">
              <Sparkles className="size-3" /> {tSearch("score", { score: p.matchScore })}
            </Badge>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onSave(); }}
              aria-label={tSearch("save")}
              className={cn(
                "grid size-9 place-items-center rounded-full shadow-card backdrop-blur transition-colors",
                saved ? "bg-destructive text-destructive-foreground" : "bg-background/95 text-foreground hover:bg-background",
              )}
            >
              <Heart className={cn("size-4", saved && "fill-current")} />
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-display text-base font-bold tracking-tight">
                {p.title}
              </h3>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-3.5" /> {p.district}, {p.city}
              </p>
            </div>
            <ScoreRing score={p.matchScore} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <BedDouble className="size-4" /> {p.bedrooms}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Bath className="size-4" /> {p.bathrooms}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Maximize className="size-4" /> {p.area} m²
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sofa className="size-4" /> {t(`furnishing.${p.furnished}`)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface p-3 text-center">
            <Mini label={tSearch("priceMini")} value={p.rentalScore} tone="primary" />
            <Mini label={tSearch("areaMini")} value={p.areaScore} tone="secondary" />
            <Mini label={tSearch("scoreMini")} value={p.matchScore} tone="ai" />
          </div>

          {!isList && <AiRecBox reasons={p.reasons} />}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div>
              <div className="text-xs text-muted-foreground">
                {p.listingType === "sale" ? t("propertyCard.salePrice") : t("propertyCard.annualRent")}
              </div>
              <div className="font-display text-xl font-bold tracking-tight">
                SAR {formatSAR(p.price)}
                {p.listingType !== "sale" && (
                  <span className="ms-1 text-xs font-medium text-muted-foreground">
                    {t("propertyCard.perYear")}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant={compared ? "soft" : "outline"}
              size="sm"
              onClick={(e) => { e.preventDefault(); onCompare(); }}
              aria-pressed={compared}
            >
              <GitCompare className="size-3.5" />
              {compared ? tSearch("added") : tSearch("compare")}
            </Button>
          </div>
        </div>
      </Link>

      {/* Contact CTA — outside the Link to avoid nested <a> */}
      {hasPhone && !isList && (
        <div className="flex gap-2 border-t border-border px-5 py-3">
          <a
            href={`tel:${p.agentPhone}`}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface"
          >
            <Phone className="size-3.5" /> {t("propertyCard.call")}
          </a>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#25D366] bg-[#25D366]/10 py-2 text-xs font-medium text-[#128C7E] transition-colors hover:bg-[#25D366]/20 dark:text-[#25D366]"
          >
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            {t("propertyCard.whatsapp")}
          </a>
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "secondary" | "ai";
}) {
  const color =
    tone === "primary" ? "text-primary" : tone === "secondary" ? "text-secondary" : "text-ai";
  return (
    <div>
      <div className={cn("font-display text-lg font-bold tabular-nums", color)}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

// Reasons come pre-formatted in English from the API mapper (see mapApiProperty in
// lib/api/maskan.ts) — translate the small fixed vocabulary here at render time.
function translateReason(reason: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (reason === "Verified listing") return t("search.reasonVerifiedListing");
  if (reason === "Detailed description available") return t("search.reasonDetailedDescription");
  if (reason === "Fresh inventory") return t("search.reasonFreshInventory");
  if (reason === "Good rental value") return t("search.reasonGoodRentalValue");
  if (reason.endsWith(" location")) {
    return t("search.reasonLocation", { area: reason.slice(0, -" location".length) });
  }
  return reason;
}

function AiRecBox({ reasons }: { reasons: string[] }) {
  const { t } = useLanguage();
  const tSearch = useSearchT();
  return (
    <div className="rounded-xl border border-ai/20 bg-ai-soft/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ai">
        <Sparkles className="size-3.5" /> {tSearch("recommendedBecause")}
      </div>
      <ul className="grid grid-cols-2 gap-1.5">
        {reasons.slice(0, 4).map((r) => (
          <li key={r} className="flex items-center gap-1.5 text-xs text-foreground">
            <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{translateReason(r, t)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------- Compare Bar ----------------------------- */
function CompareBar({ count, onClear }: { count: number; onClear: () => void }) {
  const tSearch = useSearchT();
  return (
    <div className="sticky bottom-4 z-40 mx-auto w-full max-w-3xl px-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-elevated">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary">
            <GitCompare className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">
              {tSearch(count === 1 ? "propertiesSelectedSingular" : "propertiesSelectedPlural", {
                count,
              })}
            </div>
            <div className="text-xs text-muted-foreground">{tSearch("compareSideBySide")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="size-3.5" /> {tSearch("clear")}
          </Button>
          {count >= 2 ? (
            <Button variant="hero" size="sm" asChild>
              <Link to="/compare">{tSearch("compareNow")}</Link>
            </Button>
          ) : (
            <Button variant="hero" size="sm" disabled>
              {tSearch("compareNow")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
