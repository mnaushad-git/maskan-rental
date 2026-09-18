import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FileCheck2, MapPin, RefreshCw } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { fetchMyTransactions, type ApiPropertyTransaction } from "@/lib/api/maskan";
import { readinessText, statusTone, nbaText } from "@/lib/transactionWorkspace";

export const Route = createFileRoute("/my-transactions")({
  head: () => ({ meta: [{ title: "My Transactions — myMakan" }] }),
  component: MyTransactionsPage,
});

type TabKey = "active" | "completed" | "cancelled";
const TABS: TabKey[] = ["active", "completed", "cancelled"];

// Bucketing mirrors the backend's own `?status=` filter definition exactly
// (see backend/app/api/routes/transactions.py: "active" = everything not
// completed/cancelled) — done client-side here (single unfiltered fetch) so
// per-tab counts don't need three separate requests, same convention
// negotiations.tsx already uses for its own 3-tab bucketing.
function bucketFor(status: string): TabKey {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "active";
}

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MyTransactionsPage() {
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiPropertyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("active");

  function load() {
    setLoading(true);
    setError(false);
    fetchMyTransactions()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    load();
  }, [user, authLoading]);

  const filtered = useMemo(() => items.filter((tx) => bucketFor(tx.status) === tab), [items, tab]);

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { active: 0, completed: 0, cancelled: 0 };
    for (const tx of items) counts[bucketFor(tx.status)]++;
    return counts;
  }, [items]);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("myTransactions.heading")}</h1>
        {user && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t(items.length === 1 ? "myTransactions.subtitleSingular" : "myTransactions.subtitlePlural", {
              count: items.length,
            })}
          </p>
        )}

        {user && (
          <div className="mt-6 flex flex-wrap gap-2 border-b border-border pb-px">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`myTransactions.tabs.${key}`)}
                {tabCounts[key] > 0 && <span className="ms-1.5 text-xs text-muted-foreground">({tabCounts[key]})</span>}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : !user ? (
            <EmptyState
              icon={FileCheck2}
              title={t("myTransactions.signInToView")}
              action={<Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>}
            />
          ) : error ? (
            <EmptyState
              icon={FileCheck2}
              title={t("myTransactions.loadError")}
              action={
                <Button variant="outline" onClick={load}>
                  <RefreshCw className="size-4" /> {t("myTransactions.retry")}
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              title={t(`myTransactions.empty.${tab}`)}
              action={
                <Link to="/search">
                  <Button>{t("myTransactions.empty.cta")}</Button>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((tx) => (
                <TransactionCard key={tx.id} transaction={tx} lang={lang} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TransactionCard({
  transaction: tx,
  lang,
  t,
}: {
  transaction: ApiPropertyTransaction;
  lang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const perMonth = tx.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
  const progress = Math.max(0, Math.min(100, tx.progress_percentage));
  // Same wording-rule special case as the transaction detail page
  // (transaction.$id.tsx) — once ready_for_next_step is reached, show the
  // real rent/sale readiness string, never the generic "Ready for Next
  // Step" humanization of the raw status enum.
  const statusLabel =
    tx.status === "ready_for_next_step"
      ? readinessText(t, tx.transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract Process")
      : t(`transactionPage.status.${tx.status}`);

  return (
    <Link
      to="/transaction/$id"
      params={{ id: String(tx.id) }}
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-colors hover:border-primary/40"
    >
      {tx.property_image_url && (
        <div className="aspect-[16/9] overflow-hidden bg-surface-2">
          <img src={tx.property_image_url} alt="" className="size-full object-cover" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 dir="auto" className="truncate text-sm font-semibold">{tx.property_title ?? `#${tx.property_id}`}</h3>
          <Badge tone={statusTone(tx.status)}>{statusLabel}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="secondary">{t(tx.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}</Badge>
          {tx.property_area && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> {tx.property_area}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("myTransactions.card.reference", { reference: tx.reference })}</p>

        <div>
          <div className="text-[11px] text-muted-foreground">{t("myTransactions.card.agreedAmount")}</div>
          <div className="text-lg font-bold">
            SAR {formatSAR(Math.round(Number(tx.agreed_amount)))}
            {perMonth}
          </div>
        </div>

        <div className="mt-1">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{t("transactionPage.progress")}</span>
            <span className="font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <p className="mt-1 text-xs font-medium">{nbaText(t, tx.next_best_action, readinessText(t, tx.readiness_label))}</p>

        <div className="mt-auto space-y-0.5 pt-2 text-xs text-muted-foreground">
          <p>{t("myTransactions.card.lastActivity", { datetime: formatDateTime(tx.updated_at, lang) })}</p>
          {tx.mediator_agent_name && <p>{tx.mediator_agent_name}</p>}
        </div>
      </div>
      <div className="border-t border-border p-3">
        <Button variant="outline" size="sm" className="w-full" asChild>
          <span>{t("myTransactions.card.open")}</span>
        </Button>
      </div>
    </Link>
  );
}
