import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, FileCheck2, Inbox, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchAdminTransaction,
  fetchAdminTransactions,
  login,
  type ApiAdminTransaction,
  type ApiAdminTransactionDetail,
  type AuthUser,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { formatSAR } from "@/lib/maskan-data";
import { cn } from "@/lib/utils";

// Admin web: minimal read-only Transactions list + detail (Prompt 13). See
// docs/implementation/mymakan-transaction-workspace.md "APIs" → "Admin
// (Prompt 7)" for the two backend endpoints this wires to. Self-contained
// (no imports from routes/admin.tsx, no i18n — every other admin_.*.tsx flat
// file follows the same plain-English-strings convention), mirrors
// admin_.property-requests.tsx's login gate/Panel primitives exactly. No
// mutation actions anywhere on this page — the backend router itself has
// none (see admin_transactions.py's own "Known limitations" note).
export const Route = createFileRoute("/admin_/transactions")({
  head: () => ({ meta: [{ title: "Transactions — myMakan Admin" }] }),
  component: AdminTransactionsPage,
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

// ---------- Small local admin auth guard (mirrors admin_.property-requests.tsx) ----------

function AdminTransactionsLoginGate({
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
            <h1 className="text-2xl font-bold">Transactions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {nonAdminUser
                ? "Your current account does not have admin access. Sign in with an admin account."
                : "Sign in with an admin account to continue"}
            </p>
          </div>
        </div>
        <form className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card" onSubmit={handleSubmit}>
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

// ---------- Small local Panel primitive (deliberately not shared with analytics.tsx) ----------

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <header className="mb-4">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

const STATUS_OPTIONS = [
  "",
  "initiated",
  "information_required",
  "documents_required",
  "under_review",
  "ready_for_next_step",
  "external_process_pending",
  "completed",
  "cancelled",
];

const STATUS_TONE: Record<string, string> = {
  initiated: "bg-info/10 text-info",
  information_required: "bg-warning/10 text-warning",
  documents_required: "bg-warning/10 text-warning",
  under_review: "bg-info/10 text-info",
  ready_for_next_step: "bg-success/10 text-success",
  external_process_pending: "bg-success/10 text-success",
  completed: "bg-success/10 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function TransactionsTable({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<ApiAdminTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState("");
  const [transactionType, setTransactionType] = useState<"" | "rent" | "sale">("");
  const [mediatorId, setMediatorId] = useState("");
  const [customerUserId, setCustomerUserId] = useState("");
  const [sort, setSort] = useState<"created_at" | "updated_at" | "progress_percentage">("updated_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  function load() {
    setLoading(true);
    fetchAdminTransactions({
      status: status || undefined,
      transactionType: transactionType || undefined,
      mediatorId: mediatorId ? Number(mediatorId) : undefined,
      customerUserId: customerUserId ? Number(customerUserId) : undefined,
      sort,
      order,
      skip,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
      })
      .catch(() => toast.error("Unable to load transactions."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, sort, order]);

  function applyFilters() {
    setSkip(0);
    if (skip === 0) load();
  }

  return (
    <Panel title="All transactions" subtitle="Every rent/buy transaction workspace, read-only.">
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
                {s ? s.replace(/_/g, " ") : "Any status"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Type</label>
          <select
            value={transactionType}
            onChange={(e) => setTransactionType(e.target.value as "" | "rent" | "sale")}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="">Any type</option>
            <option value="rent">Rent</option>
            <option value="sale">Sale</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Mediator ID</label>
          <Input value={mediatorId} onChange={(e) => setMediatorId(e.target.value)} placeholder="e.g. 3" className="h-9 w-28" inputMode="numeric" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Customer ID</label>
          <Input value={customerUserId} onChange={(e) => setCustomerUserId(e.target.value)} placeholder="e.g. 42" className="h-9 w-28" inputMode="numeric" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Sort</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="updated_at">Last activity</option>
            <option value="created_at">Created</option>
            <option value="progress_percentage">Progress</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Order</label>
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as typeof order)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
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
              <th className="px-3 py-2 text-start">Reference</th>
              <th className="px-3 py-2 text-start">Type</th>
              <th className="px-3 py-2 text-start">Property</th>
              <th className="px-3 py-2 text-start">Customer</th>
              <th className="px-3 py-2 text-start">Mediator</th>
              <th className="px-3 py-2 text-start">Amount</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-start">Progress</th>
              <th className="px-3 py-2 text-start">Created</th>
              <th className="px-3 py-2 text-start">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="size-6 text-muted-foreground/40" />
                    No transactions match these filters.
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((tx) => (
                <tr key={tx.id} onClick={() => onOpen(tx.id)} className="cursor-pointer hover:bg-surface/60">
                  <td className="px-3 py-2 font-mono text-xs">{tx.reference}</td>
                  <td className="px-3 py-2 capitalize">{tx.transaction_type}</td>
                  <td className="px-3 py-2">{tx.property_title ?? `#${tx.property_id}`}</td>
                  <td className="px-3 py-2">
                    {tx.customer_name ?? "—"}
                    {tx.customer_email && <div className="text-[11px] text-muted-foreground">{tx.customer_email}</div>}
                  </td>
                  <td className="px-3 py-2">{tx.mediator_agent_name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">SAR {formatSAR(Math.round(Number(tx.agreed_amount)))}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={tx.status} />
                  </td>
                  <td className="px-3 py-2">{tx.progress_percentage}%</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{formatDateTime(tx.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{formatDateTime(tx.updated_at)}</td>
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

const CHECKLIST_STATUS_TONE: Record<string, string> = {
  done: "bg-success/10 text-success",
  in_progress: "bg-warning/10 text-warning",
  pending: "bg-muted text-muted-foreground",
};

const DOCUMENT_STATUS_TONE: Record<string, string> = {
  not_uploaded: "bg-muted text-muted-foreground",
  uploaded: "bg-info/10 text-info",
  accepted: "bg-success/10 text-success",
  needs_update: "bg-warning/10 text-warning",
};

// Detail view (checklist, document statuses, timeline, participants,
// negotiation reference) — no ownership check needed here (unlike customer/
// partner), and no mutation actions of any kind, mirroring the backend
// router's own read-only-by-design scope exactly.
function TransactionDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const [detail, setDetail] = useState<ApiAdminTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchAdminTransaction(id)
      .then(setDetail)
      .catch(() => setError("Unable to load this transaction."))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to all transactions
      </button>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error || !detail ? (
        <p className="text-sm text-destructive">{error ?? "Transaction not found."}</p>
      ) : (
        <>
          <Panel title={`${detail.reference} — ${detail.property_title ?? `#${detail.property_id}`}`}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-muted-foreground">Type</div>
                <div className="text-sm font-medium capitalize">{detail.transaction_type}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Status</div>
                <StatusPill status={detail.status} />
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Agreed amount</div>
                <div className="text-sm font-medium">SAR {formatSAR(Math.round(Number(detail.agreed_amount)))}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Progress</div>
                <div className="text-sm font-medium">{detail.progress_percentage}%</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Customer</div>
                <div className="text-sm font-medium">{detail.customer_name ?? "—"}</div>
                {detail.customer_email && <div className="text-[11px] text-muted-foreground">{detail.customer_email}</div>}
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Mediator</div>
                <div className="text-sm font-medium">{detail.mediator_agent_name ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Negotiation reference</div>
                <div className="text-sm font-medium">{detail.terms_snapshot?.negotiation_reference ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground">Readiness</div>
                <div className="text-sm font-medium">{detail.readiness_label}</div>
              </div>
            </div>
          </Panel>

          <Panel title="Checklist">
            <ul className="space-y-2">
              {detail.checklist.map((step) => (
                <li key={step.key} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="text-sm font-medium">{step.label}</span>
                  <div className="flex items-center gap-2">
                    {step.detail && <span className="text-xs text-muted-foreground">{step.detail}</span>}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", CHECKLIST_STATUS_TONE[step.status] ?? "bg-muted text-muted-foreground")}>
                      {step.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Documents">
            {detail.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents seeded.</p>
            ) : (
              <ul className="space-y-2">
                {detail.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{doc.label}</span>
                      <span className="ms-2 text-[11px] text-muted-foreground">{doc.required ? "Required" : "Optional"}</span>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", DOCUMENT_STATUS_TONE[doc.status] ?? "bg-muted text-muted-foreground")}>
                      {doc.status.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Timeline">
            {detail.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded.</p>
            ) : (
              <ul className="space-y-2">
                {detail.timeline.map((ev, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0">
                    <span className="font-mono text-xs text-muted-foreground">{ev.event_type}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(ev.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function AdminTransactionsPage() {
  const { user, authLoading, setAuth } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!user || !user.is_admin) {
    return <AdminTransactionsLoginGate nonAdminUser={!!user && !user.is_admin} onAuth={(u, token) => setAuth(u, token)} />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <FileCheck2 className="size-5 text-primary" />
          <h1 className="text-lg font-bold">Transactions</h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {selectedId != null ? (
          <TransactionDetailView id={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <TransactionsTable onOpen={setSelectedId} />
        )}
      </main>
    </div>
  );
}
