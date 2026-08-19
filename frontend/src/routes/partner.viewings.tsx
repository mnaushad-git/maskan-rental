import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, MapPin } from "lucide-react";
import { Badge } from "@/components/maskan/Badges";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import {
  fetchPartnerViewings,
  confirmViewing,
  completeViewing,
  type ApiPartnerPropertyViewing,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/partner/viewings")({
  head: () => ({ meta: [{ title: "Viewing Requests — myMakan Partner" }] }),
  component: PartnerViewingsPage,
});

type TabKey = "new" | "confirmed" | "reschedule" | "completed" | "cancelled";
const TABS: TabKey[] = ["new", "confirmed", "reschedule", "completed", "cancelled"];

const STATUS_TAB: Record<string, TabKey> = {
  requested: "new",
  confirmed: "confirmed",
  reschedule_proposed: "reschedule",
  completed: "completed",
  cancelled_by_customer: "cancelled",
  cancelled_by_mediator: "cancelled",
  no_show_customer: "cancelled",
  no_show_mediator: "cancelled",
};

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  requested: "info",
  reschedule_proposed: "warning",
  confirmed: "success",
  completed: "neutral",
  cancelled_by_customer: "neutral",
  cancelled_by_mediator: "neutral",
  no_show_customer: "neutral",
  no_show_mediator: "neutral",
};

function formatDateTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeAge(iso: string, lang: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return lang === "ar" ? "أقل من ساعة" : "less than an hour ago";
  if (hours < 24) return lang === "ar" ? `منذ ${hours} ساعة` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}

function PartnerViewingsPage() {
  // Same nesting fix as customer-side viewings.tsx / partner.tsx: this file
  // is the file-based parent of partner.viewings.$id.tsx, so it must defer
  // to <Outlet /> for any path beyond its own exact index.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<ApiPartnerPropertyViewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("new");
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    fetchPartnerViewings()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading || !user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  const filtered = useMemo(() => items.filter((v) => (STATUS_TAB[v.status] ?? "cancelled") === tab), [items, tab]);
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { new: 0, confirmed: 0, reschedule: 0, completed: 0, cancelled: 0 };
    for (const v of items) counts[STATUS_TAB[v.status] ?? "cancelled"]++;
    return counts;
  }, [items]);

  async function handleQuickConfirm(id: number) {
    setBusyId(id);
    try {
      const updated = await confirmViewing(id);
      setItems((prev) => prev.map((v) => (v.id === id ? updated : v)));
    } catch {
      // best-effort — the detail page has full error handling for this action
    } finally {
      setBusyId(null);
    }
  }

  async function handleQuickComplete(id: number) {
    setBusyId(id);
    try {
      const updated = await completeViewing(id);
      setItems((prev) => prev.map((v) => (v.id === id ? updated : v)));
    } catch {
      // best-effort — the detail page has full error handling for this action
    } finally {
      setBusyId(null);
    }
  }

  if (pathname !== "/partner/viewings") return <Outlet />;

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Link to="/partner" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("partnerViewings.dashboard")}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">{t("partnerViewings.heading")}</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-2xl font-bold">{t("partnerViewings.heading")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("partnerViewings.subtitle")}</p>

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
              {t(`partnerViewings.tabs.${key}`)}
              {tabCounts[key] > 0 && <span className="ms-1.5 text-xs text-muted-foreground">({tabCounts[key]})</span>}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-2xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={CalendarClock} title={t(`partnerViewings.empty.${tab}`)} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {filtered.map((v) => (
                <div key={v.id} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-5 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <MapPin className="size-3.5 text-muted-foreground" />
                      {v.property_title ?? `#${v.property_id}`}
                    </div>
                    <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{t(`myViewings.status.${v.status}`)}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{v.customer_name ?? t("partnerLeadDetail.name")}</p>
                  <p className="text-sm font-medium">
                    {v.status === "confirmed" && v.confirmed_start_at
                      ? t("partnerViewings.card.confirmedFor", { datetime: formatDateTime(v.confirmed_start_at, lang) })
                      : v.status === "reschedule_proposed" && v.proposed_start_at
                        ? t("partnerViewings.card.proposedFor", { datetime: formatDateTime(v.proposed_start_at, lang) })
                        : t("partnerViewings.card.requestedFor", { datetime: formatDateTime(v.requested_start_at, lang) })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{t("partnerViewings.card.requestAge", { time: relativeAge(v.created_at, lang) })}</p>
                  {v.lead_id && <p className="text-[11px] font-medium text-success">{t("partnerViewings.card.leadLinked")}</p>}

                  <div className="mt-2 flex flex-wrap gap-2">
                    {v.status === "requested" && (
                      <Button size="sm" onClick={() => void handleQuickConfirm(v.id)} disabled={busyId === v.id}>
                        {t("partnerViewings.card.confirm")}
                      </Button>
                    )}
                    {v.status === "confirmed" && (
                      <Button size="sm" onClick={() => void handleQuickComplete(v.id)} disabled={busyId === v.id}>
                        {t("partnerViewings.card.markCompleted")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/partner/viewings/$id" params={{ id: String(v.id) }}>
                        {t("partnerViewings.card.open")}
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
