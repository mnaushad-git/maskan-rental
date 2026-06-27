import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Compass,
  Download,
  GraduationCap,
  Heart,
  Hospital,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Stethoscope,
  TrafficCone,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/maskan/Badges";
import { ScoreBar } from "@/components/maskan/ScoreIndicator";
import { StatCard } from "@/components/maskan/Widgets";
import { formatSAR } from "@/lib/maskan-data";
import { fetchAreas, fetchAreaIntelligenceList, fetchAreaIntelligence, type ApiAreaSummary, type ApiAreaIntelligence } from "@/lib/api/maskan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/areas")({
  head: () => ({
    meta: [
      { title: "Area Intelligence Console — Maskan" },
      {
        name: "description",
        content:
          "Manage city and district intelligence: scores, lifestyle tags, rental trends, schools, hospitals and market notes.",
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

// ---------- Sidebar ----------

function AreaSidebar() {
  const items = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/admin", active: false },
    { icon: MapIcon, label: "Area Intelligence", href: "/areas", active: true },
    { icon: Building2, label: "Listings", href: "/admin", active: false },
    { icon: Users, label: "Users", href: "/admin", active: false },
    { icon: Settings, label: "Settings", href: "/admin", active: false },
  ];
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Compass className="size-4" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight">Maskan Console</div>
          <div className="text-xs text-muted-foreground">Area Intelligence</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((it) => (
          <Link
            key={it.label}
            to={it.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              it.active
                ? "bg-primary-soft text-accent-foreground"
                : "text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            <it.icon className="size-4" />
            {it.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-border p-4">
        <div className="rounded-xl bg-ai-soft p-3 text-xs text-ai">
          <div className="mb-1 inline-flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-3.5" /> AI insights
          </div>
          District scores refresh nightly from listing + transaction signals.
        </div>
      </div>
    </aside>
  );
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
      {city}
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

function DetailPanel({ d, onClose, onAddNote }: { d: District; onClose: () => void; onAddNote: (note: string) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: { id: Tab; label: string; icon: typeof Heart }[] = [
    { id: "overview", label: "Overview", icon: Compass },
    { id: "trends", label: "Rental Trends", icon: TrendingUp },
    { id: "schools", label: "Schools", icon: GraduationCap },
    { id: "hospitals", label: "Hospitals", icon: Hospital },
    { id: "notes", label: "Market Notes", icon: Sparkles },
  ];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-foreground/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <MapPin className="size-3.5" /> {d.city}
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">{d.name}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.tags.map((t) => (
                <Badge key={t} tone={TAG_TONES[t]}>
                  {t}
                </Badge>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close detail">
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex items-center gap-1 border-b border-border px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {tab === "overview" && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">{d.overview}</p>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Avg. Rent" value={`SAR ${formatSAR(d.avgRent)}`} delta={`${d.yoy > 0 ? "+" : ""}${d.yoy}% YoY`} trend={d.yoy >= 0 ? "up" : "down"} />
                <StatCard label="Active Listings" value={String(d.listings)} icon={<Building2 className="size-4" />} />
              </div>
              <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">District scores</div>
                  <Link to="/methodology" className="text-xs text-muted-foreground hover:text-primary hover:underline">
                    How scores work →
                  </Link>
                </div>
                <ScoreBar label="Area Quality" value={d.areaScore} />
                <ScoreBar label="Family Suitability" value={d.familyScore} />
                <ScoreBar label="Schools" value={d.schoolScore} />
                <ScoreBar label="Healthcare" value={d.healthcareScore} />
                <ScoreBar label="Traffic Flow" value={d.trafficScore} />
              </div>
            </>
          )}

          {tab === "trends" && (
            <>
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-1 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Average annual rent</div>
                    <div className="text-xs text-muted-foreground">5-year trajectory</div>
                  </div>
                  <Badge tone={d.yoy >= 0 ? "success" : "info"}>
                    <TrendingUp className="size-3" />
                    {d.yoy > 0 ? "+" : ""}
                    {d.yoy}% YoY
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
                      <div className="text-xs text-muted-foreground">{s.type}</div>
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
                      <div className="text-xs text-muted-foreground">{h.tier}</div>
                    </div>
                  </div>
                  <Badge tone={h.rating >= 9 ? "success" : "primary"}>{h.rating.toFixed(1)} / 10</Badge>
                </div>
              ))}
            </div>
          )}

          {tab === "notes" && (
            <NotesTab notes={d.notes} onAddNote={onAddNote} />
          )}
        </div>
      </aside>
    </div>
  );
}

function NotesTab({ notes, onAddNote }: { notes: string[]; onAddNote: (note: string) => void }) {
  const [draft, setDraft] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onAddNote(text);
    setDraft("");
  }

  return (
    <div className="space-y-3">
      {notes.map((n, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-ai">
            <Sparkles className="size-3.5" /> Market note
          </div>
          <p className="text-sm text-foreground">{n}</p>
        </div>
      ))}
      {notes.length === 0 && (
        <p className="text-sm text-muted-foreground">No market notes yet.</p>
      )}
      <form onSubmit={handleAdd} className="rounded-xl border border-dashed border-border bg-surface p-4 space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add market note</div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Demand for 4BR villas rising sharply this quarter…"
          rows={3}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
        />
        <Button type="submit" size="sm" variant="outline" className="w-full" disabled={!draft.trim()}>
          <Plus className="size-4" /> Add note
        </Button>
      </form>
    </div>
  );
}

function NewDistrictModal({ onAdd, onClose }: { onAdd: (d: District) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState<"Riyadh" | "Jeddah" | "Dammam">("Riyadh");
  const [avgRent, setAvgRent] = useState(100000);
  const [areaScore, setAreaScore] = useState(80);
  const [familyScore, setFamilyScore] = useState(80);
  const [overview, setOverview] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const newDistrict: District = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      city,
      areaScore,
      familyScore,
      schoolScore: 80,
      healthcareScore: 80,
      trafficScore: 80,
      avgRent,
      yoy: 0,
      listings: 0,
      tags: [],
      overview: overview.trim() || `${name.trim()}, ${city} — newly added district.`,
      trends: [{ year: "2025", rent: avgRent }],
      schools: [],
      hospitals: [],
      notes: [],
    };
    onAdd(newDistrict);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">New district</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="size-4" /></Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">District name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Al Nakheel"
              required
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">City</label>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value as typeof city)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="Riyadh">Riyadh</option>
              <option value="Jeddah">Jeddah</option>
              <option value="Dammam">Dammam</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Avg. rent / year (SAR)</label>
              <input
                type="number"
                value={avgRent}
                onChange={(e) => setAvgRent(Number(e.target.value))}
                min={0}
                step={5000}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Area score (0–100)</label>
              <input
                type="number"
                value={areaScore}
                onChange={(e) => setAreaScore(Number(e.target.value))}
                min={0}
                max={100}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Family score (0–100)</label>
            <input
              type="number"
              value={familyScore}
              onChange={(e) => setFamilyScore(Number(e.target.value))}
              min={0}
              max={100}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Overview (optional)</label>
            <textarea
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="Brief description of the district…"
              rows={2}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={!name.trim()}>
              <Plus className="size-4" /> Add district
            </Button>
          </div>
        </form>
      </div>
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
  const rawSearch = useRouterState({ select: s => s.location.searchStr });
  const areaParam = new URLSearchParams(rawSearch).get("area") ?? null;

  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<"All" | "Riyadh" | "Jeddah" | "Dammam">("All");
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<LifestyleTag | "All">("All");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeIntelligence, setActiveIntelligence] = useState<ApiAreaIntelligence | null>(null);
  const [showNewDistrict, setShowNewDistrict] = useState(false);
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

  const getLive = (_d: District) => undefined; // live data is already merged into District on load

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

  function addNote(id: string, note: string) {
    setDistricts((ds) => ds.map((d) => d.id === id ? { ...d, notes: [...d.notes, note] } : d));
  }

  function addDistrict(d: District) {
    setDistricts((ds) => [...ds, d]);
    setShowNewDistrict(false);
  }

  function exportCSV() {
    const header = ["Name", "City", "Area Score", "Family Score", "School Score", "Healthcare", "Traffic", "Avg Rent SAR", "YoY %", "Listings"].join(",");
    const rows = filtered.map((d) => {
      return [
        `"${d.name}"`, d.city, d.areaScore, d.familyScore, d.schoolScore, d.healthcareScore, d.trafficScore,
        d.avgRent, d.yoy, d.listings,
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "maskan-districts.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

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
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="text-sm text-muted-foreground">Loading area intelligence…</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <AreaSidebar />

      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <Link
                to="/"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" /> Maskan
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="truncate text-sm font-semibold">Area Intelligence</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="size-4" /> <span className="hidden sm:inline">Export</span>
              </Button>
              <Button size="sm" onClick={() => setShowNewDistrict(true)}>
                <Plus className="size-4" /> <span className="hidden sm:inline">New district</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="space-y-6 px-6 py-6">
          {/* Heading */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Area Intelligence Console</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage city and district profiles powering Maskan AI recommendations.
              </p>
            </div>
            <Badge tone="ai">
              <Sparkles className="size-3" /> Updated 6 Jun 2026
            </Badge>
          </div>

          {/* Stat cards */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Districts tracked"
              value={String(stats.districts)}
              icon={<MapIcon className="size-4" />}
            />
            <StatCard
              label="Avg. area score"
              value={`${stats.avgArea}/100`}
              delta="+2 pts"
              trend="up"
            />
            <StatCard
              label="Avg. family score"
              value={`${stats.avgFamily}/100`}
              delta="+1 pt"
              trend="up"
            />
            <StatCard
              label="Avg. rent"
              value={`SAR ${formatSAR(stats.avgRent)}`}
              delta="+3.8% YoY"
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
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search districts"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-muted-foreground">Lifestyle</span>
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(t)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                    tagFilter === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-surface",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          {/* Table */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">District</th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label="Area" sortKey="areaScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label="Family" sortKey="familyScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label="Schools" sortKey="schoolScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label="Healthcare" sortKey="healthcareScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      <SortableHeader label="Traffic" sortKey="trafficScore" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-left font-semibold">Lifestyle</th>
                    <th className="px-3 py-3 text-left font-semibold">
                      <SortableHeader label="Avg. rent" sortKey="avgRent" active={sortKey} dir={sortDir} onSort={handleSort} />
                    </th>
                    <th className="px-3 py-3 text-left font-semibold">Trend</th>
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
                        <div className="flex items-center gap-3 text-left">
                          <div className="grid size-9 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                            <MapPin className="size-4" />
                          </div>
                          <div>
                            <div className="font-semibold">{d.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {d.city} · {d.listings} listings
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
                          {d.tags.map((t) => (
                            <Badge key={t} tone={TAG_TONES[t]}>
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold tabular-nums">
                          SAR {formatSAR(d.avgRent)}
                        </div>
                        <div className={cn("text-xs font-medium", d.yoy >= 0 ? "text-success" : "text-info")}>
                          {d.yoy > 0 ? "+" : ""}
                          {d.yoy}% YoY
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
                        No districts match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-center text-xs text-muted-foreground">
            District intelligence powers Maskan AI Advisor area recommendations.
          </p>
        </main>
      </div>

      {active && (
        <DetailPanel
          d={active}
          onClose={() => setActiveId(null)}
          onAddNote={(note) => addNote(active.id, note)}
        />
      )}
      {showNewDistrict && <NewDistrictModal onAdd={addDistrict} onClose={() => setShowNewDistrict(false)} />}
    </div>
  );
}
