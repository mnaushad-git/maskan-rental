import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, FileCheck2, MapPin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { statusTone, readinessText, nbaText } from "@/lib/transactionWorkspace";
import { fetchPartnerTransactions, type ApiPartnerPropertyTransaction } from "@/lib/api/maskan";

export const Route = createFileRoute("/partner/transactions")({
  head: () => ({ meta: [{ title: "Transactions — myMakan Partner" }] }),
  component: PartnerTransactionsPage,
});

// Mirrors partner.negotiations.tsx's tabs, but each tab maps to a
// server-side `status_filter` bucket (see property_transaction.py's
// list_transactions_for_mediator()) rather than being derivable purely from
// the row's own `status` field client-side — "Action Required" specifically
// depends on per-document state the list summary response doesn't carry, so
// this page refetches per tab instead of bucketing one fetch locally (unlike
// partner.negotiations.tsx / my-transactions.tsx, which can bucket client-side).
type TabKey = "actionRequired" | "active" | "ready" | "completed" | "cancelled";
const TABS: TabKey[] = ["actionRequired", "active", "ready", "completed", "cancelled"];
const TAB_FILTER: Record<TabKey, string> = {
  actionRequired: "action_required",
  active: "active",
  ready: "ready",
  completed: "completed",
  cancelled: "cancelled",
};

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function PartnerTransactionsPage() {
  // Same "foo.bar.tsx sibling of foo.tsx" guard partner.negotiations.tsx uses
  // — without it, navigating to /partner/transactions/$id would render this
  // list page's content instead of deferring to the nested route.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<ApiPartnerPropertyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("actionRequired");

  function load(activeTab: TabKey) {
    setLoading(true);
    setError(false);
    fetchPartnerTransactions(TAB_FILTER[activeTab])
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, tab]);

  if (pathname !== "/partner/transactions") return <Outlet />;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link to="/partner" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerTransactions.dashboard")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">{t("partnerTransactions.heading")}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold">{t("partnerTransactions.heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("partnerTransactions.subtitle")}</p>

        <div className="mt-6 flex flex-wrap gap-2 border-b border-border pb-px">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`partnerTransactions.tabs.${key}`)}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-56 rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={FileCheck2}
              title={t("partnerTransactions.loadError")}
              action={
                <Button variant="outline" onClick={() => load(tab)}>
                  <RefreshCw className="size-4" /> {t("partnerTransactions.retry")}
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState icon={FileCheck2} title={t(`partnerTransactions.empty.${tab}`)} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {items.map((tx) => {
                const perMonth = tx.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
                const progress = Math.max(0, Math.min(100, tx.progress_percentage));
                // Same wording-rule special case as the partner detail page
                // (partner.transactions.$id.tsx) — once ready_for_next_step
                // is reached, show the real rent/sale readiness string,
                // never the generic "Ready for Next Step" humanization of
                // the raw status enum.
                const statusLabel =
                  tx.status === "ready_for_next_step"
                    ? readinessText(t, tx.transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract Process")
                    : t(`transactionPage.status.${tx.status}`);
                return (
                  <Link
                    key={tx.id}
                    to="/partner/transactions/$id"
                    params={{ id: String(tx.id) }}
                    className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-5 shadow-card transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <MapPin className="size-3.5 text-muted-foreground" />
                        {tx.property_title ?? `#${tx.property_id}`}
                      </div>
                      <Badge tone={statusTone(tx.status)}>{statusLabel}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{tx.customer_name ?? t("partnerLeadDetail.name")}</p>
                    <div className="flex items-center gap-2">
                      <Badge tone="secondary">{t(tx.transaction_type === "rent" ? "transactionPage.typeRent" : "transactionPage.typeSale")}</Badge>
                      <span className="text-xs text-muted-foreground">{t("partnerTransactions.card.reference", { reference: tx.reference })}</span>
                    </div>

                    <div>
                      <div className="text-[11px] text-muted-foreground">{t("partnerTransactions.card.amount")}</div>
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

                    <div className="mt-auto pt-2 text-xs text-muted-foreground">
                      {t("partnerTransactions.card.lastUpdated", { datetime: formatDateTime(tx.updated_at, lang) })}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
