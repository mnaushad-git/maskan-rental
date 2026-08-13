import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { PropertyRequestStatusBadge } from "@/components/maskan/PropertyRequestStatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelPropertyRequest,
  closePropertyRequest,
  fetchPropertyRequests,
  pausePropertyRequest,
  resumePropertyRequest,
  UnauthorizedError,
  type ApiPropertyRequestSummary,
  type PropertyRequestStatus,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";

export const Route = createFileRoute("/property-requests")({
  head: () => ({
    meta: [
      { title: "My Property Requests — myMakan" },
      {
        name: "description",
        content: "Manage your property requests and see AI-matched listings.",
      },
    ],
  }),
  component: PropertyRequestsPage,
});

type TabKey = "active" | "drafts" | "paused" | "fulfilled" | "closed";

const TAB_STATUS_MAP: Record<TabKey, PropertyRequestStatus[]> = {
  active: ["active", "matched", "negotiating"],
  drafts: ["draft", "awaiting_clarification"],
  paused: ["paused"],
  fulfilled: ["fulfilled"],
  closed: ["closed", "expired", "cancelled"],
};

const TABS: TabKey[] = ["active", "drafts", "paused", "fulfilled", "closed"];

function relativeDate(iso: string | null, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function summaryLine(
  r: ApiPropertyRequestSummary,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  if (r.transaction_type) parts.push(t(`listingCategories.${r.transaction_type}`));
  if (r.city) {
    const cityKey = `cities.${r.city}`;
    const cityLabel = t(cityKey);
    parts.push(cityLabel === cityKey ? r.city : cityLabel);
  }
  if (r.bedrooms_min) parts.push(`${r.bedrooms_min}+ BR`);
  if (r.max_price) parts.push(`≤ SAR ${formatSAR(r.max_price)}`);
  else if (r.min_price) parts.push(`≥ SAR ${formatSAR(r.min_price)}`);
  return parts.length ? parts.join(" · ") : r.title;
}

function PropertyRequestCard({
  request,
  onChange,
  onRemove,
}: {
  request: ApiPropertyRequestSummary;
  onChange: (r: ApiPropertyRequestSummary) => void;
  onRemove: () => void;
}) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"cancel" | "close" | null>(null);

  const isDraft = request.status === "draft" || request.status === "awaiting_clarification";
  const isActive =
    request.status === "active" || request.status === "matched" || request.status === "negotiating";
  const isPaused = request.status === "paused";

  async function handlePause() {
    setBusy(true);
    try {
      const updated = await pausePropertyRequest(request.id);
      onChange({ ...request, status: updated.status });
      toast.success(t("propertyRequest.list.toasts.paused"));
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    setBusy(true);
    try {
      const updated = await resumePropertyRequest(request.id);
      onChange({ ...request, status: updated.status });
      toast.success(t("propertyRequest.list.toasts.resumed"));
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    setBusy(true);
    try {
      const updated = await closePropertyRequest(request.id);
      onChange({ ...request, status: updated.status });
      toast.success(t("propertyRequest.list.toasts.closed"));
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function handleCancel() {
    setBusy(true);
    try {
      await cancelPropertyRequest(request.id);
      toast.success(t("propertyRequest.list.toasts.cancelled"));
      onRemove();
    } catch {
      toast.error(t("propertyRequest.list.toasts.actionFailed"));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            navigate({ to: "/property-requests/$id", params: { id: String(request.id) } })
          }
          className="min-w-0 flex-1 text-start"
        >
          <h3 className="truncate text-base font-bold hover:underline">{request.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{summaryLine(request, t)}</p>
        </button>
        <PropertyRequestStatusBadge status={request.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {t("propertyRequest.list.card.matches", { count: request.match_count })}
        </span>
        {request.new_match_count > 0 && (
          <span className="rounded-full bg-info/15 px-2.5 py-1 text-[11px] font-semibold text-info">
            {t("propertyRequest.list.card.newMatches", { count: request.new_match_count })}
          </span>
        )}
        {request.mediator_response_count > 0 && (
          <span className="rounded-full bg-ai/15 px-2.5 py-1 text-[11px] font-semibold text-ai">
            {t("propertyRequest.list.card.mediatorResponses", {
              count: request.mediator_response_count,
            })}
          </span>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {request.expiry_date
          ? t("propertyRequest.list.card.expiresOn", {
              date: relativeDate(request.expiry_date, lang),
            })
          : t("propertyRequest.list.card.noExpiry")}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({ to: "/property-requests/$id", params: { id: String(request.id) } })
          }
        >
          {t("propertyRequest.list.card.view")}
        </Button>
        {isDraft && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigate({ to: "/property-requests/new", search: { requestId: request.id } })
            }
          >
            {t("propertyRequest.list.card.continueEditing")}
          </Button>
        )}
        {isActive && (
          <Button size="sm" variant="ghost" onClick={() => void handlePause()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}{" "}
            {t("propertyRequest.list.card.pause")}
          </Button>
        )}
        {isPaused && (
          <Button size="sm" variant="ghost" onClick={() => void handleResume()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}{" "}
            {t("propertyRequest.list.card.resume")}
          </Button>
        )}
        {(isActive || isPaused) && confirming !== "close" && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming("close")} disabled={busy}>
            {t("propertyRequest.list.card.close")}
          </Button>
        )}
        {isDraft && confirming !== "cancel" && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming("cancel")} disabled={busy}>
            {t("propertyRequest.list.card.cancel")}
          </Button>
        )}
      </div>

      {confirming === "close" && (
        <div className="mt-1 flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs text-foreground">{t("propertyRequest.list.card.confirmClose")}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleClose()}
              disabled={busy}
            >
              {t("propertyRequest.list.card.close")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
              {t("propertyRequest.list.card.keepIt")}
            </Button>
          </div>
        </div>
      )}
      {confirming === "cancel" && (
        <div className="mt-1 flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-foreground">{t("propertyRequest.list.card.confirmCancel")}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void handleCancel()}
              disabled={busy}
            >
              {t("propertyRequest.list.card.confirmDelete")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
              {t("propertyRequest.list.card.keepIt")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PropertyRequestsPage() {
  const { user, authLoading, clearAuth } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiPropertyRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("active");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchPropertyRequests({ limit: 200 })
      .then((res) => setItems(res.data))
      .catch((err) => {
        if (err instanceof UnauthorizedError) clearAuth();
        else setError(t("propertyRequest.list.unableToLoad"));
      })
      .finally(() => setLoading(false));
  }, [user, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => items.filter((r) => TAB_STATUS_MAP[tab].includes(r.status)),
    [items, tab],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      active: 0,
      drafts: 0,
      paused: 0,
      fulfilled: 0,
      closed: 0,
    };
    for (const it of items) {
      for (const key of TABS) {
        if (TAB_STATUS_MAP[key].includes(it.status)) counts[key]++;
      }
    }
    return counts;
  }, [items]);

  const emptyDescKey: Record<TabKey, string> = {
    active: "propertyRequest.list.empty.descActive",
    drafts: "propertyRequest.list.empty.descDrafts",
    paused: "propertyRequest.list.empty.descPaused",
    fulfilled: "propertyRequest.list.empty.descFulfilled",
    closed: "propertyRequest.list.empty.descClosed",
  };

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {t("propertyRequest.list.heading")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                items.length === 1
                  ? "propertyRequest.list.subtitleSingular"
                  : "propertyRequest.list.subtitlePlural",
                { count: items.length },
              )}
            </p>
          </div>
          {user && (
            <Button onClick={() => navigate({ to: "/property-requests/new" })}>
              <Plus className="size-4" /> {t("propertyRequest.list.newRequest")}
            </Button>
          )}
        </div>

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
                {t(`propertyRequest.tabs.${key}`)}
                {tabCounts[key] > 0 && (
                  <span className="ms-1.5 text-xs text-muted-foreground">({tabCounts[key]})</span>
                )}
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
              icon={ClipboardList}
              title={t("propertyRequest.list.signInToView")}
              action={
                <Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>
              }
            />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={t("propertyRequest.list.empty.heading")}
              description={t(emptyDescKey[tab])}
              action={
                <Button onClick={() => navigate({ to: "/property-requests/new" })}>
                  {t("propertyRequest.list.empty.cta")}
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((r) => (
                <PropertyRequestCard
                  key={r.id}
                  request={r}
                  onChange={(next) =>
                    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)))
                  }
                  onRemove={() => setItems((prev) => prev.filter((it) => it.id !== r.id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
