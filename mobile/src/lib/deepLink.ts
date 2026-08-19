/** Shared deep-link → in-app route resolver.
 *
 * Used by both the Notification Center list (app/notifications.tsx, tapping
 * a row) and the global push-notification-tap listener (app/_layout.tsx) —
 * previously this logic lived only inside notifications.tsx as a private
 * `deepLinkToRoute()` function; extracted here so both call sites stay in
 * sync as new notification types/routes are added.
 *
 * **Two schemes in the wild (Prompt 12 fix):** older notification types
 * (leads, saved searches, property requests) emit `myhome://…`; viewing and
 * negotiation notifications (backend/app/tasks/viewing_notifications.py,
 * negotiation_notifications.py) emit `mymakan://…` — a scheme this resolver
 * never accepted, so tapping a viewing/negotiation push silently did
 * nothing. Both schemes are accepted below.
 */
export function deepLinkToRoute(deepLink: string | null | undefined): string | null {
  if (!deepLink) return null;
  const match = deepLink.match(/^(?:myhome|mymakan):\/\/(.+)$/);
  if (!match) return null;
  const path = match[1];
  if (path.startsWith("property/")) return `/${path}`;
  if (path.startsWith("saved-searches/")) return "/saved-searches";
  if (path.startsWith("lead/")) return `/${path}`;
  // Viewing/negotiation notifications always carry the partner-prefixed
  // deep link string (mymakan://partner/viewings/{id},
  // mymakan://partner/negotiations/{id}) regardless of recipient — mobile
  // has no partner portal at all (customer-only app, see tracking doc), so
  // both variants always resolve to the customer detail screen here.
  const viewingMatch = path.match(/^(?:partner\/)?viewings\/(\d+)$/);
  if (viewingMatch) return `/viewings/${viewingMatch[1]}`;
  const negotiationMatch = path.match(/^(?:partner\/)?negotiations\/(\d+)$/);
  if (negotiationMatch) return `/negotiations/${negotiationMatch[1]}`;
  // property-requests/{id}/matches/{matchId} -> detail screen, scrolled to
  // that match; property-requests/{id} -> plain detail screen.
  const matchMatch = path.match(/^property-requests\/(\d+)\/matches\/(\d+)$/);
  if (matchMatch) return `/property-requests/${matchMatch[1]}?matchId=${matchMatch[2]}`;
  const requestMatch = path.match(/^property-requests\/(\d+)$/);
  if (requestMatch) return `/property-requests/${requestMatch[1]}`;
  return null;
}
