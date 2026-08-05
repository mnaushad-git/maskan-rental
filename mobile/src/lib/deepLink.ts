/** Shared `myhome://...` deep-link → in-app route resolver.
 *
 * Used by both the Notification Center list (app/notifications.tsx, tapping
 * a row) and the global push-notification-tap listener (app/_layout.tsx) —
 * previously this logic lived only inside notifications.tsx as a private
 * `deepLinkToRoute()` function; extracted here so both call sites stay in
 * sync as new notification types/routes are added.
 */
export function deepLinkToRoute(deepLink: string | null | undefined): string | null {
  if (!deepLink) return null;
  const match = deepLink.match(/^myhome:\/\/(.+)$/);
  if (!match) return null;
  const path = match[1];
  if (path.startsWith("property/")) return `/${path}`;
  if (path.startsWith("saved-searches/")) return "/saved-searches";
  if (path.startsWith("lead/")) return `/${path}`;
  // property-requests/{id}/matches/{matchId} -> detail screen, scrolled to
  // that match; property-requests/{id} -> plain detail screen.
  const matchMatch = path.match(/^property-requests\/(\d+)\/matches\/(\d+)$/);
  if (matchMatch) return `/property-requests/${matchMatch[1]}?matchId=${matchMatch[2]}`;
  const requestMatch = path.match(/^property-requests\/(\d+)$/);
  if (requestMatch) return `/property-requests/${requestMatch[1]}`;
  return null;
}
