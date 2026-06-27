import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  Database,
  Download,
  Filter,
  Home,
  MapPin,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchAnalyticsSummary, type AnalyticsSummary } from "@/lib/api/maskan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics Dashboard — Maskan" },
      {
        name: "description",
        content:
          "Executive analytics for Maskan: search demand, lead conversion, AI usage, data quality and inventory health across the Saudi rental market.",
      },
    ],
  }),
  component: AnalyticsPage,
});

/* ----------------------------- Sample data ----------------------------- */

const ranges = ["7 days", "30 days", "Quarter", "Year"] as const;
type Range = (typeof ranges)[number];
type DashboardKpi = AnalyticsSummary["kpis"][number] & { icon: typeof Home };
type DashboardAnalytics = Omit<AnalyticsSummary, "kpis"> & { kpis: DashboardKpi[] };

const kpis = [
  {
    label: "Total properties",
    value: "12,486",
    delta: "+8.2%",
    sub: "vs. last 30 days",
    trend: "up" as const,
    icon: Home,
    accent: "primary",
  },
  {
    label: "Total leads",
    value: "3,914",
    delta: "+14.6%",
    sub: "1,208 new this week",
    trend: "up" as const,
    icon: Users,
    accent: "info",
  },
  {
    label: "Conversion rate",
    value: "6.4%",
    delta: "+0.9 pp",
    sub: "Lead → viewing",
    trend: "up" as const,
    icon: Target,
    accent: "success",
  },
  {
    label: "AI usage",
    value: "48,210",
    delta: "+22.4%",
    sub: "Advisor sessions",
    trend: "up" as const,
    icon: Sparkles,
    accent: "ai",
  },
];

// Weekly search demand (Sun-Sat)
const searchDemand = [
  { day: "Sun", riyadh: 1240, jeddah: 820, dammam: 320 },
  { day: "Mon", riyadh: 1640, jeddah: 1010, dammam: 380 },
  { day: "Tue", riyadh: 1820, jeddah: 1120, dammam: 410 },
  { day: "Wed", riyadh: 2040, jeddah: 1180, dammam: 440 },
  { day: "Thu", riyadh: 2480, jeddah: 1390, dammam: 510 },
  { day: "Fri", riyadh: 1860, jeddah: 1240, dammam: 420 },
  { day: "Sat", riyadh: 2210, jeddah: 1320, dammam: 480 },
];

const popularAreas = [
  { name: "Al Yasmin", city: "Riyadh", searches: 18420, share: 100 },
  { name: "Al Narjis", city: "Riyadh", searches: 16210, share: 88 },
  { name: "Al Malqa", city: "Riyadh", searches: 14380, share: 78 },
  { name: "Al Shati", city: "Jeddah", searches: 11240, share: 61 },
  { name: "Al Aqiq", city: "Riyadh", searches: 9820, share: 53 },
  { name: "KAFD", city: "Riyadh", searches: 8410, share: 46 },
  { name: "Al Khobar Corniche", city: "Khobar", searches: 6210, share: 34 },
];

// Funnel
const funnel = [
  { stage: "Search impressions", value: 184_200, color: "chart-1" },
  { stage: "Listing views", value: 64_820, color: "chart-2" },
  { stage: "Inquiries sent", value: 12_410, color: "chart-3" },
  { stage: "Viewings scheduled", value: 3_914, color: "chart-4" },
  { stage: "Contracts signed", value: 612, color: "chart-5" },
];

// AI question categories
const aiTrends = [
  { label: "Area recommendation", value: 38, delta: "+6.1%" },
  { label: "Budget fit", value: 26, delta: "+4.8%" },
  { label: "Compare districts", value: 18, delta: "+2.2%" },
  { label: "Rent fairness check", value: 12, delta: "+1.4%" },
  { label: "Schools & family", value: 6, delta: "-0.3%" },
];

const dataQuality = [
  { label: "Verified listings", value: 92, target: 95 },
  { label: "Complete photos", value: 84, target: 90 },
  { label: "Geocoded address", value: 97, target: 98 },
  { label: "Owner ID attached", value: 78, target: 85 },
  { label: "Pricing within band", value: 88, target: 90 },
];

const inventory = [
  { city: "Riyadh", available: 6420, reserved: 410, rented: 1820 },
  { city: "Jeddah", available: 3180, reserved: 220, rented: 940 },
  { city: "Dammam", available: 1240, reserved: 110, rented: 380 },
  { city: "Khobar", available: 980, reserved: 70, rented: 290 },
  { city: "Madinah", available: 660, reserved: 40, rented: 180 },
];

