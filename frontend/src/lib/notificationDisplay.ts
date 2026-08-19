// Shared notification-center display helpers — used by both the bell
// dropdown (components/maskan/NotificationBell.tsx) and the full Notification
// Center page (routes/notifications.tsx) so icon/category/deep-link logic
// only lives in one place.
import {
  Bell,
  Home,
  Megaphone,
  MessageSquare,
  RefreshCw,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import type { PortalScope } from "@/lib/auth-storage";

export type NotificationCategoryFilter = "all" | "property" | "leads" | "system";

export function categoryOf(type: string): NotificationCategoryFilter {
  if (type.startsWith("saved_search_")) return "property";
  if (type.startsWith("lead_")) return "leads";
  return "system";
}

export function iconFor(type: string): LucideIcon {
  if (type === "saved_search_price_drop") return TrendingDown;
  if (
    type === "saved_search_new_match" ||
    type === "saved_search_back_on_market" ||
    type === "saved_search_verified" ||
    type === "saved_search_detail_updated"
  )
    return Home;
  if (type === "lead_message") return MessageSquare;
  if (type === "lead_status_update") return RefreshCw;
  if (type === "saved_search_digest") return Bell;
  return Megaphone;
}

/**
 * Resolves a notification's deep link to an in-app path.
 *
 * `scope` is the viewer's active portal (customer vs partner/mediator) —
 * `lead/*` deep links resolve to different lead-detail routes depending on
 * who's looking: customers own leads via /lead/$leadId, mediators work leads
 * via /partner/leads/$leadId. Pass `useAuth().scope` from the caller.
 *
 * **Two schemes in the wild (Prompt 12 fix):** older notification types
 * (leads, saved searches, property requests — app/tasks/lead_notifications.py,
 * notifications.py) emit `myhome://…`; viewing and negotiation notifications
 * (app/tasks/viewing_notifications.py, negotiation_notifications.py) emit
 * `mymakan://…` — a scheme that was never added here, so tapping/clicking a
 * viewing or negotiation notification silently did nothing (deepLinkToPath
 * returned null for every one of them). Both schemes are accepted below
 * rather than touching five already-shipped backend notification renderers
 * for a cosmetic scheme-name mismatch.
 */
export function deepLinkToPath(deepLink: string | null, scope: PortalScope): string | null {
  if (!deepLink) return null;
  const match = deepLink.match(/^(?:myhome|mymakan):\/\/(.+)$/);
  if (!match) return null;
  const path = match[1];
  if (path.startsWith("property/")) return `/${path}`;
  if (path.startsWith("saved-searches/")) return "/saved-searches";
  if (path.startsWith("lead/")) {
    const leadId = path.slice("lead/".length);
    if (!leadId) return null;
    return scope === "partner" ? `/partner/leads/${leadId}` : `/lead/${leadId}`;
  }
  // Viewing/negotiation notifications always carry the partner-prefixed
  // deep link string, regardless of which side (customer or mediator) is
  // the actual recipient (see viewing_notifications.py/
  // negotiation_notifications.py's own "left as-is" note) — resolved here
  // per-viewer scope, same idiom as lead/ above, rather than teaching the
  // backend event payload which recipient it's rendering for.
  const viewingMatch = path.match(/^(?:partner\/)?viewings\/(\d+)$/);
  if (viewingMatch) {
    return scope === "partner" ? `/partner/viewings/${viewingMatch[1]}` : `/viewings/${viewingMatch[1]}`;
  }
  const negotiationMatch = path.match(/^(?:partner\/)?negotiations\/(\d+)$/);
  if (negotiationMatch) {
    return scope === "partner" ? `/partner/negotiations/${negotiationMatch[1]}` : `/negotiations/${negotiationMatch[1]}`;
  }
  return null;
}
