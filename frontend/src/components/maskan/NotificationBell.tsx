import { Bell, BellOff, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  fetchNotificationCenter,
  fetchUnreadNotificationCount,
  markNotificationRead,
  type ApiNotificationRecord,
} from "@/lib/api/maskan";
import { useLanguage } from "@/lib/i18n/context";
import { deepLinkToPath, iconFor } from "@/lib/notificationDisplay";
import { useNotificationStream } from "@/lib/useNotificationStream";

// Safety-net poll — SSE (useNotificationStream) catches the fast case, this
// is only here to cover a permanently-broken SSE connection or a missed
// event, per this app's "preserve polling fallback" convention. Lengthened
// from the pre-SSE 60s now that live invalidation handles the common case.
const POLL_MS = 180_000;
const PREVIEW_LIMIT = 6;

/** Generic Notification Center bell — desktop dropdown preview + link to the
 * full page (see routes/notifications.tsx). Backed by the same
 * `/notifications` API the mobile app and full page use, so read/unread
 * state stays consistent everywhere. Admins get no bell here (they have
 * their own inbox UI in the admin console). Refreshes live via SSE
 * (useNotificationStream), with polling as a fallback safety net. */
export function NotificationBell() {
  const { user, scope } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ApiNotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const refreshPreview = useCallback(() => {
    fetchNotificationCenter({ limit: PREVIEW_LIMIT })
      .then((res) => {
        setItems(res.items);
        setUnread(res.unread_count);
      })
      .catch(() => {});
  }, []);

  const refreshUnreadOnly = useCallback(() => {
    // Live "invalidate" events fire for any notification change; if the
    // dropdown isn't open we only need the badge count, not the full list.
    if (openRef.current) {
      refreshPreview();
      return;
    }
    fetchUnreadNotificationCount()
      .then((res) => setUnread(res.unread_count))
      .catch(() => {});
  }, [refreshPreview]);

  const streamEnabled = !!user && !user.is_admin;
  useNotificationStream(streamEnabled, refreshUnreadOnly);

  useEffect(() => {
    if (!user || user.is_admin) return;
    refreshPreview();
    intervalRef.current = setInterval(refreshPreview, POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user, refreshPreview]);

  if (!user || user.is_admin) return null;

  function handleOpen() {
    setOpen((v) => !v);
    if (!open) refreshPreview();
  }

  function handleItemClick(item: ApiNotificationRecord) {
    setOpen(false);
    if (!item.read_at) {
      setItems((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnread((c) => Math.max(0, c - 1));
      markNotificationRead(item.id).catch(() => {});
    }
  }

  function formatTime(iso: string) {
    const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMins < 1) return t("notifications.justNow");
    if (diffMins < 60) return t("notifications.minutesAgo", { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("notifications.hoursAgo", { count: diffHours });
    return t("notifications.daysAgo", { count: Math.floor(diffHours / 24) });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={t("notifications.ariaLabel", { count: unread })}
        className="relative grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            aria-label={t("notifications.closeAria")}
          />
          <div className="absolute end-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-border bg-popover shadow-elevated">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="font-semibold text-sm">{t("notifications.heading")}</h3>
              {unread > 0 && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">
                  {t("notifications.unread", { count: unread })}
                </span>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BellOff className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t("notifications.empty")}</p>
              </div>
            ) : (
              <div className="max-h-96 divide-y divide-border overflow-y-auto">
                {items.map((n) => {
                  const Icon = iconFor(n.type);
                  const path = deepLinkToPath(n.deep_link, scope);
                  const unreadItem = !n.read_at;
                  const content = (
                    <>
                      <div className="relative mt-0.5 shrink-0">
                        <div
                          className={`grid size-9 place-items-center rounded-full ${unreadItem ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted-foreground"}`}
                        >
                          <Icon className="size-4" />
                        </div>
                        {unreadItem && (
                          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-popover" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className="text-xs font-semibold truncate">{n.title}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatTime(n.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {n.body}
                        </p>
                        {n.meta?.ai_explanation && (
                          <p className="mt-1 flex items-start gap-1 text-[11px] text-ai">
                            <Sparkles className="mt-0.5 size-3 shrink-0" />
                            <span className="line-clamp-1">{n.meta.ai_explanation}</span>
                          </p>
                        )}
                      </div>
                    </>
                  );
                  return path ? (
                    <Link
                      key={n.id}
                      to={path}
                      onClick={() => handleItemClick(n)}
                      className="flex gap-3 px-4 py-3.5 hover:bg-surface transition-colors"
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className="flex w-full gap-3 px-4 py-3.5 text-start hover:bg-surface transition-colors"
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="border-t border-border px-4 py-2.5">
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t("notifications.viewAll")}
              </Link>
              <Link
                to="/notification-settings"
                onClick={() => setOpen(false)}
                className="ms-4 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("notifications.settingsLink")}
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
