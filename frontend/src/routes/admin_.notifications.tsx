import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Inbox,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  disableAdminDevice,
  fetchAdminDevices,
  fetchNotificationAdminOverview,
  fetchNotificationDeliveries,
  login,
  rerunUserDigest,
  retryNotificationDelivery,
  sendAdminTestNotification,
  type ApiDevice,
  type ApiNotificationAdminOverview,
  type ApiNotificationDelivery,
  type AuthUser,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// This route is intentionally self-contained (no imports from routes/admin.tsx
// beyond nothing at all) so it's structured to be code-split later via
// createLazyFileRoute without dragging the rest of the admin console's
// listings/mediators/leads/users/reviews bundle along with it. It duplicates
// the small admin-auth-guard pattern from admin.tsx rather than sharing code
// across the two large route files.
export const Route = createFileRoute("/admin_/notifications")({
  head: () => ({
    meta: [{ title: "Notification Operations — myMakan Admin" }],
  }),
  component: AdminNotificationsPage,
});

const PAGE_SIZE = 20;
const BACKLOG_WARNING_THRESHOLD = 50;

type Tab = "overview" | "deliveries" | "devices" | "actions";

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------- Small local admin auth guard (mirrors admin.tsx's ~5-line check + login form) ----------

function AdminNotificationsLoginGate({
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
  const [showPassword, setShowPassword] = useState(false);

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
            <h1 className="text-2xl font-bold">Notification Operations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {nonAdminUser
                ? "Your current account does not have admin access. Sign in with an admin account."
                : "Sign in with an admin account to continue"}
            </p>
          </div>
        </div>
        {nonAdminUser && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <ShieldAlert className="size-4 shrink-0" />
            Current session has no admin privileges.
          </div>
        )}
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
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="h-11 w-full rounded-lg border border-border bg-background pe-10 ps-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute end-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
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

// ---------- Tabs ----------

const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "deliveries", label: "Delivery health", icon: Send },
  { key: "devices", label: "Devices", icon: Smartphone },
  { key: "actions", label: "Operational actions", icon: ShieldCheck },
];

