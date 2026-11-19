// Shared admin-portal feedback helpers.
//
// Every admin login gate used to collapse *any* failure into "Invalid email or
// password." — so a rate limit (429), a disabled account (403), a server error
// (5xx) or the backend being unreachable all looked like a typo'd password.
// `loginErrorMessage` maps each case to an accurate, actionable message.

import { ApiError, UnauthorizedError } from "./api/maskan";

export function loginErrorMessage(err: unknown): string {
  if (err instanceof UnauthorizedError) return "Invalid email or password.";
  if (err instanceof ApiError) {
    if (err.status === 429) return "Too many sign-in attempts. Wait a few minutes and try again.";
    if (err.status === 403) return err.message || "This account is disabled. Contact support.";
    if (err.status === 422) return err.message || "Enter a valid email address and password.";
    if (err.status >= 500)
      return "The Maskan server had a problem signing you in. Try again shortly.";
    return err.message || "Sign-in failed. Try again.";
  }
  if (err instanceof TypeError) {
    return "Can't reach the Maskan server. Check your connection and try again.";
  }
  return "Sign-in failed. Try again.";
}

/** Human-readable message for a failed API call (load or action). */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof TypeError)
    return "Can't reach the Maskan server. Check your connection and try again.";
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Try again.";
}

/**
 * Confirmation step for consequential admin actions. Uses the native dialog
 * (consistent with the console's existing alert() feedback, and reliable on
 * every browser/screen-reader) rather than introducing a new modal system.
 */
export function confirmAdminAction(message: string): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(message);
}
