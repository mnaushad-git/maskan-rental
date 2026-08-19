import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Handshake, MapPin, MessageCircle, RefreshCw, Sparkles } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";
import { NEGOTIATION_SIGNAL_TONE, NEGOTIATION_SIGNAL_I18N_KEY } from "@/lib/negotiationSignal";
import { fetchMyNegotiations, type ApiPropertyNegotiation } from "@/lib/api/maskan";

export const Route = createFileRoute("/negotiations")({
  head: () => ({ meta: [{ title: "My Negotiations — myMakan" }] }),
  component: MyNegotiationsPage,
});

type TabKey = "active" | "accepted" | "closed";
const TABS: TabKey[] = ["active", "accepted", "closed"];

// Maps the backend's 6 statuses into the 3 UI buckets from brief §20:
// submitted/countered -> active (still in play, either side can respond);
// accepted -> its own "Offer Agreed" bucket (see negotiations.$id.tsx);
// rejected/withdrawn/closed -> closed (terminal, no further action possible).
// Documented in docs/implementation/mymakan-negotiations.md "Screens changed".
const STATUS_TAB: Record<string, TabKey> = {
  submitted: "active",
  countered: "active",
  accepted: "accepted",
  rejected: "closed",
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

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MyNegotiationsPage() {
  // Same "foo.bar.tsx sibling of foo.tsx" guard the viewings feature uses
  // (frontend/src/routes/viewings.tsx) — without it, navigating to
  // /negotiations/$id (or /negotiations/$id/agreement) would render this
  // list page's content instead of deferring to the nested route.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiPropertyNegotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("active");

  function load() {
    setLoading(true);
    setError(false);
    fetchMyNegotiations()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const filtered = useMemo(
    () => items.filter((n) => (STATUS_TAB[n.status] ?? "closed") === tab),
    [items, tab],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { active: 0, accepted: 0, closed: 0 };
    for (const n of items) counts[STATUS_TAB[n.status] ?? "closed"]++;
    return counts;
  }, [items]);

  if (pathname !== "/negotiations") return <Outlet />;

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("myNegotiations.heading")}</h1>
        {user && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t(items.length === 1 ? "myNegotiations.subtitleSingular" : "myNegotiations.subtitlePlural", { count: items.length })}
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
                {t(`myNegotiations.tabs.${key}`)}
                {tabCounts[key] > 0 && <span className="ms-1.5 text-xs text-muted-foreground">({tabCounts[key]})</span>}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-56 rounded-2xl" />
              ))}
            </div>
          ) : !user ? (
            <EmptyState
              icon={Handshake}
              title={t("myNegotiations.signInToView")}
              action={<Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>}
            />
          ) : error ? (
            <EmptyState
              icon={Handshake}
              title={t("myNegotiations.loadError")}
              action={
                <Button variant="outline" onClick={load}>
                  <RefreshCw className="size-4" /> {t("myNegotiations.retry")}
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title={t(`myNegotiations.empty.${tab}`)}
              action={
                <Link to="/search">
                  <Button>{t("myNegotiations.empty.cta")}</Button>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((n) => (
                <NegotiationCard key={n.id} negotiation={n} lang={lang} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NegotiationCard({
  negotiation: n,
  lang,
  t,
}: {
  negotiation: ApiPropertyNegotiation;
  lang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const tone = STATUS_TONE[n.status] ?? "neutral";
  const listingAmount = Number(n.property_listing_amount ?? n.original_listing_amount);
  const currentOffer = Number(n.current_offer_amount);
  const perMonth = n.transaction_type === "rent" ? t("negotiationDetail.offerBlock.perMonth") : "";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <Link to="/negotiations/$id" params={{ id: String(n.id) }} className="flex flex-1 flex-col">
        {n.property_image_url && (
          <div className="aspect-[16/9] overflow-hidden bg-surface-2">
            <img src={n.property_image_url} alt="" className="size-full object-cover" />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{n.property_title ?? `#${n.property_id}`}</h3>
            <Badge tone={tone}>{t(`negotiationDetail.status.${n.status}`)}</Badge>
          </div>
          {n.property_district && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> {n.property_district}
            </p>
          )}
          {/* Negotiation strength signal (brief §14) — same badge/coloring the
              detail screen renders (@/lib/negotiationSignal), read straight off
              the backend field, never re-derived. */}
          {n.negotiation_signal && (
            <Badge tone={NEGOTIATION_SIGNAL_TONE[n.negotiation_signal.signal]} className="self-start">
              {t(`negotiationDetail.signal.tag.${NEGOTIATION_SIGNAL_I18N_KEY[n.negotiation_signal.signal]}`)}
            </Badge>
          )}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] text-muted-foreground">{t("myNegotiations.card.listingAmount")}</div>
              <div className="text-sm font-semibold text-muted-foreground">
                SAR {formatSAR(Math.round(listingAmount))}
                {perMonth}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">{t("myNegotiations.card.currentOffer")}</div>
              <div className="text-sm font-bold">
                SAR {formatSAR(Math.round(currentOffer))}
                {perMonth}
              </div>
            </div>
          </div>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <p>{t("myNegotiations.card.lastActivity", { datetime: formatDateTime(n.updated_at, lang) })}</p>
            {n.mediator_agent_name && <p>{n.mediator_agent_name}</p>}
          </div>
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
        <Link to="/negotiations/$id" params={{ id: String(n.id) }} className="flex-1 basis-full sm:basis-auto">
          <Button variant="outline" size="sm" className="w-full">
            {t("myNegotiations.card.open")}
          </Button>
        </Link>
        <Link to="/negotiations/$id" params={{ id: String(n.id) }} search={{ ask: true }}>
          <Button variant="ghost" size="sm">
            <Sparkles className="size-3.5" /> {t("myNegotiations.card.askMyMakan")}
          </Button>
        </Link>
        {n.lead_id != null && (
          <Link to="/lead/$leadId" params={{ leadId: String(n.lead_id) }}>
            <Button variant="ghost" size="sm">
              <MessageCircle className="size-3.5" /> {t("myNegotiations.card.messageMediator")}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
