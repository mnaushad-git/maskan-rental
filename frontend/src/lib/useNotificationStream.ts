import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api") as string;

// EventSource auto-reconnects on its own after a dropped connection, but if
// the endpoint is permanently unreachable (backend down, bad token, etc.) it
// will keep retrying forever with the browser's default (short) retry
// interval, hammering the server. This is a safety net on top of that: after
// this many consecutive errors we stop retrying altogether and let the
// caller's polling fallback carry the UI instead.
const MAX_CONSECUTIVE_ERRORS = 5;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * Opens a live SSE connection to `/notifications/stream` while a user is
 * authenticated, invoking `onInvalidate` whenever the server emits an
 * `invalidate` event (i.e. "go refetch unread-count / the notification
 * list"). This is purely additive — callers should keep their existing
 * polling fallback running, since native EventSource + this hook's own
 * backoff safety net still leave a (rare) permanently-failed-connection case
 * where only polling keeps the UI fresh.
 *
 * Auth: the browser's EventSource API can't send custom headers, so the
 * portal-scoped JWT is passed as a `?token=` query param instead (this is
 * the documented, intended use of that endpoint's query-param auth).
 */
export function useNotificationStream(enabled: boolean, onInvalidate: () => void): void {
  const { token } = useAuth();
  const onInvalidateRef = useRef(onInvalidate);
  onInvalidateRef.current = onInvalidate;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") return;
    if (!token) return;

    let es: EventSource | null = null;
    let closed = false;
    let errorCount = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;
      const url = `${API_BASE_URL}/notifications/stream?token=${encodeURIComponent(token as string)}`;
      es = new EventSource(url);

      es.addEventListener("connected", () => {
        errorCount = 0;
      });

      es.addEventListener("invalidate", () => {
        onInvalidateRef.current();
      });

      es.onerror = () => {
        errorCount += 1;
        if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
          // Give up — stop the native auto-reconnect loop and rely on the
          // caller's polling fallback from here on out.
          es?.close();
          es = null;
          return;
        }
        // Native EventSource already auto-reconnects on its own after an
        // error, but on some browsers that retry can be immediate and tight.
        // Force a clean reconnect with our own capped backoff instead.
        es?.close();
        es = null;
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (errorCount - 1), BACKOFF_MAX_MS);
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
    // Re-opens whenever `enabled` or `token` changes — covers login, logout,
    // and switching accounts without a full page reload.
  }, [enabled, token]);
}
