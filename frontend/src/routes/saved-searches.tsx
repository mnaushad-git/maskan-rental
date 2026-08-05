import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteSavedSearch,
  disableSavedSearchAlerts,
  enableSavedSearchAlerts,
  fetchSavedSearches,
  previewExistingSavedSearch,
  UnauthorizedError,
  type ApiSavedSearch,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { formatSAR } from "@/lib/maskan-data";

export const Route = createFileRoute("/saved-searches")({
  head: () => ({
    meta: [
      { title: "Saved Searches — Maskan" },
      {
        name: "description",
        content: "Manage your saved searches and property alert preferences.",
      },
    ],
  }),
  component: SavedSearchesPage,
});

function relativeTime(
  iso: string | null,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!iso) return t("savedSearches.card.lastAlertNever");
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return t("notifications.justNow");
  if (diffMins < 60) return t("notifications.minutesAgo", { count: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t("notifications.hoursAgo", { count: diffHours });
  return t("notifications.daysAgo", { count: Math.floor(diffHours / 24) });
}

function summaryLine(
  search: ApiSavedSearch,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const f = search.filters;
  const parts: string[] = [];
  if (f.districts?.length) parts.push(f.districts.join(", "));
  else if (f.city) parts.push(f.city);
  if (f.property_type) parts.push(f.property_type);
  if (f.max_price) parts.push(`≤ ${formatSAR(f.max_price)} SAR`);
  return parts.length ? parts.join(" · ") : t(`listingCategories.${f.transaction_type ?? "rent"}`);
}

function SavedSearchCard({
  search,
  onChange,
  onDelete,
}: {
  search: ApiSavedSearch;
  onChange: (s: ApiSavedSearch) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function toggleAlerts() {
    if (busy) return;
    setBusy(true);
    try {
      const next = search.alert_enabled
        ? await disableSavedSearchAlerts(search.id)
        : await enableSavedSearchAlerts(search.id);
      onChange(next);
    } catch {
      toast.error(t("savedSearches.saveDialog.errorToast"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteSavedSearch(search.id);
      onDelete();
    } catch {
      toast.error(t("savedSearches.saveDialog.errorToast"));
    }
  }

  async function handlePreview() {
    if (previewing) return;
    setPreviewing(true);
    try {
      const res = await previewExistingSavedSearch(search.id);
      toast.info(
        t(
          res.estimated_count === 1
            ? "savedSearches.saveDialog.estimatedMatchesSingular"
            : "savedSearches.saveDialog.estimatedMatchesPlural",
          {
            count: res.estimated_count,
          },
        ),
      );
    } catch {
      toast.error(t("savedSearches.saveDialog.errorToast"));
    } finally {
      setPreviewing(false);
    }
  }

  const frequencyLabel: Record<string, string> = {
    instant: t("savedSearches.card.frequencyInstant"),
    daily: t("savedSearches.card.frequencyDaily"),
    weekly: t("savedSearches.card.frequencyWeekly"),
    off: t("savedSearches.card.frequencyOff"),
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{search.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{summaryLine(search, t)}</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          aria-label={t("savedSearches.card.delete")}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${search.alert_enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
        >
          {search.alert_enabled ? <Bell className="size-3" /> : <BellOff className="size-3" />}
          {t(search.alert_enabled ? "savedSearches.card.alertsOn" : "savedSearches.card.alertsOff")}
        </span>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {frequencyLabel[search.alert_frequency]}
        </span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {t(
            search.latest_matches_count === 1
              ? "savedSearches.card.matchesSingular"
              : "savedSearches.card.matchesPlural",
            { count: search.latest_matches_count },
          )}
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t("savedSearches.card.lastAlert", { date: relativeTime(search.last_notified_at, t) })}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({
              to: "/search",
              search: {
                listingType: search.filters.transaction_type ?? "rent",
                city: search.filters.city ?? "Any",
              } as never,
            })
          }
        >
          <Search className="size-3.5" /> {t("savedSearches.card.runSearch")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handlePreview()}
          disabled={previewing}
        >
          {previewing ? <Loader2 className="size-3.5 animate-spin" /> : null}{" "}
          {t("savedSearches.card.previewMatches")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void toggleAlerts()} disabled={busy}>
          {t(search.alert_enabled ? "savedSearches.card.disable" : "savedSearches.card.enable")}
        </Button>
      </div>

      {confirmingDelete && (
        <div className="mt-1 flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-foreground">
            {t("savedSearches.deleteConfirm.desc", { name: search.name })}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => void handleDelete()}>
              {t("savedSearches.deleteConfirm.confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
              {t("savedSearches.deleteConfirm.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedSearchesPage() {
  const { user, authLoading, clearAuth } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiSavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchSavedSearches()
      .then(setItems)
      .catch((err) => {
        if (err instanceof UnauthorizedError) clearAuth();
        else setError(t("savedSearches.unableToLoad"));
      })
      .finally(() => setLoading(false));
  }, [user, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              {t("savedSearches.heading")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                items.length === 1
                  ? "savedSearches.subtitleSingular"
                  : "savedSearches.subtitlePlural",
                { count: items.length },
              )}
            </p>
          </div>
          {user && (
            <button
              type="button"
              onClick={() => navigate({ to: "/property-requests/new" })}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-ai/20 bg-ai-soft/20 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-ai-soft/30"
            >
              <Sparkles className="size-4 text-ai" /> {t("propertyRequest.entryPoint.ctaShort")}
            </button>
          )}
        </div>

        <div className="mt-8">
          {authLoading || loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" />
              ))}
            </div>
          ) : !user ? (
            <EmptyState
              icon={Bell}
              title={t("myLeads.signInToView")}
              action={
                <Button onClick={() => navigate({ to: "/auth" })}>{t("navAuth.signIn")}</Button>
              }
            />
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={t("savedSearches.empty.heading")}
              description={t("savedSearches.empty.desc")}
              action={
                <Button onClick={() => navigate({ to: "/search" })}>
                  {t("savedSearches.empty.browseProperties")}
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((s) => (
                <SavedSearchCard
                  key={s.id}
                  search={s}
                  onChange={(next) =>
                    setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)))
                  }
                  onDelete={() => setItems((prev) => prev.filter((it) => it.id !== s.id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
