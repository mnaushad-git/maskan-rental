import { Bell, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { fetchNotifications, type ApiNotification } from "@/lib/api/maskan";

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user || user.is_admin) return;

    const poll = () => {
      fetchNotifications().then(setNotifications).catch(() => {});
    };
    poll();
    intervalRef.current = setInterval(poll, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [user]);

  if (!user || user.is_admin) return null;

  const totalUnread = notifications.reduce((sum, n) => sum + n.unread_count, 0);

  function handleOpen() {
    setOpen(v => !v);
    // Refresh list when opening
    if (!open) {
      fetchNotifications().then(setNotifications).catch(() => {});
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString("en-SA", { day: "numeric", month: "short" });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative grid size-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
      >
        <Bell className="size-4" />
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close notifications"
          />
          <div className="absolute end-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-border bg-popover shadow-elevated">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="font-semibold text-sm">Notifications</h3>
              {totalUnread > 0 && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-white">
                  {totalUnread} unread
                </span>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Bell className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No new messages</p>
              </div>
            ) : (
              <div className="max-h-96 divide-y divide-border overflow-y-auto">
                {notifications.map(n => (
                  <Link
                    key={n.lead_id}
                    to="/lead/$leadId"
                    params={{ leadId: String(n.lead_id) }}
                    onClick={() => setOpen(false)}
                    className="flex gap-3 px-4 py-3.5 hover:bg-surface transition-colors"
                  >
                    <div className="relative mt-0.5 shrink-0">
                      <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                        <MessageSquare className="size-4" />
                      </div>
                      {n.unread_count > 1 && (
                        <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
                          {n.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-xs font-semibold truncate">{n.area_name}, {n.city}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{formatTime(n.latest_message_at)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {n.sender_role === "admin" ? "Maskan Team" : "Partner"}:
                        </span>{" "}
                        <span className="line-clamp-2">{n.latest_message}</span>
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <div className="border-t border-border px-4 py-2.5">
              <Link
                to="/my-leads"
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-primary hover:underline"
              >
                View all leads →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
