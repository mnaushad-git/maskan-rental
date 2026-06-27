import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Bath,
  BedDouble,
  Building2,
  Car,
  CheckCircle2,
  Crown,
  Dumbbell,
  Heart,
  MapPin,
  Maximize,
  Minus,
  Plus,
  Search,
  Sofa,
  Sparkles,
  Trees,
  Trophy,
  Waves,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, RecommendationBadge } from "@/components/maskan/Badges";
import { ScoreRing, ScoreBar } from "@/components/maskan/ScoreIndicator";
import { formatSAR, type Property } from "@/lib/maskan-data";
import {
  fetchProperties,
  fetchAreas,
  fetchAreaIntelligence,
  mapApiProperty,
  saveProperty,
  type ApiAreaIntelligence,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Compare Properties — Maskan" },
      {
        name: "description",
        content:
          "Compare up to three Saudi rental properties side by side — rent, area scores, amenities, and AI rental intelligence.",
      },
    ],
  }),
  component: ComparePage,
});

// ---------- Compare data helpers ----------

type CompareData = {
  deposit: number;
  furnishing: "Furnished" | "Semi-furnished" | "Unfurnished";
  areaScore: number;
  schoolScore: number;
  familyScore: number;
  rentalScore: number;
  amenities: { parking: boolean; gym: boolean; pool: boolean; balcony: boolean };
};

function computeCompareData(
  p: Property,
  intel: ApiAreaIntelligence | null | undefined,
  avgMonthly: number | undefined,
): CompareData {
  const areaScore = Math.round(intel?.area_score ?? 75);
  const schoolScore = Math.round(intel?.school_score ?? 75);
  const familyScore = Math.round(intel?.family_score ?? 75);

  let rentalScore = 75;
  if (avgMonthly && avgMonthly > 0) {
    const ratio = p.price / avgMonthly;
    if (ratio < 0.85) rentalScore = 95;
    else if (ratio < 0.95) rentalScore = 88;
    else if (ratio < 1.05) rentalScore = 80;
    else if (ratio < 1.15) rentalScore = 68;
    else rentalScore = 52;
  }

  const furnishing: CompareData["furnishing"] =
    p.type === "Penthouse" || p.type === "Villa" ? "Furnished" : "Semi-furnished";

  return {
    deposit: Math.round(p.price * 2),
    furnishing,
    areaScore,
    schoolScore,
    familyScore,
    rentalScore,
    amenities: {
      parking: true,
      balcony: p.bedrooms >= 2,
      gym: p.bedrooms >= 3,
      pool: p.type === "Penthouse" || p.type === "Villa",
    },
  };
}

// ---------- Page ----------

function ComparePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [areaIntelMap, setAreaIntelMap] = useState<Record<string, ApiAreaIntelligence | null>>({});
  const [areaAvgMap, setAreaAvgMap] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchProperties()
      .then((data) => {
        const mapped = data.map(mapApiProperty);
        setAllProperties(mapped);
        setSelectedIds(mapped.slice(0, 3).map((p) => p.id));
      })
      .catch(() => {/* leave empty on error */});
    fetchAreas()
      .then((areas) => {
        const m: Record<string, number> = {};
        areas.forEach((a) => { m[a.name] = a.average_rent; });
        setAreaAvgMap(m);
      })
      .catch(() => {});
  }, []);

  const selected = selectedIds
    .map((id) => allProperties.find((p) => p.id === id))
    .filter((p): p is Property => Boolean(p));

  // Fetch area intel for any newly-selected property districts
  useEffect(() => {
    selected.forEach((p) => {
      if (!(p.district in areaIntelMap)) {
        fetchAreaIntelligence(p.district, p.city)
          .then((intel) => setAreaIntelMap((prev) => ({ ...prev, [p.district]: intel })))
          .catch(() => setAreaIntelMap((prev) => ({ ...prev, [p.district]: null })));
      }
    });
  }, [selectedIds, allProperties]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = allProperties.filter((p) => !selectedIds.includes(p.id));

  const composite = useMemo(() => {
    return selected.map((p) => {
      const d = computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]);
      const total =
        d.areaScore * 0.25 +
        d.familyScore * 0.25 +
        d.rentalScore * 0.25 +
        p.matchScore * 0.25;
      return { p, d, total: Math.round(total) };
    });
  }, [selected, areaIntelMap, areaAvgMap]);

  const winner = composite.length
    ? composite.reduce((a, b) => (b.total > a.total ? b : a))
    : null;

  async function handleSaveShortlist() {
    if (!user) {
      void navigate({ to: "/auth" });
      return;
    }
    setSaveState("saving");
    try {
      await Promise.all(selected.map((p) => saveProperty(user.id, Number(p.id))));
    } catch {
      // silently ignore duplicates / errors — saved state still shows
    }
    setSaveState("saved");
  }

  const swap = (oldId: string, newId: string) =>
    setSelectedIds((ids) => ids.map((i) => (i === oldId ? newId : i)));

  const remove = (id: string) =>
    setSelectedIds((ids) => ids.filter((i) => i !== id));

  const add = (id: string) =>
    setSelectedIds((ids) => (ids.length >= 3 ? ids : [...ids, id]));

  return (
    <div className="min-h-screen bg-background">
      <CompareNav />

      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge tone="ai" icon={<Sparkles className="size-3.5" />}>
              Side-by-side comparison
            </Badge>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Compare properties
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Compare up to 3 listings across financials, area quality,
              amenities, and AI rental intelligence — then let Maskan AI pick
              the strongest match.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded-full bg-surface-2 px-3 py-1.5 font-semibold text-foreground">
              {selected.length}/3 selected
            </span>
          </div>
        </header>

        {/* Property header strip */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_repeat(3,minmax(0,1fr))]">
          <div className="hidden lg:block" />
          {selected.map((p) => {
            const isWinner = winner?.p.id === p.id;
            return (
              <PropertyHeaderCard
                key={p.id}
                p={p}
                isWinner={isWinner}
                onRemove={() => remove(p.id)}
                candidates={candidates}
                onSwap={(newId) => swap(p.id, newId)}
              />
            );
          })}
          {selected.length < 3 && (
            <AddPropertySlot candidates={candidates} onAdd={add} />
          )}
        </section>

        {/* AI recommendation */}
        {winner && selected.length >= 2 && (
          <AiRecommendationCard
            winner={winner.p}
            winnerDetails={winner.d}
            totalScore={winner.total}
            all={composite}
            onSaveShortlist={handleSaveShortlist}
            saveState={saveState}
          />
        )}

        {/* Comparison categories */}
        <div className="mt-10 space-y-6">
          <CategoryTable
            title="Financial"
            icon={<Crown className="size-4" />}
            rows={[
              {
                label: "Annual rent",
                values: selected.map((p) => ({
                  value: `SAR ${formatSAR(p.price)}`,
                  best: p.price === Math.min(...selected.map((s) => s.price)),
                  sub: `SAR ${formatSAR(Math.round(p.price / 12))}/mo`,
                })),
              },
              {
                label: "Security deposit",
                values: selected.map((p) => {
                  const d = computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]);
                  return {
                    value: `SAR ${formatSAR(d.deposit)}`,
                    best:
                      d.deposit ===
                      Math.min(...selected.map((s) => computeCompareData(s, areaIntelMap[s.district], areaAvgMap[s.district]).deposit)),
                  };
                }),
              },
              {
                label: "Price per m²",
                values: selected.map((p) => ({
                  value: `SAR ${formatSAR(p.pricePerSqm)}`,
                  best:
                    p.pricePerSqm ===
                    Math.min(...selected.map((s) => s.pricePerSqm)),
                })),
              },
            ]}
          />

          <CategoryTable
            title="Property"
            icon={<Building2 className="size-4" />}
            rows={[
              {
                label: "Bedrooms",
                values: selected.map((p) => ({
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <BedDouble className="size-4 text-muted-foreground" />
                      {p.bedrooms}
                    </span>
                  ),
                  best:
                    p.bedrooms ===
                    Math.max(...selected.map((s) => s.bedrooms)),
                })),
              },
              {
                label: "Bathrooms",
                values: selected.map((p) => ({
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <Bath className="size-4 text-muted-foreground" />
                      {p.bathrooms}
                    </span>
                  ),
                  best:
                    p.bathrooms ===
                    Math.max(...selected.map((s) => s.bathrooms)),
                })),
              },
              {
                label: "Area",
                values: selected.map((p) => ({
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <Maximize className="size-4 text-muted-foreground" />
                      {p.area} m²
                    </span>
                  ),
                  best: p.area === Math.max(...selected.map((s) => s.area)),
                })),
              },
              {
                label: "Furnishing",
                values: selected.map((p) => ({
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <Sofa className="size-4 text-muted-foreground" />
                      {computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).furnishing}
                    </span>
                  ),
                })),
              },
            ]}
          />

          <ScoreCategory
            title="Area"
            icon={<MapPin className="size-4" />}
            metrics={[
              {
                label: "Area score",
                values: selected.map((p) => computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).areaScore),
              },
              {
                label: "School score",
                values: selected.map((p) => computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).schoolScore),
              },
              {
                label: "Family score",
                values: selected.map((p) => computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).familyScore),
              },
            ]}
          />

          <AmenitiesCategory selected={selected} areaIntelMap={areaIntelMap} areaAvgMap={areaAvgMap} />

          <RentalIntelligenceCategory selected={selected} areaIntelMap={areaIntelMap} areaAvgMap={areaAvgMap} />
        </div>
      </main>
    </div>
  );
}