const activity = [
  {
    icon: UserPlus,
    tone: "info",
    title: "New lead — Skyline Residence, Al Olaya",
    meta: "Sara A. · SAR 145K budget",
    time: "2 min ago",
  },
  {
    icon: CheckCircle2,
    tone: "success",
    title: "Contract signed — Najdi Modern Villa",
    meta: "Agent: Noura Al-Qahtani · SAR 235K/year",
    time: "18 min ago",
  },
  {
    icon: Bot,
    tone: "ai",
    title: "AI Advisor recommended Al Narjis to 14 users",
    meta: "Family budget cluster · SAR 80–100K",
    time: "32 min ago",
  },
  {
    icon: Building2,
    tone: "primary",
    title: "26 new listings imported",
    meta: "Batch BTH-2026-0612 · riyadh_q2_listings.xlsx",
    time: "1 hr ago",
  },
  {
    icon: TrendingUp,
    tone: "warning",
    title: "Rental index ↑ 4.2% in Al Malqa",
    meta: "Trailing 30-day comparison",
    time: "3 hr ago",
  },
  {
    icon: MessageSquare,
    tone: "info",
    title: "Inquiry replied — KAFD Penthouse",
    meta: "Avg. response time today: 6 min",
    time: "5 hr ago",
  },
];

/* ------------------------------- Page --------------------------------- */

