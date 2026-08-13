import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Compass,
  GraduationCap,
  Heart,
  Hospital,
  Info,
  Map as MapIcon,
  MapPin,
  Search,
  Sparkles,
  Stethoscope,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/maskan/Badges";
import { ScoreBar } from "@/components/maskan/ScoreIndicator";
import { StatCard } from "@/components/maskan/Widgets";
import { formatSAR } from "@/lib/maskan-data";
import { fetchAreas, fetchAreaIntelligenceList, fetchAreaIntelligence, type ApiAreaSummary, type ApiAreaIntelligence } from "@/lib/api/maskan";
import { cn } from "@/lib/utils";
import { TopNav } from "@/components/maskan/TopNav";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/areas")({
  head: () => ({
    meta: [
      { title: "Explore Areas — myMakan" },
      {
        name: "description",
        content:
          "Explore Riyadh, Jeddah and Dammam districts — area scores, rental trends, schools, healthcare and lifestyle tags.",
      },
    ],
  }),
  component: AreasPage,
});

// ---------- Types ----------

type LifestyleTag = "Family Friendly" | "Luxury" | "Affordable" | "Student Area" | "Walkable" | "Business Hub";

type SchoolEntry = { name: string; rating: number; type: "Public" | "International" | "Private" };
type HospitalEntry = { name: string; tier: "General" | "Specialty"; rating: number };
type TrendPoint = { year: string; rent: number };

type District = {
  id: string;
  name: string;
  city: "Riyadh" | "Jeddah" | "Dammam";
  areaScore: number;
  familyScore: number;
  schoolScore: number;
  healthcareScore: number;
  trafficScore: number;
  avgRent: number;
  yoy: number;
  listings: number;
  tags: LifestyleTag[];
  overview: string;
  trends: TrendPoint[];
  schools: SchoolEntry[];
  hospitals: HospitalEntry[];
  notes: string[];
};

function apiToDistrict(d: ApiAreaIntelligence, liveRent?: number, liveListings?: number): District {
  const lastTrend = d.rent_trend.at(-1);
  const prevTrend = d.rent_trend.at(-2);
  const avgRent = liveRent ?? lastTrend?.avg_rent_annual ?? 0;
  const yoy = lastTrend && prevTrend && prevTrend.avg_rent_annual > 0
    ? Math.round(((lastTrend.avg_rent_annual - prevTrend.avg_rent_annual) / prevTrend.avg_rent_annual) * 1000) / 10
    : 0;
  return {
    id: `${d.area_name}-${d.city}`.toLowerCase().replace(/\s+/g, "-"),
    name: d.area_name,
    city: d.city as District["city"],
    areaScore: Math.round(d.area_score ?? 75),
    familyScore: Math.round(d.family_score ?? 75),
    schoolScore: Math.round(d.school_score ?? 75),
    healthcareScore: Math.round(d.healthcare_score ?? 75),
    trafficScore: Math.round(d.traffic_score ?? 75),
    avgRent,
    yoy,
    listings: liveListings ?? 0,
    tags: (d.tags ?? []) as LifestyleTag[],
    overview: d.overview ?? "",
    trends: d.rent_trend.map((t) => ({ year: t.year, rent: t.avg_rent_annual })),
    schools: (d.schools ?? []).map((s) => ({ name: s.name, rating: s.rating, type: s.type as SchoolEntry["type"] })),
    hospitals: (d.hospitals ?? []).map((h) => ({ name: h.name, tier: h.tier as HospitalEntry["tier"], rating: h.rating })),
    notes: d.market_notes ?? [],
  };
}

const TAG_TONES: Record<LifestyleTag, "primary" | "secondary" | "ai" | "success" | "warning" | "info" | "neutral"> = {
  "Family Friendly": "success",
  Luxury: "ai",
  Affordable: "info",
  "Student Area": "warning",
  Walkable: "secondary",
  "Business Hub": "primary",
};