// ---------- Header / nav ----------

function CompareNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="size-4" />
          </span>
          <span className="text-base font-bold tracking-tight">Maskan</span>
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/advisor">
              <Sparkles className="mr-1.5 size-4" /> Ask AI
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

// ---------- Property picker modal ----------

function PropertyPickerModal({
  open,
  candidates,
  onSelect,
  onClose,
  title = "Select a property",
}: {
  open: boolean;
  candidates: Property[];
  onSelect: (id: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [brFilter, setBrFilter] = useState("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCityFilter("all");
    setBrFilter("all");
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const cities = useMemo(
    () => Array.from(new Set(candidates.map((p) => p.city))).sort(),
    [candidates],
  );

  const filtered = useMemo(() => {
    let list = candidates;
    if (cityFilter !== "all") list = list.filter((p) => p.city === cityFilter);
    if (brFilter !== "all") {
      const n = Number(brFilter);
      list = n >= 4 ? list.filter((p) => p.bedrooms >= 4) : list.filter((p) => p.bedrooms === n);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.district.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          p.type.toLowerCase().includes(q),
      );
    }
    return list.slice(0, 60);
  }, [candidates, query, cityFilter, brFilter]);

  if (!open) return null;

  const FilterChip = ({
    active, onClick, children,
  }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-surface-2 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:rounded-2xl"
        style={{ maxHeight: "min(92vh, 680px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-display text-base font-bold">{title}</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {candidates.length.toLocaleString()} available
            <button
              type="button"
              onClick={onClose}
              className="ml-1 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="shrink-0 border-b border-border p-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-shadow">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, area, city or type…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filter chips */}
        <div className="shrink-0 flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-2">
          <FilterChip active={cityFilter === "all"} onClick={() => setCityFilter("all")}>All cities</FilterChip>
          {cities.map((city) => (
            <FilterChip
              key={city}
              active={cityFilter === city}
              onClick={() => setCityFilter(cityFilter === city ? "all" : city)}
            >
              {city}
            </FilterChip>
          ))}
          <div className="mx-1 h-4 w-px shrink-0 bg-border" />
          {([1, 2, 3, "4+"] as const).map((br) => {
            const val = br === "4+" ? "4" : String(br);
            return (
              <FilterChip
                key={br}
                active={brFilter === val}
                onClick={() => setBrFilter(brFilter === val ? "all" : val)}
              >
                {br}BR
              </FilterChip>
            );
          })}
        </div>

        {/* Result count */}
        <div className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground">
          {filtered.length === 0
            ? "No properties match"
            : `${filtered.length}${filtered.length === 60 ? "+" : ""} ${filtered.length === 1 ? "property" : "properties"}`}
        </div>

        {/* Scrollable list */}
        <div className="flex-1 divide-y divide-border overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
              <Building2 className="size-9 opacity-25" />
              <p>No properties match your filters</p>
              <button
                type="button"
                onClick={() => { setQuery(""); setCityFilter("all"); setBrFilter("all"); }}
                className="text-xs text-primary hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect(p.id); onClose(); }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                  <img src={p.image} alt="" className="size-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" /> {p.district}, {p.city}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs">
                    <span className="font-bold text-foreground">
                      SAR {formatSAR(Math.round(p.price / 12))}/mo
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <BedDouble className="size-3" /> {p.bedrooms}BR
                    </span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-foreground">
                      {p.type}
                    </span>
                  </div>
                </div>
                <ScoreRing score={p.matchScore} size={40} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Property header card ----------

function PropertyHeaderCard({
  p,
  isWinner,
  onRemove,
  candidates,
  onSwap,
}: {
  p: Property;
  isWinner: boolean;
  onRemove: () => void;
  candidates: Property[];
  onSwap: (id: string) => void;
}) {
  const [swapOpen, setSwapOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-card shadow-card",
          isWinner ? "border-primary ring-2 ring-primary/30" : "border-border",
        )}
      >
        {isWinner && (
          <div className="absolute left-3 top-3 z-10">
            <Badge tone="ai" icon={<Trophy className="size-3.5" />}>
              AI Top pick
            </Badge>
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove from comparison"
          className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-background/95 text-foreground shadow-card backdrop-blur transition-colors hover:bg-background"
        >
          <X className="size-4" />
        </button>
        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          <img src={p.image} alt={p.title} loading="lazy" className="size-full object-cover" />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold tracking-tight">{p.title}</h3>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3" /> {p.district}, {p.city}
              </p>
            </div>
            <ScoreRing score={p.matchScore} size={44} />
          </div>
          <div className="flex items-end justify-between border-t border-border pt-3">
            <div>
              <div className="text-[11px] text-muted-foreground">Annual rent</div>
              <div className="text-lg font-bold tracking-tight">SAR {formatSAR(p.price)}</div>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {p.badges.slice(0, 1).map((b) => <RecommendationBadge key={b} label={b} />)}
            </div>
          </div>
          {candidates.length > 0 && (
            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setSwapOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:bg-surface-2 hover:text-foreground"
              >
                <ArrowLeftRight className="size-3.5" /> Swap property
              </button>
            </div>
          )}
        </div>
      </div>

      <PropertyPickerModal
        open={swapOpen}
        candidates={candidates}
        onSelect={(newId) => onSwap(newId)}
        onClose={() => setSwapOpen(false)}
        title="Swap with another property"
      />
    </>
  );
}

function AddPropertySlot({
  candidates,
  onAdd,
}: {
  candidates: Property[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface-2/40 p-6 text-center transition-colors hover:border-primary/40 hover:bg-surface-2/70"
      >
        <span className="grid size-12 place-items-center rounded-full bg-card text-muted-foreground shadow-card">
          <Plus className="size-5" />
        </span>
        <div className="space-y-1">
          <div className="text-sm font-semibold">Add a property</div>
          <p className="text-xs text-muted-foreground">
            Search from {candidates.length.toLocaleString()} listings
          </p>
        </div>
      </button>

      <PropertyPickerModal
        open={open}
        candidates={candidates}
        onSelect={(id) => onAdd(id)}
        onClose={() => setOpen(false)}
        title="Add a property to compare"
      />
    </>
  );
}

// ---------- Comparison tables ----------

type RowValue = {
  value: React.ReactNode;
  sub?: string;
  best?: boolean;
};

function CategoryTable({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { label: string; values: RowValue[] }[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      </header>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-1 gap-3 px-5 py-4 lg:grid-cols-[200px_repeat(3,minmax(0,1fr))] lg:items-center"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {row.label}
            </div>
            {row.values.map((v, i) => (
              <div
                key={i}
                className={cn(
                  "flex flex-col rounded-lg px-3 py-2 text-sm font-semibold",
                  v.best && "bg-primary/8 text-primary",
                )}
              >
                <div className="flex items-center gap-2">
                  {v.value}
                  {v.best && (
                    <CheckCircle2 className="size-3.5 text-primary" />
                  )}
                </div>
                {v.sub && (
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {v.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ScoreCategory({
  title,
  icon,
  metrics,
}: {
  title: string;
  icon: React.ReactNode;
  metrics: { label: string; values: number[] }[];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-secondary/10 text-secondary">
          {icon}
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
      </header>
      <div className="divide-y divide-border">
        {metrics.map((m) => {
          const best = Math.max(...m.values);
          return (
            <div
              key={m.label}
              className="grid grid-cols-1 gap-3 px-5 py-4 lg:grid-cols-[200px_repeat(3,minmax(0,1fr))] lg:items-center"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {m.label}
              </div>
              {m.values.map((v, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg px-3 py-2",
                    v === best && "bg-primary/8",
                  )}
                >
                  <ScoreBar label={v === best ? "Best in compare" : "Score"} value={v} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AmenitiesCategory({
  selected,
  areaIntelMap,
  areaAvgMap,
}: {
  selected: Property[];
  areaIntelMap: Record<string, ApiAreaIntelligence | null>;
  areaAvgMap: Record<string, number>;
}) {
  const items: { key: keyof CompareData["amenities"]; label: string; icon: React.ReactNode }[] = [
    { key: "parking", label: "Parking", icon: <Car className="size-4" /> },
    { key: "gym", label: "Gym", icon: <Dumbbell className="size-4" /> },
    { key: "pool", label: "Pool", icon: <Waves className="size-4" /> },
    { key: "balcony", label: "Balcony", icon: <Trees className="size-4" /> },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-info/10 text-info">
          <Dumbbell className="size-4" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide">Amenities</h2>
      </header>
      <div className="divide-y divide-border">
        {items.map((it) => (
          <div
            key={it.key}
            className="grid grid-cols-1 gap-3 px-5 py-4 lg:grid-cols-[200px_repeat(3,minmax(0,1fr))] lg:items-center"
          >
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="text-foreground">{it.icon}</span>
              {it.label}
            </div>
            {selected.map((p) => {
              const has = computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).amenities[it.key];
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold",
                    has ? "bg-success/10 text-success" : "text-muted-foreground",
                  )}
                >
                  {has ? (
                    <>
                      <CheckCircle2 className="size-4" /> Included
                    </>
                  ) : (
                    <>
                      <Minus className="size-4" /> Not available
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function RentalIntelligenceCategory({
  selected,
  areaIntelMap,
  areaAvgMap,
}: {
  selected: Property[];
  areaIntelMap: Record<string, ApiAreaIntelligence | null>;
  areaAvgMap: Record<string, number>;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-ai-soft text-ai">
          <Sparkles className="size-4" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide">
          Rental Intelligence
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-3 px-5 py-5 lg:grid-cols-[200px_repeat(3,minmax(0,1fr))] lg:items-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Scores
        </div>
        {selected.map((p) => {
          const d = computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]);
          return (
            <div
              key={p.id}
              className="flex items-center justify-around gap-3 rounded-xl border border-border bg-surface-2/40 p-4"
            >
              <div className="flex flex-col items-center gap-1">
                <ScoreRing score={d.rentalScore} size={56} />
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Rental
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <ScoreRing score={p.matchScore} size={56} />
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Property Score
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- AI Recommendation ----------

function AiRecommendationCard({
  winner,
  winnerDetails,
  totalScore,
  all,
  onSaveShortlist,
  saveState,
}: {
  winner: Property;
  winnerDetails: CompareData;
  totalScore: number;
  all: { p: Property; d: CompareData; total: number }[];
  onSaveShortlist: () => void;
  saveState: "idle" | "saving" | "saved";
}) {
  const cheapest = all.reduce((a, b) => (b.p.price < a.p.price ? b : a));
  const largest = all.reduce((a, b) => (b.p.area > a.p.area ? b : a));
  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-ai-soft to-background p-6 shadow-elevated sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl space-y-3">
          <Badge tone="ai" icon={<Sparkles className="size-3.5" />}>
            Maskan AI Recommendation
          </Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {winner.title} is the strongest match
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">
            Weighing rental value, area quality, family suitability and AI
            match, <strong className="text-foreground">{winner.district}</strong>{" "}
            scores <strong className="text-foreground">{totalScore}/100</strong>
            {" "}— balancing competitive rent of{" "}
            <strong className="text-foreground">
              SAR {formatSAR(winner.price)}/yr
            </strong>{" "}
            with a {winnerDetails.familyScore}/100 family score and{" "}
            {winnerDetails.areaScore}/100 area quality.
          </p>
          <ul className="grid grid-cols-1 gap-2 pt-2 text-sm sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              Cheapest annual rent:{" "}
              <strong>{cheapest.p.district}</strong> at SAR{" "}
              {formatSAR(cheapest.p.price)}.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              Most spacious: <strong>{largest.p.district}</strong> at{" "}
              {largest.p.area} m².
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              Best family fit: <strong>{winner.district}</strong> with{" "}
              {winnerDetails.schoolScore}/100 school score.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              Verified by {winner.agent}.
            </li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-3">
            <Button asChild>
              <Link to="/property/$id" params={{ id: winner.id }}>
                View {winner.district}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/advisor">
                <Sparkles className="mr-1.5 size-4" /> Ask AI about this
              </Link>
            </Button>
            <Button
              variant="ghost"
              onClick={onSaveShortlist}
              disabled={saveState === "saving"}
            >
              <Heart className={"mr-1.5 size-4 " + (saveState === "saved" ? "fill-destructive text-destructive" : "")} />
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Shortlist saved!" : "Save shortlist"}
            </Button>
          </div>
        </div>
        <div className="flex min-w-[180px] flex-col items-center gap-2 rounded-2xl border border-primary/30 bg-background/70 p-5 backdrop-blur">
          <Trophy className="size-6 text-primary" />
          <ScoreRing score={totalScore} size={96} />
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Composite score
            </div>
            <div className="text-sm font-bold">{winner.district}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
