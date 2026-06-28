// Portal-scoped auth storage.
//
// Maskan has three independent portals served from one origin:
//   - admin   (/admin*)
//   - partner (/partner*)
//   - user    (everything else)
//
// Browser localStorage is shared across every tab on an origin, so a single
// shared token key would entangle the three portals: signing into admin in one
// tab would hijack the customer session in another. To keep them independent we
// namespace the stored credentials by portal, deriving the active portal from
// the URL path. Each portal therefore maintains its own login/logout lifecycle
// while still persisting across multiple tabs of the *same* portal.

export type PortalScope = "admin" | "partner" | "user";

export function portalScope(pathname: string): PortalScope {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/partner")) return "partner";
  return "user";
}

/** Active portal derived from the current browser location. */
export function currentScope(): PortalScope {
  if (typeof window === "undefined") return "user";
  return portalScope(window.location.pathname);
}

export function tokenKey(scope: PortalScope): string {
  return `maskan_${scope}_token`;
}

export function userKey(scope: PortalScope): string {
  return `maskan_${scope}_user`;
}

export function readStoredToken(scope: PortalScope): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tokenKey(scope));
}

export function readStoredUser<T>(scope: PortalScope): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(userKey(scope));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStoredAuth(scope: PortalScope, user: unknown, token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(userKey(scope), JSON.stringify(user));
  window.localStorage.setItem(tokenKey(scope), token);
}

export function clearStoredAuth(scope: PortalScope): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(userKey(scope));
  window.localStorage.removeItem(tokenKey(scope));
}
