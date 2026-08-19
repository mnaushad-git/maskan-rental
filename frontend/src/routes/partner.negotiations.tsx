import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Handshake, MapPin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { NEGOTIATION_SIGNAL_TONE, NEGOTIATION_SIGNAL_I18N_KEY } from "@/lib/negotiationSignal";
import { fetchPartnerNegotiations, acceptNegotiationAsPartner, type ApiPartnerNegotiation } from "@/lib/api/maskan";

export const Route = createFileRoute("/partner/negotiations")({
  head: () => ({ meta: [{ title: "Offers & Negotiations — myMakan Partner" }] }),
  component: PartnerNegotiationsPage,
});

type TabKey = "new" | "countered" | "accepted" | "rejected" | "closed";
const TABS: TabKey[] = ["new", "countered", "accepted", "rejected", "closed"];

// Maps the backend's 6 statuses into the 5 UI tabs from brief §7. Unlike the
// customer-side My Negotiations page (3 tabs), the partner inbox keeps
// "Countered"/"Rejected" as their own tabs since a mediator's workflow cares
// which side acted last. `withdrawn` has no dedicated tab (brief only lists
// 5) so it folds into "Closed", same terminal bucket as `closed` itself.
const STATUS_TAB: Record<string, TabKey> = {
  submitted: "new",
  countered: "countered",
  accepted: "accepted",
  rejected: "rejected",
  withdrawn: "closed",
  closed: "closed",
};

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral" | "destructive"> = {
  submitted: "info",
  countered: "warning",
  accepted: "success",
  rejected: "destructive",
  withdrawn: "neutral",
  closed: "neutral",
};

function relativeAge(iso: string, lang: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return lang === "ar" ? "أقل من ساعة" : "less than an hour ago";
  if (hours < 24) return lang === "ar" ? `منذ ${hours} ساعة` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}