function OverviewTab() {
  const [data, setData] = useState<ApiNotificationAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchNotificationAdminOverview()
      .then(setData)
      .catch(() => setError("Unable to load the overview."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading overview…</p>;
  if (error || !data)
    return <p className="text-sm text-destructive">{error ?? "Unable to load the overview."}</p>;

  const pushAcceptRate = pct(data.push_accepted, data.push_attempted);
  const openRatePct = Math.round(
    data.notification_open_rate * (data.notification_open_rate <= 1 ? 100 : 1),
  );
  const digestFailureRatePct = pct(data.digest_failures, data.digest_volume);
  const backlogWarning = data.queue_backlog > BACKLOG_WARNING_THRESHOLD;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-surface px-4 py-2 text-xs text-muted-foreground">
        Window: {data.window}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Notifications created" value={String(data.notifications_created)} />
        <KpiCard
          label="Notifications opened"
          value={String(data.notifications_opened)}
          sub={`Open rate ${openRatePct}%`}
        />
        <KpiCard label="Open rate" value={`${openRatePct}%`} />
        <KpiCard label="Active devices" value={String(data.active_devices)} />
        <KpiCard label="Push attempted" value={String(data.push_attempted)} />
        <KpiCard
          label="Push accepted"
          value={String(data.push_accepted)}
          sub={`Accept rate ${pushAcceptRate}`}
        />
        <KpiCard
          label="Push failed"
          value={String(data.push_failed)}
          tone={data.push_failed > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Invalid tokens"
          value={String(data.push_invalid_tokens)}
          tone={data.push_invalid_tokens > 0 ? "warning" : undefined}
        />
        <KpiCard label="Digest volume" value={String(data.digest_volume)} />
        <KpiCard
          label="Digest failures"
          value={String(data.digest_failures)}
          sub={`Failure rate ${digestFailureRatePct}`}
          tone={data.digest_failures > 0 ? "warning" : undefined}
        />
        <KpiCard
          label="Queue backlog"
          value={String(data.queue_backlog)}
          tone={backlogWarning ? "danger" : undefined}
          sub={
            backlogWarning ? `Above warning threshold (${BACKLOG_WARNING_THRESHOLD})` : undefined
          }
        />
        <KpiCard label="Lead notification volume" value={String(data.lead_notification_volume)} />
      </div>
      {backlogWarning && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          Queue backlog ({data.queue_backlog}) is above the warning threshold of{" "}
          {BACKLOG_WARNING_THRESHOLD}. Deliveries may be delayed.
        </div>
      )}
    </div>
  );
}

const DELIVERY_STATUSES = [
  "",
  "queued",
  "sent",
  "accepted",
  "delivered",
  "opened",
  "failed",
  "invalid_token",
];
const DELIVERY_CHANNELS = ["", "push", "email", "in_app"];

function DeliveriesTab() {
  const [rows, setRows] = useState<ApiNotificationDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [notificationId, setNotificationId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());

  function load() {
    setLoading(true);
    fetchNotificationDeliveries({
      notification_id: notificationId ? Number(notificationId) : undefined,
      device_id: deviceId ? Number(deviceId) : undefined,
      status: status || undefined,
      channel: channel || undefined,
      skip,
      limit: PAGE_SIZE,
    })
      .then(setRows)
      .catch(() => toast.error("Unable to load deliveries."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  function applyFilters() {
    setSkip(0);
    // load() re-runs via the skip effect only when skip actually changes;
    // when filters change at skip=0 already, trigger a fresh fetch directly.
    if (skip === 0) load();
  }

  async function handleRetry(id: number) {
    setRetryingIds((prev) => new Set(prev).add(id));
    try {
      await retryNotificationDelivery(id);
      toast.success(`Delivery #${id} re-enqueued.`);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "queued" } : r)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const statusTone: Record<string, string> = {
    delivered: "bg-success/10 text-success",
    opened: "bg-success/10 text-success",
    accepted: "bg-info/10 text-info",
    sent: "bg-info/10 text-info",
    queued: "bg-muted text-muted-foreground",
    failed: "bg-destructive/10 text-destructive",
    invalid_token: "bg-destructive/10 text-destructive",
  };

  return (
    <Panel
      title="Delivery health"
      subtitle="Search and retry notification deliveries across channels."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Notification ID</label>
          <Input
            value={notificationId}
            onChange={(e) => setNotificationId(e.target.value)}
            placeholder="e.g. 1024"
            className="h-9 w-36"
            inputMode="numeric"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Device ID</label>
          <Input
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            placeholder="e.g. 42"
            className="h-9 w-32"
            inputMode="numeric"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || "Any status"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            {DELIVERY_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c || "Any channel"}
              </option>
            ))}
          </select>
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
              <th className="px-3 py-2 text-start">Notification</th>
              <th className="px-3 py-2 text-start">Device</th>
              <th className="px-3 py-2 text-start">Channel</th>
              <th className="px-3 py-2 text-start">Provider</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-start">Failure</th>
              <th className="px-3 py-2 text-start">Attempted at</th>
              <th className="px-3 py-2 text-start">Action</th>
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
                    No deliveries match these filters.
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface/60">
                  <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.notification_id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.device_id ?? "—"}</td>
                  <td className="px-3 py-2">{row.channel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.provider ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        statusTone[row.status] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td
                    className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground"
                    title={row.failure_message ?? undefined}
                  >
                    {row.failure_code
                      ? `${row.failure_code}${row.failure_message ? `: ${row.failure_message}` : ""}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(row.attempted_at)}
                  </td>
                  <td className="px-3 py-2">
                    {(row.status === "failed" || row.status === "invalid_token") &&
                    row.channel === "push" ? (
                      <ConfirmButton
                        label={
                          retryingIds.has(row.id) ? (
                            "Retrying…"
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <RefreshCw className="size-3" /> Retry
                            </span>
                          )
                        }
                        confirmLabel="Retry now"
                        disabled={retryingIds.has(row.id)}
                        onConfirm={() => void handleRetry(row.id)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing {rows.length === 0 ? 0 : skip + 1}–{skip + rows.length}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={skip === 0}
            onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setSkip((s) => s + PAGE_SIZE)}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}

const DEVICE_PLATFORMS = ["", "ios", "android", "web"];

function DevicesTab() {
  const [rows, setRows] = useState<
    Array<ApiDevice & { user_id: number; user_email: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [platform, setPlatform] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [disablingIds, setDisablingIds] = useState<Set<number>>(new Set());

  function load() {
    setLoading(true);
    fetchAdminDevices({
      platform: platform || undefined,
      enabled: enabledFilter === "" ? undefined : enabledFilter === "true",
      skip,
      limit: PAGE_SIZE,
    })
      .then(setRows)
      .catch(() => toast.error("Unable to load devices."))
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

  async function handleDisable(id: number) {
    setDisablingIds((prev) => new Set(prev).add(id));
    try {
      await disableAdminDevice(id);
      toast.success(`Device #${id} disabled.`);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: false } : r)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disable this device.");
    } finally {
      setDisablingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const platformCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.platform] = (acc[r.platform] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Panel title="Device health" subtitle="Registered push devices across platforms.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {Object.entries(platformCounts).map(([p, count]) => (
          <span
            key={p}
            className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
          >
            {p}: {count}
          </span>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Platform</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            {DEVICE_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p || "Any platform"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Enabled</label>
          <select
            value={enabledFilter}
            onChange={(e) => setEnabledFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="">Any</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
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
              <th className="px-3 py-2 text-start">Platform</th>
              <th className="px-3 py-2 text-start">User</th>
              <th className="px-3 py-2 text-start">App / OS</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-start">Failures</th>
              <th className="px-3 py-2 text-start">Last active</th>
              <th className="px-3 py-2 text-start">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No devices match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface/60">
                  <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
                  <td className="px-3 py-2">{row.platform}</td>
                  <td className="px-3 py-2 text-xs">{row.user_email ?? `user #${row.user_id}`}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.app_version ?? "—"} / {row.os_version ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.enabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                        <CheckCircle2 className="size-3" /> Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        <XCircle className="size-3" /> Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{row.failure_count}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDateTime(row.last_active_at)}
                  </td>
                  <td className="px-3 py-2">
                    {row.enabled ? (
                      <ConfirmButton
                        label={
                          <span className="inline-flex items-center gap-1">
                            <Ban className="size-3" /> Disable
                          </span>
                        }
                        confirmLabel="Disable now"
                        destructive
                        disabled={disablingIds.has(row.id)}
                        onConfirm={() => void handleDisable(row.id)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing {rows.length === 0 ? 0 : skip + 1}–{skip + rows.length}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={skip === 0}
            onClick={() => setSkip((s) => Math.max(0, s - PAGE_SIZE))}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length < PAGE_SIZE}
            onClick={() => setSkip((s) => s + PAGE_SIZE)}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ActionsTab() {
  const [digestUserId, setDigestUserId] = useState("");
  const [digestPeriod, setDigestPeriod] = useState<"daily" | "weekly">("daily");
  const [digestRunning, setDigestRunning] = useState(false);

  const [testUserId, setTestUserId] = useState("");
  const [testSending, setTestSending] = useState(false);

  async function handleRerunDigest() {
    const userId = Number(digestUserId);
    if (!userId) return;
    setDigestRunning(true);
    try {
      const res = await rerunUserDigest(userId, digestPeriod);
      toast.success(
        `Digest re-run for user #${res.user_id}: ${res.matches_included} match(es) included.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't re-run this digest.");
    } finally {
      setDigestRunning(false);
    }
  }

  async function handleTestSend() {
    const userId = Number(testUserId);
    if (!userId) return;
    setTestSending(true);
    try {
      const res = await sendAdminTestNotification(userId);
      if (res.sent) toast.success(`Test notification sent to user #${userId}.`);
      else toast.error("The test notification was not sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the test notification.");
    } finally {
      setTestSending(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Panel
        title="Force-rerun a digest"
        subtitle="Runs one user's daily or weekly digest immediately. This sends real notifications and is audit-logged."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">User ID</label>
            <Input
              value={digestUserId}
              onChange={(e) => setDigestUserId(e.target.value)}
              placeholder="e.g. 128"
              inputMode="numeric"
              className="h-9 w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Period</label>
            <select
              value={digestPeriod}
              onChange={(e) => setDigestPeriod(e.target.value as "daily" | "weekly")}
              className="h-9 w-40 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <ConfirmButton
            label={digestRunning ? "Running…" : "Rerun digest"}
            confirmLabel="Yes, send now"
            disabled={!digestUserId || digestRunning}
            onConfirm={() => void handleRerunDigest()}
          />
        </div>
      </Panel>

      <Panel
        title="Send test notification"
        subtitle="Sends a real test notification to one internal account. This sends a real push/notification and is audit-logged."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">User ID</label>
            <Input
              value={testUserId}
              onChange={(e) => setTestUserId(e.target.value)}
              placeholder="e.g. 128"
              inputMode="numeric"
              className="h-9 w-40"
            />
          </div>
          <ConfirmButton
            label={
              <span className="inline-flex items-center gap-1">
                <Send className="size-3" /> {testSending ? "Sending…" : "Send test notification"}
              </span>
            }
            confirmLabel="Yes, send now"
            disabled={!testUserId || testSending}
            onConfirm={() => void handleTestSend()}
          />
        </div>
      </Panel>
    </div>
  );
}

function AdminNotificationsPage() {
  const { user, authLoading, setAuth } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!user || !user.is_admin) {
    return <AdminNotificationsLoginGate onAuth={setAuth} nonAdminUser={user !== null} />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/admin"
              className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Bell className="size-4.5 text-primary" /> Notification Operations
              </h1>
              <p className="text-xs text-muted-foreground">
                Delivery health, device status and operational controls.
              </p>
            </div>
          </div>
        </div>
      </header>

      <nav className="border-b border-border bg-background px-6">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {tab === "overview" && <OverviewTab />}
        {tab === "deliveries" && <DeliveriesTab />}
        {tab === "devices" && <DevicesTab />}
        {tab === "actions" && <ActionsTab />}
      </main>
    </div>
  );
}