// Small helper so call sites can write tAreas("heading") instead of t("areas.heading").
function useAreasT() {
  const { t } = useLanguage();
  return (key: string, vars?: Record<string, string | number>) => t(`areas.${key}`, vars);
}

// ---------- Pieces ----------

function CityChip({
  city,
  active,
  count,
  onClick,
}: {
  city: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const tAreas = useAreasT();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card text-foreground hover:bg-surface",
      )}
    >
      <MapPin className="size-3.5" />
      {city === "All" ? tAreas("allCities") : t(`cities.${city}`)}
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
          active ? "bg-primary-foreground/20" : "bg-surface-2 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ScorePill({ value }: { value: number }) {
  const tone =
    value >= 90
      ? "bg-success/12 text-success"
      : value >= 80
        ? "bg-primary-soft text-accent-foreground"
        : value >= 70
          ? "bg-info/10 text-info"
          : "bg-warning/15 text-warning-foreground";
  return (
    <span
      className={cn(
        "inline-flex min-w-[42px] items-center justify-center rounded-md px-2 py-1 text-xs font-bold tabular-nums",
        tone,
      )}
    >
      {value}
    </span>
  );
}

function MiniTrend({ data }: { data: TrendPoint[] }) {
  const w = 120;
  const h = 32;
  const min = Math.min(...data.map((d) => d.rent));
  const max = Math.max(...data.map((d) => d.rent));
  const range = Math.max(1, max - min);
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.rent - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        strokeWidth={2}
        className="stroke-primary"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  const w = 520;
  const h = 180;
  const pad = 28;
  const min = Math.min(...data.map((d) => d.rent));
  const max = Math.max(...data.map((d) => d.rent));
  const range = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const line = data.map((d, i) => `${x(i)},${y(d.rent)}`).join(" ");
  const area = `${x(0)},${h - pad} ${line} ${x(data.length - 1)},${h - pad}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" className="text-primary" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-primary" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={pad}
          x2={w - pad}
          y1={pad + f * (h - pad * 2)}
          y2={pad + f * (h - pad * 2)}
          className="stroke-border"
          strokeDasharray="3 3"
        />
      ))}
      <polygon points={area} fill="url(#trendFill)" className="text-primary" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={2.5}
        className="stroke-primary"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((d, i) => (
        <g key={d.year}>
          <circle cx={x(i)} cy={y(d.rent)} r={3.5} className="fill-card stroke-primary" strokeWidth={2} />
          <text
            x={x(i)}
            y={h - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px] font-medium"
          >
            {d.year}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------- Detail Panel ----------

type Tab = "overview" | "trends" | "schools" | "hospitals" | "notes";

function DetailPanel({ d, onClose }: { d: District; onClose: () => void }) {
  const { t } = useLanguage();
  const tAreas = useAreasT();
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { id: Tab; label: string; icon: typeof Heart }[] = [
    { id: "overview", label: tAreas("detail.tabOverview"), icon: Compass },
    { id: "trends", label: tAreas("detail.tabTrends"), icon: TrendingUp },
    { id: "schools", label: tAreas("detail.tabSchools"), icon: GraduationCap },
    { id: "hospitals", label: tAreas("detail.tabHospitals"), icon: Hospital },
    { id: "notes", label: tAreas("detail.tabNotes"), icon: Sparkles },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <MapPin className="size-3.5" /> {t(`cities.${d.city}`)}
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">{d.name}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.tags.map((tag) => (
                <Badge key={tag} tone={TAG_TONES[tag]}>
                  {t(`lifestyleTags.${tag}`)}
                </Badge>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={tAreas("detail.closeDetail")}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex items-center gap-1 border-b border-border px-3">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                tab === tb.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <tb.icon className="size-3.5" />
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {tab === "overview" && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">{d.overview}</p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label={tAreas("detail.avgRentLabel")} value={`SAR ${formatSAR(d.avgRent)}`} delta={tAreas("detail.yoy", { sign: d.yoy > 0 ? "+" : "", pct: d.yoy })} trend={d.yoy >= 0 ? "up" : "down"} />
                <StatCard label={tAreas("detail.activeListings")} value={String(d.listings)} icon={<Building2 className="size-4" />} />
              </div>
              <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{tAreas("detail.districtScores")}</div>
                  <Link to="/methodology" className="text-xs text-muted-foreground hover:text-primary hover:underline">
                    {tAreas("detail.howScoresWork")}
                  </Link>
                </div>
                <ScoreBar label={tAreas("detail.areaQuality")} value={d.areaScore} />
                <ScoreBar label={tAreas("detail.familySuitability")} value={d.familyScore} />
                <ScoreBar label={tAreas("detail.schools")} value={d.schoolScore} />
                <ScoreBar label={tAreas("detail.healthcare")} value={d.healthcareScore} />
                <ScoreBar label={tAreas("detail.trafficFlow")} value={d.trafficScore} />
              </div>
            </>
          )}

          {tab === "trends" && (
            <>
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-1 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{tAreas("detail.avgAnnualRent")}</div>
                    <div className="text-xs text-muted-foreground">{tAreas("detail.fiveYearTrajectory")}</div>
                  </div>
                  <Badge tone={d.yoy >= 0 ? "success" : "info"}>
                    <TrendingUp className="size-3" />
                    {tAreas("detail.yoy", { sign: d.yoy > 0 ? "+" : "", pct: d.yoy })}
                  </Badge>
                </div>
                <TrendChart data={d.trends} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="2021" value={`SAR ${formatSAR(d.trends[0].rent)}`} />
                <StatCard label="2023" value={`SAR ${formatSAR(d.trends[2].rent)}`} />
                <StatCard label="2025" value={`SAR ${formatSAR(d.trends.at(-1)!.rent)}`} />
              </div>
            </>
          )}

          {tab === "schools" && (
            <div className="space-y-3">
              {d.schools.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-lg bg-secondary/10 text-secondary">
                      <GraduationCap className="size-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{t(`schoolTypes.${s.type}`)}</div>
                    </div>
                  </div>
                  <Badge tone={s.rating >= 9 ? "success" : "primary"}>{s.rating.toFixed(1)} / 10</Badge>
                </div>
              ))}
            </div>
          )}

          {tab === "hospitals" && (
            <div className="space-y-3">
              {d.hospitals.map((h) => (
                <div
                  key={h.name}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-lg bg-info/10 text-info">
                      <Stethoscope className="size-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{h.name}</div>
                      <div className="text-xs text-muted-foreground">{t(`hospitalTiers.${h.tier}`)}</div>
                    </div>
                  </div>
                  <Badge tone={h.rating >= 9 ? "success" : "primary"}>{h.rating.toFixed(1)} / 10</Badge>
                </div>
              ))}
            </div>
          )}

          {tab === "notes" && (
            <NotesTab notes={d.notes} />
          )}
        </div>
      </aside>
    </div>
  );
}

function NotesTab({ notes }: { notes: string[] }) {
  const tAreas = useAreasT();
  return (
    <div className="space-y-3">
      {notes.map((n, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-ai">
            <Sparkles className="size-3.5" /> {tAreas("detail.marketNote")}
          </div>
          <p className="text-sm text-foreground">{n}</p>
        </div>
      ))}
      {notes.length === 0 && (
        <p className="text-sm text-muted-foreground">{tAreas("detail.noMarketNotes")}</p>
      )}
    </div>
  );
}

// ---------- Sortable header ----------

type SortKey = "areaScore" | "familyScore" | "schoolScore" | "healthcareScore" | "trafficScore" | "avgRent";

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey | null;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const isActive = active === sortKey;
  const Icon = isActive ? (dir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 transition-colors",
        isActive ? "text-primary" : "hover:text-foreground",
      )}
    >
      {label}
      <Icon className={cn("size-3.5", isActive ? "text-primary" : "text-muted-foreground/50")} />
    </button>
  );
}

// ---------- Page ----------

function AreasPage() {
  const { t } = useLanguage();
  const tAreas = useAreasT();
  const rawSearch = useRouterState({ select: s => s.location.searchStr });
  const areaParam = new URLSearchParams(rawSearch).get("area") ?? null;

  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<"All" | "Riyadh" | "Jeddah" | "Dammam">("All");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<LifestyleTag | "All">("All");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [liveAreas, setLiveAreas] = useState<ApiAreaSummary[]>([]);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  useEffect(() => {
    Promise.all([fetchAreaIntelligenceList(), fetchAreas()])
      .then(([intelligence, live]) => {
        setLiveAreas(live);
        const liveMap: Record<string, { listings: number; avgRent: number }> = {};
        live.forEach((a) => {
          liveMap[`${a.name.toLowerCase()}_${a.city.toLowerCase()}`] = {
            listings: a.property_count,
            avgRent: Math.round(a.average_rent * 12),
          };
        });
        // Fetch full detail for all districts to get schools/hospitals/trends
        return Promise.all(
          intelligence.map((summary) =>
            fetchAreaIntelligence(summary.area_name, summary.city).catch(() => null)
          )
        ).then((details) => {
          const built: District[] = details
            .filter(Boolean)
            .map((d) => {
              const key = `${d!.area_name.toLowerCase()}_${d!.city.toLowerCase()}`;
              const live = liveMap[key];
              return apiToDistrict(d!, live?.avgRent, live?.listings);
            });
          setDistricts(built);
          setLoading(false);
        });
      })
      .catch(() => setLoading(false));
  }, []);

  // Auto-open detail panel when arriving via ?area= link from home page
  useEffect(() => {
    if (!areaParam || districts.length === 0 || activeId) return;
    const match = districts.find(d => d.name.toLowerCase() === decodeURIComponent(areaParam).toLowerCase());
    if (match) setActiveId(match.id);
  }, [districts, areaParam]);

  const cityCounts = useMemo(() => {
    const m: Record<string, number> = { All: districts.length };
    districts.forEach((d) => (m[d.city] = (m[d.city] || 0) + 1));
    return m;
  }, [districts]);

  const filtered = useMemo(() => {
    const base = districts.filter((d) => {
      if (city !== "All" && d.city !== city) return false;
      if (tagFilter !== "All" && !d.tags.includes(tagFilter)) return false;
      if (query && !`${d.name} ${d.city}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    if (!sortKey) return base;
    return [...base].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "desc" ? -diff : diff;
    });
  }, [districts, city, tagFilter, query, sortKey, sortDir]);

  const stats = useMemo(() => {
    const avg = (k: keyof District) =>
      Math.round(filtered.reduce((s, d) => s + (d[k] as number), 0) / Math.max(1, filtered.length));
    return {
      districts: filtered.length,
      avgArea: avg("areaScore"),
      avgFamily: avg("familyScore"),
      avgRent: avg("avgRent"),
    };
  }, [filtered]);

  const active = activeId ? districts.find((d) => d.id === activeId) ?? null : null;
  const tags: (LifestyleTag | "All")[] = [
    "All",
    "Family Friendly",
    "Luxury",
    "Affordable",
    "Student Area",
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <main className="space-y-6 px-6 py-8">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </section>
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-9 shrink-0 rounded-lg" />
                  <div className="w-full space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3.5 w-28" />
                  </div>
                  <Skeleton className="h-4 w-10 shrink-0" />
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />

      <main className="space-y-6 px-6 py-8">
        {/* Heading */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{tAreas("heading")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tAreas("subtitle")}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              {tAreas("methodologyNote")}{" "}
              <Link to="/methodology" className="font-medium text-primary hover:underline">
                {tAreas("methodologyLinkLabel")}
              </Link>
            </p>
          </div>
          <Badge tone="ai">
            <Sparkles className="size-3" /> {tAreas("updatedBadge")}
          </Badge>
        </div>

          {/* Stat cards */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={tAreas("districtsTracked")}
              value={String(stats.districts)}
              icon={<MapIcon className="size-4" />}
            />
            <StatCard
              label={tAreas("avgAreaScore")}
              value={`${stats.avgArea}/100`}
              delta={tAreas("ptsUp2")}
              trend="up"
            />
            <StatCard
              label={tAreas("avgFamilyScore")}
              value={`${stats.avgFamily}/100`}
              delta={tAreas("ptUp1")}
              trend="up"
            />
            <StatCard
              label={tAreas("avgRent")}
              value={`SAR ${formatSAR(stats.avgRent)}`}
              delta={tAreas("yoyUp")}
              trend="up"
            />
          </section>

          {/* City chips */}
          <section className="flex flex-wrap items-center gap-2">
            <CityChip city="All" active={city === "All"} count={cityCounts.All} onClick={() => setCity("All")} />
            {(["Riyadh", "Jeddah", "Dammam"] as const).map((c) => (
              <CityChip
                key={c}
                city={c}
                count={cityCounts[c] || 0}
                active={city === c}
                onClick={() => setCity(c)}
              />
            ))}
          </section>

          {/* Filters */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tAreas("searchPlaceholder")}
                className="ps-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="me-1 text-xs font-semibold text-muted-foreground">{tAreas("lifestyle")}</span>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    tagFilter === tag
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-surface",
                  )}
                >
                  {tag === "All" ? tAreas("allCities") : t(`lifestyleTags.${tag}`)}
                </button>
              ))}
            </div>
          </section>

          {/* Table */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <div className="overflow-x-auto">
              {/* w-full alone caps the table at its container's width, which
                  defeats overflow-x-auto above (nothing ever exceeds 100%, so
                  it never scrolls) — a min-width lets 9 columns keep their
                  natural size on narrow screens and scroll horizontally
                  instead of being crushed unreadably into ~360px. */}
              <table className="w-full min-w-[780px] text-sm">
                <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">{tAreas("table.district")}</th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label={tAreas("table.area")} sortKey="areaScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label={tAreas("table.family")} sortKey="familyScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label={tAreas("table.schools")} sortKey="schoolScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label={tAreas("table.healthcare")} sortKey="healthcareScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label={tAreas("table.traffic")} sortKey="trafficScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">{tAreas("table.lifestyle")}</th>
                    <th className="px-3 py-3 text-start font-semibold">
                      <SortableHeader label={tAreas("table.avgRent")} sortKey="avgRent" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-start font-semibold">{tAreas("table.trend")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => setActiveId(d.id)}
                      className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface/60"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 text-start">
                          <div className="grid size-9 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                            <MapPin className="size-4" />
                          </div>
                          <div>
                            <div className="font-semibold">{d.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {tAreas("table.listingsCount", { city: t(`cities.${d.city}`), count: d.listings })}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ScorePill value={d.areaScore} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ScorePill value={d.familyScore} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ScorePill value={d.schoolScore} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ScorePill value={d.healthcareScore} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ScorePill value={d.trafficScore} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {d.tags.map((tag) => (
                            <Badge key={tag} tone={TAG_TONES[tag]}>
                              {t(`lifestyleTags.${tag}`)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold tabular-nums">
                          SAR {formatSAR(d.avgRent)}
                        </div>
                        <div className={cn("text-xs font-medium", d.yoy >= 0 ? "text-success" : "text-info")}>
                          {tAreas("table.yoy", { sign: d.yoy > 0 ? "+" : "", pct: d.yoy })}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <MiniTrend data={d.trends} />
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        {tAreas("table.noMatches")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-center text-xs text-muted-foreground">
            {tAreas("footerNote")}
          </p>
        </main>

      {active && (
        <DetailPanel
          d={active}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}
