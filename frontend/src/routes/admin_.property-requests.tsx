import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Inbox, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminClosePropertyRequest,
  adminPausePropertyRequest,
  adminRetryPropertyRequestMatching,
  fetchAdminPropertyRequestAnalytics,
  fetchAdminPropertyRequests,
  login,
  type ApiAdminPropertyRequest,
  type ApiPropertyRequestAnalytics,
  type AuthUser,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// Self-contained (no imports from routes/admin.tsx) so it stays code-splittable
// via createLazyFileRoute later, mirroring routes/admin_.notifications.tsx's
// same rationale — it duplicates that file's small admin-auth-guard and
// KpiCard/Panel/ConfirmButton primitives rather than sharing code across the
// two large admin route files.
export const Route = createFileRoute("/admin_/property-requests")({
  head: () => ({ meta: [{ title: "Property Requests — myMakan Admin" }] }),
  component: AdminPropertyRequestsPage,
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

function pct(ratio: number): string {
  return `${Math.round(ratio * (ratio <= 1 ? 100 : 1))}%`;
}

// ---------- Small local admin auth guard (mirrors admin_.notifications.tsx) ----------

function AdminPropertyRequestsLoginGate({
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
            <h1 className="text-2xl font-bold">Property Requests</h1>
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

// ---------- Small local Kpi/Panel primitives (deliberately not shared with analytics.tsx) ----------

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
          tone === "danger"
            ? "text-destructive"
            : tone === "warning"
              ? "text-warning"
              : "text-foreground",
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
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
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
}: {
  label: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
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
        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        destructive
          ? "border-destructive/40 text-destructive hover:bg-destructive/10"
          : "border-border text-foreground hover:bg-surface",
      )}
    >
      {label}
    </button>
  );
}