function PartnerNegotiationsPage() {
  // Same "foo.bar.tsx sibling of foo.tsx" guard partner.viewings.tsx uses —
  // without it, navigating to /partner/negotiations/$id would render this
  // list page's content instead of deferring to the nested route.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<ApiPartnerNegotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("new");
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    setError(false);
    fetchPartnerNegotiations()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const filtered = useMemo(() => items.filter((n) => (STATUS_TAB[n.status] ?? "closed") === tab), [items, tab]);
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { new: 0, countered: 0, accepted: 0, rejected: 0, closed: 0 };
    for (const n of items) counts[STATUS_TAB[n.status] ?? "closed"]++;
    return counts;
  }, [items]);

  // Quick "Accept" only offered for `submitted` negotiations — the latest
  // offer there is always the customer's own initial offer, so accepting is
  // guaranteed valid (never trips the backend's self-accept-blocked rule).
  // For `countered`, whether Accept is actually valid depends on which side
  // placed the latest offer — data this list response doesn't carry (no
  // offer history) — so Counter/Reject deep-link into the detail page
  // instead of being second-guessed here, same "best-effort quick action,
  // full logic lives on the detail page" convention partner.viewings.tsx's
  // own quick confirm/complete buttons already established.
  async function handleQuickAccept(id: number) {
    setBusyId(id);
    try {
      const updated = await acceptNegotiationAsPartner(id);
      setItems((prev) => prev.map((n) => (n.id === id ? updated : n)));
    } catch {
      // best-effort — the detail page has full error handling for this action
    } finally {
      setBusyId(null);
    }
  }

  if (pathname !== "/partner/negotiations") return <Outlet />;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link to="/partner" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerNegotiations.dashboard")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">{t("partnerNegotiations.heading")}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold">{t("partnerNegotiations.heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("partnerNegotiations.subtitle")}</p>

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
              {t(`partnerNegotiations.tabs.${key}`)}
              {tabCounts[key] > 0 && <span className="ms-1.5 text-xs text-muted-foreground">({tabCounts[key]})</span>}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <EmptyState
              icon={Handshake}
              title={t("partnerNegotiations.loadError")}
              action={
                <Button variant="outline" onClick={load}>
                  <RefreshCw className="size-4" /> {t("partnerNegotiations.retry")}
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState icon={Handshake} title={t(`partnerNegotiations.empty.${tab}`)} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {filtered.map((n) => {
                const listingAmount = Number(n.property_listing_amount ?? n.original_listing_amount);
                const currentOffer = Number(n.current_offer_amount);
                const diff = currentOffer - listingAmount;
                const diffPct = listingAmount ? (Math.abs(diff) / listingAmount) * 100 : 0;
                const perMonth = n.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";
                const isNew = n.status === "submitted";
                const isActive = n.status === "submitted" || n.status === "countered";

                return (
                  <div key={n.id} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-5 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <MapPin className="size-3.5 text-muted-foreground" />
                        {n.property_title ?? `#${n.property_id}`}
                      </div>
                      <Badge tone={STATUS_TONE[n.status] ?? "neutral"}>{t(`negotiationDetail.status.${n.status}`)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{n.customer_name ?? t("partnerLeadDetail.name")}</p>

                    {/* Negotiation strength signal (brief §14) — same
                        badge/coloring the customer-side list + both detail
                        screens render (@/lib/negotiationSignal). */}
                    {n.negotiation_signal && (
                      <Badge tone={NEGOTIATION_SIGNAL_TONE[n.negotiation_signal.signal]} className="self-start">
                        {t(`negotiationDetail.signal.tag.${NEGOTIATION_SIGNAL_I18N_KEY[n.negotiation_signal.signal]}`)}
                      </Badge>
                    )}

                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[11px] text-muted-foreground">{t("partnerNegotiations.card.listingAmount")}</div>
                        <div className="text-sm font-semibold text-muted-foreground">
                          SAR {formatSAR(Math.round(listingAmount))}
                          {perMonth}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">{t("partnerNegotiations.card.currentOffer")}</div>
                        <div className="text-sm font-bold">
                          SAR {formatSAR(Math.round(currentOffer))}
                          {perMonth}
                        </div>
                      </div>
                    </div>
                    {listingAmount > 0 && diff !== 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t(diff < 0 ? "negotiationDetail.offerBlock.belowListing" : "negotiationDetail.offerBlock.aboveListing", {
                          amount: formatSAR(Math.round(Math.abs(diff))),
                          percent: diffPct.toFixed(1),
                        })}
                      </p>
                    )}

                    <div className="space-y-0.5 text-[11px] text-muted-foreground">
                      <p>{t("partnerNegotiations.card.submittedAge", { time: relativeAge(n.created_at, lang) })}</p>
                    </div>
                    {n.viewing_id != null && <p className="text-[11px] font-medium text-success">{t("partnerNegotiations.card.viewingLinked")}</p>}
                    {n.lead_id != null && <p className="text-[11px] font-medium text-success">{t("partnerNegotiations.card.leadLinked")}</p>}

                    <div className="mt-2 flex flex-wrap gap-2">
                      {isNew && (
                        <Button size="sm" onClick={() => void handleQuickAccept(n.id)} disabled={busyId === n.id}>
                          <CheckCircle2 className="size-3.5" />
                          {busyId === n.id ? t("partnerNegotiations.card.accepting") : t("partnerNegotiations.card.accept")}
                        </Button>
                      )}
                      {isActive && (
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/partner/negotiations/$id" params={{ id: String(n.id) }} search={{ action: "counter" }}>
                            {t("partnerNegotiations.card.counter")}
                          </Link>
                        </Button>
                      )}
                      {isActive && (
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/partner/negotiations/$id" params={{ id: String(n.id) }} search={{ action: "reject" }}>
                            {t("partnerNegotiations.card.reject")}
                          </Link>
                        </Button>
                      )}
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/partner/negotiations/$id" params={{ id: String(n.id) }}>
                          {t("partnerNegotiations.card.open")}
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
