import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Loader2, Settings, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TopNav } from "@/components/maskan/TopNav";
import { EmptyState } from "@/components/maskan/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteNotificationRecord,
  fetchNotificationCenter,
  markAllNotificationsRead,
  markNotificationRead,
  UnauthorizedError,
  type ApiNotificationRecord,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { deepLinkToPath, iconFor } from "@/lib/notificationDisplay";
import { useNotificationStream } from "@/lib/useNotificationStream";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — myMakan" },
      { name: "description", content: "Property alerts, digests, and platform updates." },
    ],
  }),
  component: NotificationsPage,
});

// Real backend `Notification.type` values (app/models/notification.py), grouped
// for the type-filter dropdown. Filtering happens server-side via `?type=`.
const TYPE_GROUPS: { labelKey: string; types: string[] }[] = [
  {
    labelKey: "notifications.groups.property",
    types: [
      "saved_search_new_match",
      "saved_search_price_drop",
      "saved_search_back_on_market",
      "saved_search_verified",
      "saved_search_detail_updated",
      "saved_search_digest",
    ],
  },
  { labelKey: "notifications.groups.leads", types: ["lead_message", "lead_status_update"] },
  {
    labelKey: "notifications.groups.system",
    types: ["review_status", "subscription_status", "ai_recommendation", "system_announcement"],
  },
];

function relativeTime(
  iso: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMins < 1) return t("notifications.justNow");
  if (diffMins < 60) return t("notifications.minutesAgo", { count: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t("notifications.hoursAgo", { count: diffHours });
  return t("notifications.daysAgo", { count: Math.floor(diffHours / 24) });
}

function groupKey(iso: string, t: (key: string) => string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diffDays <= 0) return t("notifications.groupToday");
  if (diffDays === 1) return t("notifications.groupYesterday");
  return t("notifications.groupEarlier");
}

function NotificationRow({
  item,
  path,
  onOpen,
  onDelete,
}: {
  item: ApiNotificationRecord;
  path: string | null;
  onOpen: (n: ApiNotificationRecord) => void;
  onDelete: (id: number) => void;
}) {
  const { t } = useLanguage();
  const Icon = iconFor(item.type);
  const unread = !item.read_at;
  const aiInsight = item.meta?.ai_explanation;

  const body = (
    <>
      <div
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-full",
          unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-bold">{item.title}</span>
          {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
        {aiInsight && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-ai/10 px-2.5 py-1.5 text-[11px] text-foreground">
            <Sparkles className="mt-0.5 size-3 shrink-0 text-ai" />
            <span>
              <span className="font-semibold text-ai">{t("notifications.aiInsightLabel")}: </span>
              {aiInsight}
            </span>
          </p>
        )}
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {relativeTime(item.created_at, t)}
        </span>
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-2xl border p-4 transition-colors",
        unread ? "border-primary/30 bg-primary/5" : "border-border bg-card",
      )}
    >
      {path ? (
        <Link
          to={path}
          onClick={() => onOpen(item)}
          className="flex flex-1 items-start gap-3 text-start"
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex flex-1 items-start gap-3 text-start"
        >
          {body}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDelete(item.id)}
        aria-label={t("notifications.delete")}
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function NotificationsPage() {
  const { user, authLoading, clearAuth, scope } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [items, setItems] = useState<ApiNotificationRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    fetchNotificationCenter({ limit: 25, type: typeFilter || undefined, unreadOnly })
      .then((res) => {
        setItems(res.items);
        setCursor(res.next_cursor);
        setUnreadCount(res.unread_count);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) clearAuth();
        else setError(t("notifications.unableToLoad"));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, typeFilter, unreadOnly]);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) setLoading(false);
      return;
    }
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, typeFilter, unreadOnly]);

  // Live refresh: any server-side "invalidate" event means something changed
  // for this user — refetch the first page (with current filters) so the
  // Notification Center stays current while it's open, plus the badge count.
  const streamEnabled = !!user && !user.is_admin;
  useNotificationStream(streamEnabled, loadFirstPage);

  function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    fetchNotificationCenter({ limit: 25, cursor, type: typeFilter || undefined, unreadOnly })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.next_cursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }

  function handleOpen(item: ApiNotificationRecord) {
    if (item.read_at) return;
    setItems((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    markNotificationRead(item.id).catch(() => {});
  }

  function handleDelete(id: number) {
    const removed = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.read_at) setUnreadCount((c) => Math.max(0, c - 1));
    deleteNotificationRecord(id).catch(() => toast.error(t("notifications.unableToLoad")));
  }

  function handleMarkAllRead() {
    const previous = items;
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {
      setItems(previous);
      toast.error(t("notifications.unableToLoad"));
    });
  }

  const sections = useMemo(() => {
    const groups = new Map<string, ApiNotificationRecord[]>();
    for (const item of items) {
      const key = groupKey(item.created_at, t);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries());
  }, [items, t]);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="container-page max-w-3xl py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {t("notifications.heading")}
          </h1>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
                {t("notifications.markAllRead")}
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link to="/notification-settings">
                <Settings className="size-3.5" />
                {t("notifications.settingsLink")}
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label={t("notifications.typeFilterLabel")}
            className="h-9 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface focus:border-primary"
          >
            <option value="">{t("notifications.filters.all")}</option>
            {TYPE_GROUPS.map((group) => (
              <optgroup key={group.labelKey} label={t(group.labelKey)}>
                {group.types.map((type) => (
                  <option key={type} value={type}>
                    {t(`notifications.types.${type}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            aria-pressed={unreadOnly}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              unreadOnly
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-surface",
            )}
          >
            {t("notifications.unreadOnly")}
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          {authLoading || loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))
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
          ) : sections.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title={t("notifications.empty")}
              description={t("notifications.emptyDesc")}
            />
          ) : (
            <>
              {sections.map(([key, rows]) => (
                <div key={key} className="flex flex-col gap-2 pb-2">
                  <h2 className="pt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {key}
                  </h2>
                  {rows.map((row) => (
                    <NotificationRow
                      key={row.id}
                      item={row}
                      path={deepLinkToPath(row.deep_link, scope)}
                      onOpen={handleOpen}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ))}
              {cursor && (
                <div className="flex justify-center pt-2">
                  <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore && <Loader2 className="size-4 animate-spin" />}
                    {t("search.loadMore")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