function AnalyticsSummary() {
  const [data, setData] = useState<ApiPropertyRequestAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchAdminPropertyRequestAnalytics()
      .then(setData)
      .catch(() => setError("Unable to load analytics."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading analytics…</p>;
  if (error || !data)
    return <p className="text-sm text-destructive">{error ?? "Unable to load analytics."}</p>;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Total requests" value={String(data.total_requests)} />
      <KpiCard label="Active requests" value={String(data.active_requests)} />
      <KpiCard
        label="No-match rate"
        value={pct(data.no_match_rate)}
        tone={data.no_match_rate > 0.3 ? "warning" : undefined}
      />
      <KpiCard label="Fulfillment rate" value={pct(data.fulfillment_rate)} />
      <KpiCard label="Match → save rate" value={pct(data.match_to_save_rate)} />
      <KpiCard label="Match → contact rate" value={pct(data.match_to_contact_rate)} />
      <KpiCard label="Mediator response rate" value={pct(data.mediator_response_rate)} />
      <KpiCard
        label="Expiry rate"
        value={pct(data.expiry_rate)}
        tone={data.expiry_rate > 0.3 ? "warning" : undefined}
      />
      <KpiCard
        label="Avg. time to first match"
        value={
          data.avg_time_to_first_match_hours != null
            ? `${data.avg_time_to_first_match_hours.toFixed(1)}h`
            : "—"
        }
      />
    </div>
  );
}

const STATUS_OPTIONS = [
  "",
  "draft",
  "awaiting_clarification",
  "active",
  "paused",
  "matched",
  "negotiating",
  "fulfilled",
  "expired",
  "closed",
  "cancelled",
];

function RequestsTable() {
  const [rows, setRows] = useState<ApiAdminPropertyRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState("");
  const [city, setCity] = useState("");
  const [userId, setUserId] = useState("");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  function load() {
    setLoading(true);
    fetchAdminPropertyRequests({
      status: status || undefined,
      city: city || undefined,
      userId: userId ? Number(userId) : undefined,
      skip,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
      })
      .catch(() => toast.error("Unable to load property requests."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  function applyFilters() {
    setSkip(0);
    if (skip === 0) load();
  }

  async function withBusy(id: number, fn: () => Promise<void>) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handlePause(id: number) {
    await withBusy(id, async () => {
      const updated = await adminPausePropertyRequest(id);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success(`Request #${id} paused.`);
    });
  }

  async function handleClose(id: number) {
    await withBusy(id, async () => {
      const updated = await adminClosePropertyRequest(id);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success(`Request #${id} closed.`);
    });
  }

  async function handleRetry(id: number) {
    await withBusy(id, async () => {
      await adminRetryPropertyRequestMatching(id);
      toast.success(`Matching re-queued for request #${id}.`);
    });
  }

  const statusTone: Record<string, string> = {
    active: "bg-success/10 text-success",
    matched: "bg-success/10 text-success",
    negotiating: "bg-info/10 text-info",
    draft: "bg-muted text-muted-foreground",
    awaiting_clarification: "bg-info/10 text-info",
    paused: "bg-warning/10 text-warning",
    fulfilled: "bg-primary/10 text-primary",
    expired: "bg-muted text-muted-foreground",
    closed: "bg-muted text-muted-foreground",
    cancelled: "bg-muted text-muted-foreground",
  };

  return (
    <Panel
      title="All property requests"
      subtitle="Search, moderate, pause, close, or retry matching for any customer's property request."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "Any status"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">City</label>
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Riyadh"
            className="h-9 w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">User ID</label>
          <Input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="e.g. 42"
            className="h-9 w-28"
            inputMode="numeric"
          />
        </div>
        <Button size="sm" onClick={applyFilters}>
          Apply filters
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">ID</th>
              <th className="px-3 py-2 text-start">User</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-start">City</th>
              <th className="px-3 py-2 text-start">Transaction</th>
              <th className="px-3 py-2 text-start">Budget</th>
              <th className="px-3 py-2 text-start">Matches</th>
              <th className="px-3 py-2 text-start">Mediator resp.</th>
              <th className="px-3 py-2 text-start">Created</th>
              <th className="px-3 py-2 text-start">Expiry</th>
              <th className="px-3 py-2 text-start">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="size-6 text-muted-foreground/40" />
                    No property requests match these filters.
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const busy = busyIds.has(r.id);
                const isTerminal = ["fulfilled", "expired", "closed", "cancelled"].includes(
                  r.status,
                );
                return (
                  <tr key={r.id} className="hover:bg-surface/60">
                    <td className="px-3 py-2 font-mono text-xs">#{r.id}</td>
                    <td className="px-3 py-2">{r.user_id}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          statusTone[r.status] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.city ?? "—"}</td>
                    <td className="px-3 py-2">{r.transaction_type ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.min_price || r.max_price
                        ? `${r.min_price ?? "0"}–${r.max_price ?? "∞"} SAR`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{r.match_count}</td>
                    <td className="px-3 py-2">{r.mediator_response_count}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {formatDateTime(r.expiry_date)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {!isTerminal && r.status !== "paused" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handlePause(r.id)}
                            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface disabled:opacity-40"
                          >
                            Pause
                          </button>
                        )}
                        {!isTerminal && (
                          <ConfirmButton
                            label="Close"
                            confirmLabel="Confirm close"
                            destructive
                            disabled={busy}
                            onConfirm={() => void handleClose(r.id)}
                          />
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRetry(r.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface disabled:opacity-40"
                        >
                          <RefreshCw className="size-3" /> Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
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

function AdminPropertyRequestsPage() {
  const { user, authLoading, setAuth } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!user || !user.is_admin) {
    return (
      <AdminPropertyRequestsLoginGate
        nonAdminUser={!!user && !user.is_admin}
        onAuth={(u, token) => setAuth(u, token)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <Activity className="size-5 text-primary" />
          <h1 className="text-lg font-bold">Property Requests</h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <AnalyticsSummary />
        <RequestsTable />
      </main>
    </div>
  );
}
