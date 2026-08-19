import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, MapPin, X } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Badge } from "@/components/maskan/Badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import {
  fetchMyViewings,
  cancelViewing,
  VIEWING_CUSTOMER_CANCEL_REASONS,
  type ApiPropertyViewing,
} from "@/lib/api/maskan";

export const Route = createFileRoute("/viewings")({
  head: () => ({ meta: [{ title: "My Viewings — myMakan" }] }),
  component: MyViewingsPage,
});

type TabKey = "upcoming" | "pending" | "completed" | "cancelled";
const TABS: TabKey[] = ["upcoming", "pending", "completed", "cancelled"];

// Maps the backend's 8 statuses into the 4 UI buckets from brief §5.
// reschedule_proposed sits under "pending" (not "upcoming") because it
// still needs the customer's action (accept / propose-another / cancel) —
// same rationale as why it's grouped with "requested", not "confirmed".
const STATUS_TAB: Record<string, TabKey> = {
  requested: "pending",
  reschedule_proposed: "pending",
  confirmed: "upcoming",
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

function MyViewingsPage() {
  // This file's route ("/viewings") is the file-based parent of
  // "viewings.$id.tsx" ("/viewings/$id") — same nesting convention as
  // partner.tsx's children (partner.leads.$leadId.tsx etc.). Without this
  // guard, navigating to /viewings/$id would render this list page's
  // content instead of the detail route's, since TanStack Router renders
  // a parent's own component for every descendant path unless it defers
  // to <Outlet /> itself.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiPropertyViewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("upcoming");
  const [cancelTarget, setCancelTarget] = useState<ApiPropertyViewing | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchMyViewings()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  const filtered = useMemo(
    () => items.filter((v) => (STATUS_TAB[v.status] ?? "cancelled") === tab),
    [items, tab],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { upcoming: 0, pending: 0, completed: 0, cancelled: 0 };
    for (const v of items) counts[STATUS_TAB[v.status] ?? "cancelled"]++;
    return counts;
  }, [items]);

  function handleCancelled(updated: ApiPropertyViewing) {
    setItems((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    setCancelTarget(null);
  }

  if (pathname !== "/viewings") return <Outlet />;

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("myViewings.heading")}</h1>
        {user && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t(items.length === 1 ? "myViewings.subtitleSingular" : "myViewings.subtitlePlural", { count: items.length })}
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
                {t(`myViewings.tabs.${key}`)}
                {tabCounts[key] > 0 && <span className="ms-1.5 text-xs text-muted-foreground">({tabCounts[key]})</span>}
              </button>
            ))}
          </div>
        )}

        <div className="mt-8">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : !user ? (
            <EmptyState
              icon={CalendarClock}
              title={t("myViewings.signInToView")}
              action={<Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t(`myViewings.empty.${tab}`)}
              action={
                <Link to="/search">
                  <Button>{t("myViewings.empty.cta")}</Button>
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((v) => (
                <ViewingCard key={v.id} viewing={v} lang={lang} t={t} onCancel={() => setCancelTarget(v)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {cancelTarget && (
        <CancelViewingModal
          viewing={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}
    </div>
  );
}

function ViewingCard({
  viewing,
  lang,
  t,
  onCancel,
}: {
  viewing: ApiPropertyViewing;
  lang: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onCancel: () => void;
}) {
  const tab = STATUS_TAB[viewing.status] ?? "cancelled";
  const tone = STATUS_TONE[viewing.status] ?? "neutral";
  const canCancel = tab === "pending" || tab === "upcoming";

  const datetimeLine =
    viewing.status === "confirmed" && viewing.confirmed_start_at
      ? t("myViewings.card.confirmedFor", { datetime: formatDateTime(viewing.confirmed_start_at, lang) })
      : viewing.status === "reschedule_proposed" && viewing.proposed_start_at
        ? t("myViewings.card.proposedFor", { datetime: formatDateTime(viewing.proposed_start_at, lang) })
        : t("myViewings.card.requestedFor", { datetime: formatDateTime(viewing.requested_start_at, lang) });

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <Link to="/viewings/$id" params={{ id: String(viewing.id) }} className="flex flex-1 flex-col">
        {viewing.property_image_url && (
          <div className="aspect-[16/9] overflow-hidden bg-surface-2">
            <img src={viewing.property_image_url} alt="" className="size-full object-cover" />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-2 p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{viewing.property_title ?? `#${viewing.property_id}`}</h3>
            <Badge tone={tone}>{t(`myViewings.status.${viewing.status}`)}</Badge>
          </div>
          {viewing.property_area && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3.5" /> {viewing.property_area}, {viewing.property_city}
            </p>
          )}
          {viewing.mediator_agent_name && (
            <p className="text-xs text-muted-foreground">{viewing.mediator_agent_name}</p>
          )}
          <p className="mt-1 text-sm font-medium">{datetimeLine}</p>
        </div>
      </Link>
      <div className="flex items-center gap-2 border-t border-border p-3">
        <Link to="/viewings/$id" params={{ id: String(viewing.id) }} className="flex-1">
          <Button variant="outline" size="sm" className="w-full">
            {t("myViewings.card.viewDetails")}
          </Button>
        </Link>
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onCancel();
            }}
          >
            <X className="size-3.5" /> {t("myViewings.card.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}

function CancelViewingModal({
  viewing,
  onClose,
  onCancelled,
}: {
  viewing: ApiPropertyViewing;
  onClose: () => void;
  onCancelled: (v: ApiPropertyViewing) => void;
}) {
  const { t } = useLanguage();
  const [reason, setReason] = useState<string>(VIEWING_CUSTOMER_CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await cancelViewing(viewing.id, reason, note.trim() || undefined);
      onCancelled(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myViewings.cancelModal.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{t("myViewings.cancelModal.title")}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("myViewings.cancelModal.reasonLabel")}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {VIEWING_CUSTOMER_CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`myViewings.cancelModal.reasons.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("myViewings.cancelModal.noteLabel")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2.5 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              {t("myViewings.cancelModal.cancel")}
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => void handleConfirm()} disabled={submitting}>
              {submitting ? t("myViewings.cancelModal.submitting") : t("myViewings.cancelModal.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
