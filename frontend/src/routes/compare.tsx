import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
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
  Gauge,
  Heart,
  MapPin,
  Maximize,
  Minus,
  PiggyBank,
  Plus,
  Search,
  ShieldCheck,
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
  fetchPropertyIntelligence,
  mapApiProperty,
  saveProperty,
  type ApiAreaIntelligence,
  type ApiPropertyIntelligence,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Compare Properties — myMakan" },
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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [allProperties, setAllProperties] = useState<Property[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [areaIntelMap, setAreaIntelMap] = useState<Record<string, ApiAreaIntelligence | null>>({});
  const [areaAvgMap, setAreaAvgMap] = useState<Record<string, number>>({});
  // Prompt 10: myMakan Property Intelligence per compared property — bounded
  // to however many the page supports (currently ≤3, same cap as
  // `selectedIds`), fetched once per id and cached, same pattern as the
  // areaIntel fetch below (never re-fetched once present, even as null).
  const [intelMap, setIntelMap] = useState<Record<string, ApiPropertyIntelligence | null>>({});

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

  const selected = useMemo(
    () => selectedIds
      .map((id) => allProperties.find((p) => p.id === id))
      .filter((p): p is Property => Boolean(p)),
    [selectedIds, allProperties],
  );

  // Fetch area intel for any newly-selected property districts
  useEffect(() => {
    selected.forEach((p) => {
      if (!(p.district in areaIntelMap)) {
        fetchAreaIntelligence(p.district, p.city)
          .then((intel) => setAreaIntelMap((prev) => ({ ...prev, [p.district]: intel })))
          .catch(() => setAreaIntelMap((prev) => ({ ...prev, [p.district]: null })));
      }
    });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Property Intelligence for any newly-selected property (Prompt 10)
  useEffect(() => {
    selected.forEach((p) => {
      if (!(p.id in intelMap)) {
        fetchPropertyIntelligence(Number(p.id))
          .then((intel) => setIntelMap((prev) => ({ ...prev, [p.id]: intel })))
          .catch(() => setIntelMap((prev) => ({ ...prev, [p.id]: null })));
      }
    });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = useMemo(
    () => allProperties.filter((p) => !selectedIds.includes(p.id)),
    [allProperties, selectedIds],
  );

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
      <TopNav />

      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge tone="ai" icon={<Sparkles className="size-3.5" />}>
              {t("compare.badge")}
            </Badge>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              {t("compare.heading")}
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {t("compare.desc")}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded-full bg-surface-2 px-3 py-1.5 font-semibold text-foreground">
              {t("compare.selectedCount", { count: selected.length })}
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

        {/* myMakan Recommendation (Prompt 10) — distinct from AiRecommendationCard
            above: that one picks a single overall winner from a client-side
            composite (area/family/rental/match); this one picks three separate
            category winners (Overall/Value/Location) straight from the real
            Property Intelligence Decision Score / price classification / area
            score, with a deterministic one-line "why" per winner — never an AI
            call choosing the winner. */}
        {selected.length >= 2 && (
          <MyMakanRecommendationCard selected={selected} intelMap={intelMap} />
        )}

        {/* Comparison categories */}
        <div className="mt-10 space-y-6">
          <PropertyIntelligenceCategory selected={selected} intelMap={intelMap} />

          <CategoryTable
            title={t("compare.categories.financial")}
            icon={<Crown className="size-4" />}
            rows={[
              {
                label: t("compare.rows.annualRent"),
                values: selected.map((p) => ({
                  value: `SAR ${formatSAR(p.price)}`,
                  best: p.price === Math.min(...selected.map((s) => s.price)),
                  sub: t("compare.rows.perMonth", { amount: formatSAR(Math.round(p.price / 12)) }),
                })),
              },
              {
                label: t("compare.rows.securityDeposit"),
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
                label: t("compare.rows.pricePerSqm"),
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
            title={t("compare.categories.property")}
            icon={<Building2 className="size-4" />}
            rows={[
              {
                label: t("compare.rows.bedrooms"),
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
                label: t("compare.rows.bathrooms"),
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
                label: t("compare.rows.area"),
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
                label: t("compare.rows.furnishing"),
                values: selected.map((p) => ({
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <Sofa className="size-4 text-muted-foreground" />
                      {t(`furnishing.${computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).furnishing}`)}
                    </span>
                  ),
                })),
              },
            ]}
          />

          <ScoreCategory
            title={t("compare.categories.area")}
            icon={<MapPin className="size-4" />}
            metrics={[
              {
                label: t("compare.rows.areaScore"),
                values: selected.map((p) => computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).areaScore),
              },
              {
                label: t("compare.rows.schoolScore"),
                values: selected.map((p) => computeCompareData(p, areaIntelMap[p.district], areaAvgMap[p.district]).schoolScore),
              },
              {
                label: t("compare.rows.familyScore"),
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

// ---------- Property picker modal ----------

function PropertyPickerModal({
  open,
  candidates,
  onSelect,
  onClose,
  title,
}: {
  open: boolean;
  candidates: Property[];
  onSelect: (id: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const { t } = useLanguage();
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
          <h3 className="font-display text-base font-bold">{title ?? t("compare.picker.selectTitle")}</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("compare.picker.available", { count: candidates.length.toLocaleString() })}
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
              placeholder={t("compare.picker.searchPlaceholder")}
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
          <FilterChip active={cityFilter === "all"} onClick={() => setCityFilter("all")}>{t("compare.picker.allCities")}</FilterChip>
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
            ? t("compare.picker.noMatch")
            : t(filtered.length === 1 ? "compare.picker.resultCountSingular" : "compare.picker.resultCountPlural", {
                count: `${filtered.length}${filtered.length === 60 ? "+" : ""}`,
              })}
        </div>

        {/* Scrollable list */}
        <div className="flex-1 divide-y divide-border overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
              <Building2 className="size-9 opacity-25" />
              <p>{t("compare.picker.noMatchFilters")}</p>
              <button
                type="button"
                onClick={() => { setQuery(""); setCityFilter("all"); setBrFilter("all"); }}
                className="text-xs text-primary hover:underline"
              >
                {t("compare.picker.clearFilters")}
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
  const { t } = useLanguage();

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
              {t("compare.header.aiTopPick")}
            </Badge>
          </div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("compare.header.removeFromComparison")}
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
              <div className="text-[11px] text-muted-foreground">{t("compare.header.annualRent")}</div>
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
                <ArrowLeftRight className="size-3.5" /> {t("compare.header.swapProperty")}
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
        title={t("compare.picker.swapTitle")}
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
  const { t } = useLanguage();

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
          <div className="text-sm font-semibold">{t("compare.addSlot.addProperty")}</div>
          <p className="text-xs text-muted-foreground">
            {t("compare.addSlot.searchFromListings", { count: candidates.length.toLocaleString() })}
          </p>
        </div>
      </button>

      <PropertyPickerModal
        open={open}
        candidates={candidates}
        onSelect={(id) => onAdd(id)}
        onClose={() => setOpen(false)}
        title={t("compare.picker.addTitle")}
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
  const { t } = useLanguage();
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
                  <ScoreBar label={v === best ? t("compare.scoreBar.bestInCompare") : t("compare.scoreBar.score")} value={v} />
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
  const { t } = useLanguage();
  const items: { key: keyof CompareData["amenities"]; label: string; icon: React.ReactNode }[] = [
    { key: "parking", label: t("compare.amenityItems.parking"), icon: <Car className="size-4" /> },
    { key: "gym", label: t("compare.amenityItems.gym"), icon: <Dumbbell className="size-4" /> },
    { key: "pool", label: t("compare.amenityItems.pool"), icon: <Waves className="size-4" /> },
    { key: "balcony", label: t("compare.amenityItems.balcony"), icon: <Trees className="size-4" /> },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-info/10 text-info">
          <Dumbbell className="size-4" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide">{t("compare.categories.amenities")}</h2>
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
                      <CheckCircle2 className="size-4" /> {t("compare.included")}
                    </>
                  ) : (
                    <>
                      <Minus className="size-4" /> {t("compare.notAvailable")}
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
  const { t } = useLanguage();
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-md bg-ai-soft text-ai">
          <Sparkles className="size-4" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide">
          {t("compare.categories.rentalIntelligence")}
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-3 px-5 py-5 lg:grid-cols-[200px_repeat(3,minmax(0,1fr))] lg:items-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("compare.scoresLabel")}
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
                  {t("compare.rentalLabel")}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <ScoreRing score={p.matchScore} size={56} />
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("compare.propertyScoreLabel")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- myMakan Intelligence category (Prompt 10) ----------

function PropertyIntelligenceCategory({
  selected,
  intelMap,
}: {
  selected: Property[];
  intelMap: Record<string, ApiPropertyIntelligence | null>;
}) {
  const { t } = useLanguage();
  return (
    <CategoryTable
      title={t("compare.categories.myMakanIntelligence")}
      icon={<Gauge className="size-4" />}
      rows={[
        {
          label: t("compare.rows.decisionScore"),
          values: selected.map((p) => {
            const score = intelMap[p.id]?.decision_score ?? null;
            return {
              value: score != null ? `${score}/100` : "—",
              best: score != null && score === Math.max(...selected.map((s) => intelMap[s.id]?.decision_score ?? -1)),
            };
          }),
        },
        {
          label: t("compare.rows.matchScore"),
          values: selected.map((p) => ({ value: `${p.matchScore}/100` })),
        },
        {
          label: t("compare.rows.priceClassification"),
          values: selected.map((p) => {
            const classification = intelMap[p.id]?.price_intelligence.classification ?? null;
            return {
              value: classification ? (
                <Badge tone={classificationTone(classification)}>{classification}</Badge>
              ) : (
                t("compare.notAvailable")
              ),
            };
          }),
        },
        {
          label: t("compare.rows.areaScoreIntel"),
          values: selected.map((p) => {
            const score = intelMap[p.id]?.area_intelligence?.area_score ?? null;
            return { value: score != null ? `${Math.round(score)}/100` : "—" };
          }),
        },
        {
          label: t("compare.rows.dataConfidence"),
          values: selected.map((p) => {
            const conf = intelMap[p.id]?.data_confidence.level ?? null;
            return {
              value: conf ? (
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-4" /> {conf}
                </span>
              ) : (
                "—"
              ),
            };
          }),
        },
        {
          label: t("compare.rows.strengthsConsiderations"),
          values: selected.map((p) => {
            const intel = intelMap[p.id];
            if (!intel) return { value: "—" };
            return { value: `${intel.strengths.length} / ${intel.considerations.length}` };
          }),
        },
      ]}
    />
  );
}

function classificationTone(classification: string): "success" | "neutral" | "warning" | "destructive" {
  if (classification === "Excellent Value" || classification === "Good Value") return "success";
  if (classification === "Fair") return "neutral";
  if (classification === "Above Market") return "warning";
  return "destructive";
}

// ---------- myMakan Recommendation (Prompt 10) ----------
// Pure, deterministic category-picking — mirrors home_finder_scoring.py's
// `pick_categories` style (best-of by a single real metric, `None` when no
// candidate has data for it). Lives in the frontend since every input is
// already-fetched Property Intelligence data and the comparison itself is
// simple arithmetic — no new backend endpoint needed for this.

const CLASSIFICATION_RANK: Record<string, number> = {
  "Excellent Value": 5,
  "Good Value": 4,
  Fair: 3,
  "Above Market": 2,
  "Significantly Above Market": 1,
};

type RecommendationEntry = {
  id: string;
  title: string;
  district: string;
  decisionScore: number | null;
  classification: string | null;
  areaScore: number | null;
};

function pickIntelligenceRecommendations(entries: RecommendationEntry[]) {
  const withScore = entries.filter((e) => e.decisionScore != null);
  const bestOverall = withScore.length
    ? withScore.reduce((a, b) => (b.decisionScore! > a.decisionScore! ? b : a))
    : null;

  const withClass = entries.filter((e) => e.classification != null && e.classification in CLASSIFICATION_RANK);
  const bestValue = withClass.length
    ? withClass.reduce((a, b) => (CLASSIFICATION_RANK[b.classification!] > CLASSIFICATION_RANK[a.classification!] ? b : a))
    : null;

  const withArea = entries.filter((e) => e.areaScore != null);
  const bestLocation = withArea.length ? withArea.reduce((a, b) => (b.areaScore! > a.areaScore! ? b : a)) : null;

  return { bestOverall, bestValue, bestLocation };
}

function MyMakanRecommendationCard({
  selected,
  intelMap,
}: {
  selected: Property[];
  intelMap: Record<string, ApiPropertyIntelligence | null>;
}) {
  const { t } = useLanguage();
  const entries: RecommendationEntry[] = selected.map((p) => {
    const intel = intelMap[p.id];
    return {
      id: p.id,
      title: p.title,
      district: p.district,
      decisionScore: intel?.decision_score ?? null,
      classification: intel?.price_intelligence.classification ?? null,
      areaScore: intel?.area_intelligence?.area_score ?? null,
    };
  });
  const { bestOverall, bestValue, bestLocation } = pickIntelligenceRecommendations(entries);
  if (!bestOverall && !bestValue && !bestLocation) return null;

  const rows: { key: string; icon: React.ReactNode; entry: RecommendationEntry | null; why: (e: RecommendationEntry) => string }[] = [
    {
      key: "bestOverall",
      icon: <Trophy className="size-4" />,
      entry: bestOverall,
      why: (e) => t("compare.myMakanReco.whyOverall", { score: e.decisionScore ?? 0 }),
    },
    {
      key: "bestValue",
      icon: <PiggyBank className="size-4" />,
      entry: bestValue,
      why: (e) => t("compare.myMakanReco.whyValue", { classification: e.classification ?? "" }),
    },
    {
      key: "bestLocation",
      icon: <MapPin className="size-4" />,
      entry: bestLocation,
      why: (e) => t("compare.myMakanReco.whyLocation", { score: Math.round(e.areaScore ?? 0) }),
    },
  ];

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-ai/20 bg-ai/5 p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="size-4 text-ai" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-ai">{t("compare.myMakanReco.title")}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {rows
          .filter((r) => r.entry)
          .map((r) => (
            <div key={r.key} className="rounded-xl border border-border bg-card p-4">
              <Badge tone="ai" icon={r.icon}>
                {t(`compare.myMakanReco.${r.key}`)}
              </Badge>
              <div className="mt-2 truncate text-sm font-semibold">{r.entry!.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{r.why(r.entry!)}</p>
              <Link
                to="/property/$id"
                params={{ id: r.entry!.id }}
                className="mt-2 inline-block text-xs font-semibold text-primary hover:underline"
              >
                {t("compare.myMakanReco.view")}
              </Link>
            </div>
          ))}
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
  const { t } = useLanguage();
  const cheapest = all.reduce((a, b) => (b.p.price < a.p.price ? b : a));
  const largest = all.reduce((a, b) => (b.p.area > a.p.area ? b : a));
  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-ai-soft to-background p-6 shadow-elevated sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl space-y-3">
          <Badge tone="ai" icon={<Sparkles className="size-3.5" />}>
            {t("compare.aiReco.badge")}
          </Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("compare.aiReco.strongestMatch", { title: winner.title })}
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("compare.aiReco.description", {
              district: winner.district,
              score: totalScore,
              price: formatSAR(winner.price),
              family: winnerDetails.familyScore,
              area: winnerDetails.areaScore,
            })}
          </p>
          <ul className="grid grid-cols-1 gap-2 pt-2 text-sm sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("compare.aiReco.cheapestRentPrefix")}{" "}
              <strong>{cheapest.p.district}</strong>{" "}
              {t("compare.aiReco.cheapestRentSuffix", { price: formatSAR(cheapest.p.price) })}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("compare.aiReco.mostSpaciousPrefix")} <strong>{largest.p.district}</strong>{" "}
              {t("compare.aiReco.mostSpaciousSuffix", { area: largest.p.area })}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("compare.aiReco.bestFamilyFitPrefix")} <strong>{winner.district}</strong>{" "}
              {t("compare.aiReco.bestFamilyFitSuffix", { score: winnerDetails.schoolScore })}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              {t("compare.aiReco.verifiedBy", { agent: winner.agent })}
            </li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-3">
            <Button asChild>
              <Link to="/property/$id" params={{ id: winner.id }}>
                {t("compare.aiReco.viewDistrict", { district: winner.district })}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/advisor">
                <Sparkles className="mr-1.5 size-4" /> {t("compare.aiReco.askAiAboutThis")}
              </Link>
            </Button>
            <Button
              variant="ghost"
              onClick={onSaveShortlist}
              disabled={saveState === "saving"}
            >
              <Heart className={"mr-1.5 size-4 " + (saveState === "saved" ? "fill-destructive text-destructive" : "")} />
              {saveState === "saving" ? t("compare.aiReco.saving") : saveState === "saved" ? t("compare.aiReco.shortlistSaved") : t("compare.aiReco.saveShortlist")}
            </Button>
          </div>
        </div>
        <div className="flex min-w-[180px] flex-col items-center gap-2 rounded-2xl border border-primary/30 bg-background/70 p-5 backdrop-blur">
          <Trophy className="size-6 text-primary" />
          <ScoreRing score={totalScore} size={96} />
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("compare.aiReco.compositeScore")}
            </div>
            <div className="text-sm font-bold">{winner.district}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
