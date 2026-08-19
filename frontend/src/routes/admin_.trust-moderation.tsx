import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  EyeOff,
  Flag,
  Inbox,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminHideProperty,
  adminResolveReport,
  adminRestoreProperty,
  fetchAdminModerationProperties,
  fetchAdminPropertyReviewDetail,
  fetchAdminTrustDashboard,
  login,
  PROPERTY_REPORT_REASONS,
  type ApiAdminModerationListItem,
  type ApiAdminPropertyReviewDetail,
  type ApiAdminTrustDashboard,
  type ApiPropertyReport,
  type AuthUser,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// Self-contained (no imports from routes/admin.tsx), same rationale as
// admin_.property-requests.tsx / admin_.notifications.tsx: stays
// code-splittable, duplicates the small admin-auth-guard and
// KpiCard/Panel/ConfirmButton primitives rather than sharing code across the
// large admin route files.
//
// This page consumes Prompt 6's admin moderation API (backend/app/api/
// routes/admin_trust.py) — dashboard counts, the filterable property
// moderation list, and the per-property review detail with hide/restore/
// resolve-report actions. See docs/implementation/mymakan-trust-center.md
// "Prompt 11" for judgment calls (notably: no i18n — this codebase's admin
// console has never used the customer-facing i18n system, confirmed against
// admin.tsx / admin_.property-requests.tsx before writing this file; and
// "Request correction" is a UI-only affordance, not a new backend endpoint —
// Prompt 6 didn't build one).
export const Route = createFileRoute("/admin_/trust-moderation")({
  head: () => ({ meta: [{ title: "Trust & Moderation — myMakan Admin" }] }),
  component: AdminTrustModerationPage,
});

const PAGE_SIZE = 20;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const REPORT_REASON_LABELS: Record<string, string> = {
  duplicate_listing: "Duplicate listing",
  incorrect_information: "Incorrect information",
  no_longer_available: "No longer available",
  fraudulent_or_scam: "Fraudulent / scam",
  inappropriate_content: "Inappropriate content",
  other: "Other",
};

const PROPERTY_STATUS_OPTIONS = ["", "Draft", "Pending Approval", "Published", "Suspended", "Rejected", "Hidden"];
const TRUST_LEVEL_OPTIONS = ["", "High", "Good", "Moderate", "Limited Confidence"];

// ---------- Small local admin auth guard (mirrors admin_.property-requests.tsx) ----------

function AdminTrustModerationLoginGate({
  onAuth,
  nonAdminUser,
}: {
  onAuth: (user: AuthUser, token: string) => void;
  nonAdminUser: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await login({ email, password });
      if (!response.user.is_admin) {
        setError("This account does not have admin access.");
        return;
      }
      onAuth(response.user, response.access_token);
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow">
            <ShieldCheck className="size-7" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">Trust & Moderation</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {nonAdminUser
                ? "Your current account does not have admin access. Sign in with an admin account."
                : "Sign in with an admin account to continue"}
            </p>
          </div>
        </div>
        <form
          className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card"
          onSubmit={handleSubmit}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@maskan.sa"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email || !password}>
            {loading ? "Signing in…" : "Sign in to Admin Console"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------- Small local Kpi/Panel/Confirm primitives (deliberately not shared with other admin route files) ----------

function KpiCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger";
  sub?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 shadow-card",
        tone === "danger"
          ? "border-destructive/40 bg-destructive/5"
          : tone === "warning"
            ? "border-warning/40 bg-warning/5"
            : "border-border bg-card",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-bold tracking-tight",
          tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
  actions,
  id,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-2xl border border-border bg-card p-5 shadow-card scroll-mt-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function ConfirmButton({
  label,
  confirmLabel = "Confirm",
  onConfirm,
  destructive,
  disabled,
  extra,
}: {
  label: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  disabled?: boolean;
  // Optional extra control (e.g. a reason input) shown alongside the confirm/cancel pair.
  extra?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {extra}
        <button
          type="button"
          onClick={() => {
            onConfirm();
            setConfirming(false);
          }}
          className="rounded-md bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface"
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setConfirming(true)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        destructive
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : "border-border text-foreground hover:bg-surface",
      )}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    Published: "bg-success/10 text-success",
    "Pending Approval": "bg-warning/10 text-warning",
    Draft: "bg-muted text-muted-foreground",
    Suspended: "bg-destructive/10 text-destructive",
    Rejected: "bg-destructive/10 text-destructive",
    Hidden: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

function TrustLevelBadge({ level, score }: { level: string; score: number }) {
  const tone: Record<string, string> = {
    High: "bg-success/10 text-success",
    Good: "bg-info/10 text-info",
    Moderate: "bg-warning/10 text-warning",
    "Limited Confidence": "bg-destructive/10 text-destructive",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone[level] ?? "bg-muted text-muted-foreground")}>
      {score}/100 · {level}
    </span>
  );
}