function AnalyticsPage() {
  const [range, setRange] = useState<Range>("30 days");
  const [data, setData] = useState<DashboardAnalytics>({
    total_properties: 0,
    total_users: 0,
    kpis,
    searchDemand,
    popularAreas,
    funnel,
    aiTrends,
    dataQuality,
    inventory,
    activity: activity.map((item) => ({
      tone: item.tone,
      title: item.title,
      meta: item.meta,
      time: item.time,
    })),
  });

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      try {
        const summary = await fetchAnalyticsSummary();
        if (!cancelled) {
          setData({
            ...summary,
            kpis: summary.kpis.map((k) => ({ ...k, icon: kpiIcon(k.label) })),
          });
        }
      } catch {
        // Keep fallback sample data when API fails.
      }
    }

    void loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="min-h-screen bg-surface/40">
      <Header range={range} setRange={setRange} />

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-ai/10 text-ai">
                <Sparkles className="mr-1 size-3" /> Executive view
              </Badge>
              <span className="text-xs text-muted-foreground">Updated 6 min ago</span>
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Analytics dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Performance across listings, leads, AI advisor and data quality — Saudi market.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled title="Coming soon">
              <Filter className="size-4" /> Segments
            </Button>
            <Button variant="outline" size="sm" disabled title="Coming soon">
              <Download className="size-4" /> Export
            </Button>
            <Button size="sm" asChild>
              <Link to="/advisor"><Zap className="size-4" /> AI insights</Link>
            </Button>
          </div>
        </section>

        {/* KPI cards */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.kpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </section>

        {/* Main charts row */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Search demand"
            subtitle="Daily searches by city · last 7 days"
            badge={{ label: "↑ 12.8%", tone: "success" }}
          >
            <DemandChart data={data.searchDemand} />
            <Legend
              items={[
                { label: "Riyadh", color: "var(--chart-1)" },
                { label: "Jeddah", color: "var(--chart-2)" },
                { label: "Dammam", color: "var(--chart-3)" },
              ]}
            />
          </Panel>

          <Panel
            title="Most popular areas"
            subtitle="Searches in last 30 days"
            badge={{ label: "Top 7", tone: "info" }}
          >
            <div className="space-y-3">
              {data.popularAreas.map((a, i) => (
                <div key={a.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface text-[10px] font-bold text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground">· {a.city}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">
                      {a.searches.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${a.share}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        {/* Second row */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel
            title="Lead conversion"
            subtitle="Funnel · last 30 days"
            badge={{ label: "6.4% close", tone: "success" }}
          >
            <Funnel data={data.funnel} />
          </Panel>

          <Panel
            title="AI question trends"
            subtitle="Top categories asked of Advisor"
            badge={{ label: "+22% MoM", tone: "ai" }}
          >
            <Donut data={data.aiTrends} />
          </Panel>

          <Panel
            title="Data quality"
            subtitle="Validation coverage vs. target"
            badge={{ label: "Healthy", tone: "success" }}
          >
            <div className="space-y-4">
              {data.dataQuality.map((d) => (
                <QualityBar key={d.label} {...d} />
              ))}
            </div>
          </Panel>
        </section>

        {/* Third row: Inventory + Activity */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Inventory health"
            subtitle="Status by city"
            badge={{ label: "12,486 units", tone: "info" }}
          >
            <InventoryChart data={data.inventory} />
            <Legend
              items={[
                { label: "Available", color: "var(--chart-1)" },
                { label: "Reserved", color: "var(--chart-4)" },
                { label: "Rented", color: "var(--chart-2)" },
              ]}
            />
          </Panel>

          <Panel
            title="Recent activity"
            subtitle="Real-time feed"
            badge={{ label: "Live", tone: "destructive" }}
          >
            <ul className="space-y-3">
              {data.activity.map((a, i) => (
                <ActivityRow key={i} icon={activityIcon(a.tone)} {...a} />
              ))}
            </ul>
          </Panel>
        </section>
      </main>
    </div>
  );
}

function kpiIcon(label: string) {
  const key = label.toLowerCase();
  if (key.includes("property")) return Home;
  if (key.includes("lead")) return Users;
  if (key.includes("conversion")) return Target;
  if (key.includes("ai")) return Sparkles;
  return Home;
}

/* ------------------------------ Header -------------------------------- */

function Header({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Admin
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">Analytics</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1 rounded-full border border-border bg-card p-1 md:flex">
            {ranges.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" disabled title="Coming soon">
            <Calendar className="size-4" /> Jun 1 – Jun 9
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------ Building blocks ----------------------- */

function KpiCard({
  label,
  value,
  delta,
  sub,
  trend,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  delta: string;
  sub: string;
  trend: "up" | "down";
  icon: typeof Home;
  accent: string;
}) {
  const tone: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    ai: "bg-ai/10 text-ai",
  };
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card transition-shadow hover:shadow-elevated">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 font-display text-3xl font-bold tracking-tight">{value}</div>
        </div>
        <div className={cn("flex size-10 items-center justify-center rounded-xl", tone[accent])}>
          <Icon className="size-5" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            trend === "up" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {trend === "up" ? (
            <ArrowUpRight className="size-3" />
          ) : (
            <ArrowDownRight className="size-3" />
          )}
          {delta}
        </span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
      <div className="pointer-events-none absolute -bottom-12 -right-12 size-32 rounded-full bg-gradient-to-tr from-primary/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

function Panel({
  title,
  subtitle,
  badge,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: { label: string; tone: "success" | "info" | "ai" | "destructive" };
  className?: string;
  children: React.ReactNode;
}) {
  const toneClass: Record<string, string> = {
    success: "bg-success/10 text-success",
    info: "bg-info/10 text-info",
    ai: "bg-ai/10 text-ai",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-card",
        className,
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {badge && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              toneClass[badge.tone],
            )}
          >
            {badge.tone === "destructive" && (
              <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
            )}
            {badge.label}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
      {items.map((i) => (
        <div key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Charts ------------------------------ */

function DemandChart({ data }: { data: AnalyticsSummary["searchDemand"] }) {
  const w = 640;
  const h = 240;
  const pad = { l: 36, r: 12, t: 14, b: 24 };
  const max = useMemo(
    () =>
      Math.max(
        ...data.flatMap((d) => [d.riyadh, d.jeddah, d.dammam]),
      ) * 1.15,
    [data],
  );
  const xStep = (w - pad.l - pad.r) / Math.max(1, data.length - 1);
  const y = (v: number) => h - pad.b - ((h - pad.t - pad.b) * v) / max;
  const x = (i: number) => pad.l + xStep * i;

  const series = [
    { key: "riyadh", color: "var(--chart-1)" },
    { key: "jeddah", color: "var(--chart-2)" },
    { key: "dammam", color: "var(--chart-3)" },
  ] as const;

  const gridLines = 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full">
      {Array.from({ length: gridLines + 1 }).map((_, i) => {
        const yy = pad.t + ((h - pad.t - pad.b) * i) / gridLines;
        return (
          <line
            key={i}
            x1={pad.l}
            x2={w - pad.r}
            y1={yy}
            y2={yy}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
        );
      })}
      {data.map((d, i) => (
        <text
          key={d.day}
          x={x(i)}
          y={h - 6}
          textAnchor="middle"
          fontSize="10"
          fill="var(--muted-foreground)"
        >
          {d.day}
        </text>
      ))}
      {series.map((s) => {
        const pts = data
          .map((d, i) => `${x(i)},${y(d[s.key])}`)
          .join(" ");
        const area =
          `M ${x(0)},${h - pad.b} L ` +
          data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" L ") +
          ` L ${x(data.length - 1)},${h - pad.b} Z`;
        return (
          <g key={s.key}>
            <path d={area} fill={s.color} opacity={0.08} />
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pts}
            />
            {data.map((d, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(d[s.key])}
                r={3}
                fill="var(--background)"
                stroke={s.color}
                strokeWidth={2}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function Funnel({ data }: { data: AnalyticsSummary["funnel"] }) {
  const max = data[0]?.value ?? 1;
  return (
    <div className="space-y-3">
      {data.map((f, i) => {
        const width = (f.value / max) * 100;
        const next = data[i + 1];
        const dropoff = next ? Math.round((1 - next.value / f.value) * 100) : null;
        return (
          <div key={f.stage}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{f.stage}</span>
              <span className="tabular-nums text-muted-foreground">
                {f.value.toLocaleString()}
              </span>
            </div>
            <div className="relative h-8 overflow-hidden rounded-lg bg-surface">
              <div
                className="h-full rounded-lg transition-all"
                style={{
                  width: `${width}%`,
                  background: `var(--${f.color})`,
                  opacity: 0.85,
                }}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-xs font-semibold text-card-foreground mix-blend-difference">
                {((f.value / max) * 100).toFixed(1)}%
              </span>
            </div>
            {dropoff !== null && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                ↘ {dropoff}% drop to next stage
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Donut({ data }: { data: typeof aiTrends }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 56;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const colors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ];

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 160 160" className="size-36 -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface)" strokeWidth="18" />
        {data.map((d, i) => {
          const pct = d.value / total;
          const dash = C * pct;
          const seg = (
            <circle
              key={d.label}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="18"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return seg;
        })}
        <g transform="rotate(90 80 80)">
          <text
            x="80"
            y="76"
            textAnchor="middle"
            fontSize="22"
            fontWeight="700"
            fill="var(--foreground)"
          >
            {(total).toLocaleString()}
          </text>
          <text
            x="80"
            y="92"
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            % of questions
          </text>
        </g>
      </svg>
      <ul className="flex-1 space-y-2 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: colors[i % colors.length] }}
              />
              {d.label}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">{d.value}%</span>
              <span
                className={cn(
                  "text-[10px] font-semibold",
                  d.delta.startsWith("-") ? "text-destructive" : "text-success",
                )}
              >
                {d.delta}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QualityBar({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const meeting = value >= target;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span className={meeting ? "text-success" : "text-warning"}>{value}%</span>
          <span className="text-muted-foreground"> / {target}%</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface">
        <div
          className={cn("h-full rounded-full", meeting ? "bg-success" : "bg-warning")}
          style={{ width: `${value}%` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-foreground/40"
          style={{ left: `${target}%` }}
        />
      </div>
    </div>
  );
}

function InventoryChart({ data }: { data: AnalyticsSummary["inventory"] }) {
  const w = 640;
  const h = 240;
  const pad = { l: 56, r: 12, t: 14, b: 28 };
  const max = Math.max(
    ...data.map((c) => c.available + c.reserved + c.rented),
  );
  const bandH = (h - pad.t - pad.b) / Math.max(1, data.length);
  const groupGap = 10;
  const barH = (bandH - groupGap) / 1;
  const xScale = (v: number) => (v / max) * (w - pad.l - pad.r);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full">
      {[0.25, 0.5, 0.75, 1].map((t) => {
        const x = pad.l + (w - pad.l - pad.r) * t;
        return (
          <line
            key={t}
            x1={x}
            x2={x}
            y1={pad.t}
            y2={h - pad.b}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
        );
      })}
      {data.map((c, i) => {
        const y = pad.t + bandH * i + groupGap / 2;
        const aW = xScale(c.available);
        const rW = xScale(c.reserved);
        const tW = xScale(c.rented);
        return (
          <g key={c.city}>
            <text
              x={pad.l - 10}
              y={y + barH / 2 + 4}
              textAnchor="end"
              fontSize="11"
              fontWeight="600"
              fill="var(--foreground)"
            >
              {c.city}
            </text>
            <rect x={pad.l} y={y} width={aW} height={barH} fill="var(--chart-1)" rx="4" />
            <rect
              x={pad.l + aW}
              y={y}
              width={rW}
              height={barH}
              fill="var(--chart-4)"
              rx="0"
            />
            <rect
              x={pad.l + aW + rW}
              y={y}
              width={tW}
              height={barH}
              fill="var(--chart-2)"
              rx="4"
            />
            <text
              x={pad.l + aW + rW + tW + 6}
              y={y + barH / 2 + 4}
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {(c.available + c.reserved + c.rented).toLocaleString()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ActivityRow({
  icon: Icon,
  tone,
  title,
  meta,
  time,
}: {
  icon: typeof Home;
  tone: string;
  title: string;
  meta: string;
  time: string;
}) {
  const toneClass: Record<string, string> = {
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    ai: "bg-ai/10 text-ai",
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <li className="flex gap-3 rounded-xl p-2 transition-colors hover:bg-surface/60">
      <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", toneClass[tone])}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
    </li>
  );
}

function activityIcon(tone: string) {
  if (tone === "success") return CheckCircle2;
  if (tone === "ai") return Sparkles;
  if (tone === "primary") return Building2;
  if (tone === "warning") return TrendingUp;
  return Users;
}

/* unused imports referenced for tree-shake safety */
void MapPin;
void Database;
void Activity;
