import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Home,
  Minus,
  Sparkles,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { LoadErrorNotice } from "@/components/admin/LoadErrorNotice";
import { RequireAdmin } from "@/components/admin/RequireAdmin";
import { fetchAnalyticsSummary, type AnalyticsSummary } from "@/lib/api/maskan";
import { apiErrorMessage } from "@/lib/adminFeedback";
import { cn } from "@/lib/utils";

// Admin analytics. Lives under /admin so it uses the admin portal session
// (auth-storage.ts `portalScope`); at its old /analytics path an already
// signed-in admin was shown a sign-in gate, and signing in there stored the
// admin token under the *customer* scope. /analytics now redirects here.
//
// Every figure comes from GET /analytics/summary, which computes it from real
// rows. There is deliberately no sample/fallback data: when the request fails
// the page says so, and sections the backend lists in `unavailable` (e.g.
// search demand — not tracked yet) are labelled as such instead of filled in.
export const Route = createFileRoute("/admin_/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Maskan Admin" }] }),
  component: AdminAnalyticsRoute,
});

function AdminAnalyticsRoute() {
  return (
    <RequireAdmin title="Analytics dashboard">
      <AnalyticsPage />
    </RequireAdmin>
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AnalyticsSummary };

function AnalyticsPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchAnalyticsSummary()
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: "error", message: apiErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  return (
    <div className="min-h-screen bg-surface/40">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <AdminBackLink />
            <BarChart3 className="size-5 text-primary" />
            <span className="text-lg font-bold">Analytics</span>
          </div>
          {state.kind === "ready" && (
            <span className="text-xs text-muted-foreground">
              Updated {formatDateTime(state.data.generated_at)}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <section>
          <Badge variant="secondary" className="bg-ai/10 text-ai">
            <Sparkles className="me-1 size-3" /> Live data
          </Badge>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Analytics dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Listings, leads, users, AI usage and data quality — computed from Maskan's live records.
          </p>
        </section>

        {state.kind === "loading" && (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading analytics…
          </div>
        )}

        {state.kind === "error" && (
          <LoadErrorNotice what="analytics" message={state.message} onRetry={() => void load()} />
        )}

        {state.kind === "ready" && <Dashboard data={state.data} />}
      </main>
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsSummary }) {
  const unavailable = new Set(data.unavailable ?? []);
  const windowDays = data.window_days;
  const inventoryTotal = data.inventory.reduce(
    (s, c) => s + c.published + c.pending + c.inactive,
    0,
  );

  return (
    <>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((k) => (
          <KpiCard key={k.label} {...k} icon={kpiIcon(k.label)} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Search demand" subtitle="Searches by city">
          {unavailable.has("searchDemand") || data.searchDemand.length === 0 ? (
            <NotTracked text="Search activity isn't tracked yet, so there is no search-demand data to show." />
          ) : null}
        </Panel>

        <Panel title="Areas with most listings" subtitle="All listing statuses">
          {data.popularAreas.length === 0 ? (
            <NotTracked text="No listings yet." />
          ) : (
            <div className="space-y-3">
              {data.popularAreas.map((a, i) => (
                <div key={`${a.name}-${a.city}`}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[10px] font-bold text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">· {a.city}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums">
                      {a.listings.toLocaleString()}
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
          )}
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Activity totals" subtitle="All time">
          <Funnel data={data.funnel} />
        </Panel>

        <Panel title="AI requests by feature" subtitle={`Top 5 features · last ${windowDays} days`}>
          {unavailable.has("aiTrends") ? (
            <NotTracked text="The AI usage log couldn't be read." />
          ) : data.aiTrends.length === 0 ? (
            <NotTracked text={`No AI requests in the last ${windowDays} days.`} />
          ) : (
            <Donut data={data.aiTrends} />
          )}
        </Panel>

        <Panel title="Data quality" subtitle="Share of all listings · vs. target">
          <div className="space-y-4">
            {data.dataQuality.map((d) => (
              <QualityBar key={d.label} {...d} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Inventory by city"
          subtitle="Listing status"
          badge={{ label: `${inventoryTotal.toLocaleString()} listings`, tone: "info" }}
        >
          {data.inventory.length === 0 ? (
            <NotTracked text="No listings yet." />
          ) : (
            <>
              <InventoryChart data={data.inventory} />
              <Legend
                items={[
                  { label: "Published", color: "var(--chart-1)" },
                  { label: "Pending approval", color: "var(--chart-4)" },
                  { label: "Draft / suspended / rejected / hidden", color: "var(--chart-2)" },
                ]}
              />
            </>
          )}
        </Panel>

        <Panel title="Recent activity" subtitle="Latest listings, leads and sign-ups">
          {data.activity.length === 0 ? (
            <NotTracked text="No activity yet." />
          ) : (
            <ul className="space-y-3">
              {data.activity.map((a, i) => (
                <ActivityRow
                  key={i}
                  icon={activityIcon(a.tone)}
                  {...a}
                  time={formatRelative(a.time)}
                />
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </>
  );
}

/* ------------------------------ Helpers ------------------------------- */

function kpiIcon(label: string) {
  const key = label.toLowerCase();
  if (key.includes("propert")) return Home;
  if (key.includes("lead")) return Target;
  if (key.includes("user")) return Users;
  if (key.includes("ai")) return Sparkles;
  return Home;
}

function activityIcon(tone: string) {
  if (tone === "success") return UserPlus;
  if (tone === "primary") return Building2;
  if (tone === "info") return Target;
  return CheckCircle2;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function formatRelative(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------ Building blocks ----------------------- */

function NotTracked({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  sub,
  trend,
  icon: Icon,
  accent,
}: AnalyticsSummary["kpis"][number] & { icon: typeof Home }) {
  const tone: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    ai: "bg-ai/10 text-ai",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 font-display text-3xl font-bold tracking-tight">{value}</div>
        </div>
        <div className={cn("flex size-10 items-center justify-center rounded-xl", tone[accent])}>
          <Icon className="size-5" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              trend === "up"
                ? "bg-success/10 text-success"
                : trend === "down"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-surface text-muted-foreground",
            )}
          >
            {trend === "up" ? (
              <ArrowUpRight className="size-3" />
            ) : trend === "down" ? (
              <ArrowDownRight className="size-3" />
            ) : (
              <Minus className="size-3" />
            )}
            {delta}
          </span>
        ) : (
          <span />
        )}
        <span className="text-end text-xs text-muted-foreground">{sub}</span>
      </div>
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
  badge?: { label: string; tone: "success" | "info" | "ai" };
  className?: string;
  children: React.ReactNode;
}) {
  const toneClass: Record<string, string> = {
    success: "bg-success/10 text-success",
    info: "bg-info/10 text-info",
    ai: "bg-ai/10 text-ai",
  };
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-card", className)}>
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

function Funnel({ data }: { data: AnalyticsSummary["funnel"] }) {
  const max = Math.max(1, ...data.map((f) => f.value));
  return (
    <div className="space-y-3">
      {data.map((f) => (
        <div key={f.stage}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium">{f.stage}</span>
            <span className="tabular-nums text-muted-foreground">{f.value.toLocaleString()}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(f.value / max) * 100}%`,
                background: `var(--${f.color})`,
                opacity: 0.85,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Donut({ data }: { data: AnalyticsSummary["aiTrends"] }) {
  const totalPct = data.reduce((s, d) => s + d.value, 0) || 1;
  const totalCount = data.reduce((s, d) => s + d.count, 0);
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
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox="0 0 160 160"
        className="size-36 -rotate-90"
        role="img"
        aria-label="AI requests by feature"
      >
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface)" strokeWidth="18" />
        {data.map((d, i) => {
          const dash = C * (d.value / totalPct);
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
            {totalCount.toLocaleString()}
          </text>
          <text x="80" y="92" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
            top 5
          </text>
        </g>
      </svg>
      <ul className="min-w-40 flex-1 space-y-2 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: colors[i % colors.length] }}
              />
              {d.label}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">{d.value}%</span>
              <span className="text-muted-foreground"> · {d.count.toLocaleString()}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QualityBar({ label, value, target }: { label: string; value: number; target: number }) {
  const meeting = value >= target;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="shrink-0 tabular-nums">
          <span className={meeting ? "text-success" : "text-warning"}>{value}%</span>
          <span className="text-muted-foreground"> / target {target}%</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface">
        <div
          className={cn("h-full rounded-full", meeting ? "bg-success" : "bg-warning")}
          style={{ width: `${value}%` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-foreground/40"
          style={{ insetInlineStart: `${target}%` }}
        />
      </div>
    </div>
  );
}

function InventoryChart({ data }: { data: AnalyticsSummary["inventory"] }) {
  const max = Math.max(1, ...data.map((c) => c.published + c.pending + c.inactive));
  const seg = (v: number, color: string, label: string) =>
    v > 0 ? (
      <div title={`${label}: ${v}`} style={{ width: `${(v / max) * 100}%`, background: color }} />
    ) : null;
  return (
    <div className="space-y-2.5" role="img" aria-label="Inventory by city">
      {data.map((c) => (
        <div key={c.city} className="flex items-center gap-3 text-xs">
          <span className="w-20 shrink-0 truncate font-semibold">{c.city}</span>
          <div className="flex h-4 flex-1 overflow-hidden rounded-md bg-surface">
            {seg(c.published, "var(--chart-1)", "Published")}
            {seg(c.pending, "var(--chart-4)", "Pending approval")}
            {seg(c.inactive, "var(--chart-2)", "Draft / suspended / rejected / hidden")}
          </div>
          <span className="w-10 shrink-0 text-end tabular-nums text-muted-foreground">
            {(c.published + c.pending + c.inactive).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
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
  };
  return (
    <li className="flex gap-3 rounded-xl p-2 transition-colors hover:bg-surface/60">
      <div
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          toneClass[tone],
        )}
      >
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