// ---------- Dashboard ----------

function DashboardCards() {
  const [data, setData] = useState<ApiAdminTrustDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchAdminTrustDashboard()
      .then(setData)
      .catch(() => toast.error("Unable to load Trust & Moderation dashboard counts."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading dashboard…</p>;
  if (!data) return <p className="text-sm text-destructive">Unable to load dashboard.</p>;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard label="Listings requiring review" value={String(data.listings_requiring_review)} tone="warning" />
      <KpiCard label="Low completeness" value={String(data.low_completeness_listings)} tone={data.low_completeness_listings > 0 ? "warning" : undefined} />
      <KpiCard label="Stale listings" value={String(data.stale_listings)} tone={data.stale_listings > 0 ? "warning" : undefined} />
      <KpiCard label="Open reports" value={String(data.open_reports)} tone={data.open_reports > 0 ? "danger" : undefined} />
      <KpiCard label="Mediators pending verification" value={String(data.mediators_pending_verification)} />
      <KpiCard label="Recently reported" value={String(data.recently_reported_properties)} tone={data.recently_reported_properties > 0 ? "danger" : undefined} sub="Last 14 days" />
    </div>
  );
}

// ---------- Moderation list ----------

type Filters = {
  transactionType: "" | "rent" | "sale";
  city: string;
  status: string;
  trustLevel: string;
  lowCompleteness: boolean;
  reported: boolean;
  stale: boolean;
  mediatorVerified: "" | "true" | "false";
};

const EMPTY_FILTERS: Filters = {
  transactionType: "",
  city: "",
  status: "",
  trustLevel: "",
  lowCompleteness: false,
  reported: false,
  stale: false,
  mediatorVerified: "",
};

function ModerationTable({ onSelect }: { onSelect: (propertyId: number) => void }) {
  const [rows, setRows] = useState<ApiAdminModerationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);

  function load() {
    setLoading(true);
    fetchAdminModerationProperties({
      transactionType: applied.transactionType || undefined,
      city: applied.city || undefined,
      status: applied.status || undefined,
      trustLevel: applied.trustLevel || undefined,
      lowCompleteness: applied.lowCompleteness || undefined,
      reported: applied.reported || undefined,
      stale: applied.stale || undefined,
      mediatorVerified: applied.mediatorVerified === "" ? undefined : applied.mediatorVerified === "true",
      skip,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
      })
      .catch(() => toast.error("Unable to load the moderation queue."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, applied]);

  function applyFilters() {
    setSkip(0);
    setApplied(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setSkip(0);
  }

  const activeCount = Object.entries(applied).filter(([, v]) => (typeof v === "boolean" ? v : v !== "")).length;

  return (
    <Panel
      title="Moderation queue"
      subtitle="Filterable list of every listing's trust/completeness/freshness/report status — click Review to open the full property review page."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Transaction</label>
          <select
            value={draft.transactionType}
            onChange={(e) => setDraft((f) => ({ ...f, transactionType: e.target.value as Filters["transactionType"] }))}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="">All</option>
            <option value="rent">Rent</option>
            <option value="sale">Sale</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">City</label>
          <Input value={draft.city} onChange={(e) => setDraft((f) => ({ ...f, city: e.target.value }))} placeholder="e.g. Riyadh" className="h-9 w-36" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Status</label>
          <select
            value={draft.status}
            onChange={(e) => setDraft((f) => ({ ...f, status: e.target.value }))}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            {PROPERTY_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "Any status"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Trust level</label>
          <select
            value={draft.trustLevel}
            onChange={(e) => setDraft((f) => ({ ...f, trustLevel: e.target.value }))}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            {TRUST_LEVEL_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "Any level"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Mediator verification</label>
          <select
            value={draft.mediatorVerified}
            onChange={(e) => setDraft((f) => ({ ...f, mediatorVerified: e.target.value as Filters["mediatorVerified"] }))}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="">All</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </select>
        </div>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm">
          <input type="checkbox" checked={draft.lowCompleteness} onChange={(e) => setDraft((f) => ({ ...f, lowCompleteness: e.target.checked }))} />
          Low completeness
        </label>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm">
          <input type="checkbox" checked={draft.reported} onChange={(e) => setDraft((f) => ({ ...f, reported: e.target.checked }))} />
          Reported
        </label>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm">
          <input type="checkbox" checked={draft.stale} onChange={(e) => setDraft((f) => ({ ...f, stale: e.target.checked }))} />
          Stale
        </label>
        <Button size="sm" onClick={applyFilters}>
          Apply filters
        </Button>
        {activeCount > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">Property</th>
              <th className="px-3 py-2 text-start">Type</th>
              <th className="px-3 py-2 text-start">Mediator</th>
              <th className="px-3 py-2 text-start">Trust</th>
              <th className="px-3 py-2 text-start">Completeness</th>
              <th className="px-3 py-2 text-start">Freshness</th>
              <th className="px-3 py-2 text-start">Reports</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-start">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="size-6 text-muted-foreground/40" />
                    No listings match these filters.
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.property_id} className="hover:bg-surface/60">
                  <td className="px-3 py-2">
                    <div className="max-w-[220px] truncate font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">
                      #{r.property_id} · {r.area}, {r.city}
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize">{r.transaction_type}</td>
                  <td className="px-3 py-2">
                    {r.mediator_name ? (
                      <span className="inline-flex items-center gap-1">
                        {r.mediator_name}
                        {r.mediator_verified && <ShieldCheck className="size-3.5 text-success" />}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <TrustLevelBadge level={r.trust_level} score={r.trust_score} />
                  </td>
                  <td className="px-3 py-2">{r.completeness_score}%</td>
                  <td className="px-3 py-2 text-xs">{r.freshness_category}</td>
                  <td className="px-3 py-2">
                    {r.open_report_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                        <Flag className="size-3.5" /> {r.open_report_count}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onSelect(r.property_id)}
                      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{total} total</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={skip === 0}
            onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
            className="grid size-7 place-items-center rounded-md border border-border disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span>
            {Math.floor(skip / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            type="button"
            disabled={skip + PAGE_SIZE >= total}
            onClick={() => setSkip((s) => s + PAGE_SIZE)}
            className="grid size-7 place-items-center rounded-md border border-border disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ---------- Property review detail ----------

function ScoreRow({ label, present, score, detail }: { label: string; present: boolean; score?: number; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      <div className="shrink-0 text-sm font-semibold">{present ? `${score}/100` : <span className="text-xs font-normal text-muted-foreground">Not available</span>}</div>
    </div>
  );
}

function ReportRow({ report, onResolved }: { report: ApiPropertyReport; onResolved: (updated: ApiPropertyReport) => void }) {
  const [target, setTarget] = useState<"Under Review" | "Resolved" | "Dismissed">("Under Review");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const active = report.status === "Open" || report.status === "Under Review";

  async function resolve() {
    setBusy(true);
    try {
      const updated = await adminResolveReport(report.id, { status: target, resolution_notes: notes || undefined });
      onResolved({ ...report, status: updated.status, resolved_at: updated.resolved_at, resolved_by: updated.resolved_by, resolution_notes: updated.resolution_notes });
      toast.success(`Report #${report.id} set to ${updated.status}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update report.");
    } finally {
      setBusy(false);
    }
  }

  const statusTone: Record<string, string> = {
    Open: "bg-destructive/10 text-destructive",
    "Under Review": "bg-warning/10 text-warning",
    Resolved: "bg-success/10 text-success",
    Dismissed: "bg-muted text-muted-foreground",
  };

  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{REPORT_REASON_LABELS[report.reason] ?? report.reason}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone[report.status] ?? "bg-muted text-muted-foreground")}>
              {report.status}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Filed {formatDateTime(report.created_at)}
            {report.reporter_user_id ? ` · user #${report.reporter_user_id}` : ""}
          </div>
        </div>
      </div>
      {report.comment && <p className="mt-2 text-sm text-muted-foreground italic">&ldquo;{report.comment}&rdquo;</p>}
      {report.resolution_notes && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold">Resolution notes:</span> {report.resolution_notes}
        </p>
      )}
      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value as typeof target)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
          >
            <option value="Under Review">Under Review</option>
            <option value="Resolved">Resolved</option>
            <option value="Dismissed">Dismissed</option>
          </select>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Resolution notes (optional)"
            className="h-8 flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void resolve()}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <CheckCircle2 className="size-3.5" /> Resolve
          </button>
        </div>
      )}
    </div>
  );
}

function PropertyReviewDetail({ propertyId, onBack }: { propertyId: number; onBack: () => void }) {
  const [detail, setDetail] = useState<ApiAdminPropertyReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideReason, setHideReason] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    fetchAdminPropertyReviewDetail(propertyId)
      .then(setDetail)
      .catch(() => toast.error("Unable to load this property's review detail."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function hide() {
    setBusy(true);
    try {
      await adminHideProperty(propertyId, hideReason || undefined);
      toast.success("Listing hidden.");
      setHideReason("");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to hide listing.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      await adminRestoreProperty(propertyId);
      toast.success("Listing restored.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore listing.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCorrectionRequest() {
    if (!detail) return;
    const suggestions = detail.data_quality.missing_field_suggestions;
    const text = [
      `Hi, could you update your listing "${detail.title}" (#${detail.property_id}) with the following?`,
      ...suggestions.map((s) => `- ${s}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Correction request copied to clipboard.");
    } catch {
      toast.error("Couldn't copy to clipboard — select the text manually.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading property review…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to queue
        </button>
        <p className="text-sm text-destructive">Unable to load this property.</p>
      </div>
    );
  }

  const t = detail.trust;
  const cs = t.component_scores;
  const mediator = detail.mediator;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to queue
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <a href="#reports" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface">
            <Flag className="size-3.5" /> View reports ({detail.reports.length})
          </a>
          {mediator && (
            <Link
              to="/agent/$id"
              params={{ id: String(mediator.id) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <ExternalLink className="size-3.5" /> Review mediator
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCorrectionOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <ClipboardCopy className="size-3.5" /> Request correction
          </button>
          {detail.status === "Hidden" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void restore()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/20 disabled:opacity-50"
            >
              <CheckCircle2 className="size-3.5" /> Restore listing
            </button>
          ) : (
            <ConfirmButton
              label={
                <>
                  <EyeOff className="size-3.5" /> Hide listing
                </>
              }
              confirmLabel="Confirm hide"
              destructive
              disabled={busy}
              onConfirm={() => void hide()}
              extra={
                <input
                  value={hideReason}
                  onChange={(e) => setHideReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="h-7 w-40 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
                />
              }
            />
          )}
        </div>
      </div>

      {correctionOpen && (
        <div className="rounded-xl border border-border bg-surface/60 p-4 text-sm">
          <p className="mb-2 text-xs text-muted-foreground">
            UI-only affordance — no admin correction-request endpoint exists yet (Prompt 6 didn't build one). This composes a message from the missing-field
            suggestions below and copies it to your clipboard to send however your team normally reaches mediators (email/WhatsApp) — nothing is sent or
            persisted automatically.
          </p>
          {detail.data_quality.missing_field_suggestions.length === 0 ? (
            <p className="text-muted-foreground">No missing-field suggestions for this listing.</p>
          ) : (
            <ul className="mb-3 list-disc space-y-1 ps-5 text-muted-foreground">
              {detail.data_quality.missing_field_suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" onClick={() => void copyCorrectionRequest()}>
            <ClipboardCopy className="size-3.5" /> Copy correction request
          </Button>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold tracking-tight">{detail.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="capitalize">{detail.transaction_type}</span>
          <span>·</span>
          <span>
            {detail.area}, {detail.city}
          </span>
          <span>·</span>
          <StatusBadge status={detail.status} />
          <span>·</span>
          <TrustLevelBadge level={t.trust_level} score={t.overall_score} />
        </div>
      </div>

      <Panel title="Trust assessment" subtitle="Deterministic — the exact same assessment the customer-facing Trust Center renders.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ScoreRow label="Listing completeness" present={!!cs.completeness} score={cs.completeness?.score} detail={cs.completeness ? `${cs.completeness.present_fields.length} fields present` : undefined} />
          <ScoreRow label="Listing consistency" present={!!cs.consistency} score={cs.consistency?.score} detail={cs.consistency ? `${cs.consistency.issues.length} issue(s)` : undefined} />
          <ScoreRow label="Mediator trust" present={!!cs.mediator_trust} score={cs.mediator_trust?.score} detail={cs.mediator_trust?.reason} />
          <ScoreRow label="Listing freshness" present={!!cs.freshness} score={cs.freshness?.score} detail={cs.freshness?.category} />
          <ScoreRow label="Marketplace confidence" present={!!cs.marketplace_confidence} score={cs.marketplace_confidence?.score} detail={cs.marketplace_confidence?.reason} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Positive signals</h3>
            <ul className="space-y-1 text-sm">
              {t.positive_signals.length === 0 && <li className="text-muted-foreground">None</li>}
              {t.positive_signals.map((s) => (
                <li key={s} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Missing information</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {t.missing_information.length === 0 && <li>None</li>}
              {t.missing_information.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Things to verify</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {t.things_to_verify.length === 0 && <li>None</li>}
              {t.things_to_verify.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="Data quality" subtitle="The identical completeness + image-quality view the partner sees on their own Listing Quality panel.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completeness by tier</h3>
            <div className="space-y-1.5">
              {Object.entries(detail.data_quality.completeness.tier_breakdown).map(([tier, b]) => (
                <div key={tier} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{tier}</span>
                  <span className="font-medium">
                    {b.present}/{b.total}
                  </span>
                </div>
              ))}
            </div>
            {detail.data_quality.missing_field_suggestions.length > 0 && (
              <>
                <h3 className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Suggestions</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {detail.data_quality.missing_field_suggestions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Image quality ({detail.data_quality.image_quality.image_count} images)
            </h3>
            {detail.data_quality.image_quality.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No issues found.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.data_quality.image_quality.issues.map((iss) => (
                  <li key={iss.code} className={cn(iss.severity === "blocking" ? "text-destructive" : iss.severity === "warning" ? "text-warning" : "text-muted-foreground")}>
                    {iss.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel title="Mediator" subtitle="Reuses the same public trust profile shown on the mediator's public listing page.">
        {mediator ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{mediator.agency_name ?? `Mediator #${mediator.id}`}</span>
                {mediator.verification_label && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                    <ShieldCheck className="size-3" /> {mediator.verification_label}
                  </span>
                )}
                {detail.mediator_approval_status && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground capitalize">
                    Portal: {detail.mediator_approval_status}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {mediator.avg_rating != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star className="size-3.5 fill-warning text-warning" /> {mediator.avg_rating.toFixed(1)} ({mediator.review_count})
                  </span>
                )}
                <span>{mediator.active_listing_count} active listings</span>
                <span>
                  {mediator.rental_listing_count} rent / {mediator.sale_listing_count} sale
                </span>
                {mediator.member_since && <span>Member since {formatDateTime(mediator.member_since)}</span>}
                {mediator.response_rate != null && <span>{Math.round(mediator.response_rate * 100)}% response rate</span>}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No mediator on record for this listing.</p>
        )}
      </Panel>

      <Panel title="Reports" subtitle="Every report ever filed against this listing." id="reports">
        {detail.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports filed.</p>
        ) : (
          <div className="space-y-3">
            {detail.reports.map((r) => (
              <ReportRow
                key={r.id}
                report={r}
                onResolved={(updated) =>
                  setDetail((prev) => (prev ? { ...prev, reports: prev.reports.map((x) => (x.id === updated.id ? updated : x)) } : prev))
                }
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Property intelligence" subtitle="Reused from the customer-facing myMakan Intelligence assembly — not recomputed here.">
        {detail.property_intelligence ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <span className="text-sm font-semibold">Decision score: {detail.property_intelligence.decision_score}/100</span>
            </div>
            {detail.property_intelligence.strengths.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Strengths</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {detail.property_intelligence.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {detail.property_intelligence.considerations.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Considerations</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {detail.property_intelligence.considerations.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not available — either the Property Intelligence feature flag is off, or there wasn't enough data to assemble it. This never blocks the rest of
            the review.
          </p>
        )}
      </Panel>

      <Panel title="Moderation history" subtitle="Audit log entries for this property and any reports filed against it.">
        {detail.moderation_history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No moderation history yet.</p>
        ) : (
          <div className="space-y-2">
            {detail.moderation_history.map((h) => (
              <div key={h.id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 text-sm last:border-0 last:pb-0">
                <div>
                  <span className="font-medium">{h.action}</span>
                  <span className="ms-1.5 text-xs text-muted-foreground">
                    ({h.entity_type} #{h.entity_id})
                  </span>
                  {h.user_id != null && <span className="ms-1.5 text-xs text-muted-foreground">by admin #{h.user_id}</span>}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(h.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Page ----------

function AdminTrustModerationPage() {
  const { user, authLoading, setAuth } = useAuth();
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!user || !user.is_admin) {
    return <AdminTrustModerationLoginGate nonAdminUser={!!user && !user.is_admin} onAuth={(u, token) => setAuth(u, token)} />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h1 className="text-lg font-bold">Trust & Moderation</h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {selectedPropertyId == null ? (
          <>
            <DashboardCards />
            <ModerationTable onSelect={setSelectedPropertyId} />
          </>
        ) : (
          <PropertyReviewDetail propertyId={selectedPropertyId} onBack={() => setSelectedPropertyId(null)} />
        )}
      </main>
    </div>
  );
}
