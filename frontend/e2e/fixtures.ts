/**
 * Shared fixture constants + small helpers for the Prompt 17 Playwright suite.
 *
 * All fixture data here was created by earlier prompts in
 * docs/testing/mymakan-e2e-test-prompts.md and is documented in
 * docs/testing/mymakan-e2e-test-report.md §3 ("Test accounts & fixtures") —
 * this file does not create fixtures, it only points tests at the existing,
 * known-stable ones so the suite doesn't depend on fragile query-time lookups.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

// frontend/package.json has "type": "module", so this file runs as ESM —
// no __dirname global; derive it from import.meta.url instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Written once per run by global-setup.ts — pass these to
 * `test.use({ storageState })` or `browser.newContext({ storageState })` to
 * start a test already logged in, without spending another call against the
 * shared login rate limit (see global-setup.ts for the full rationale). */
export const CUSTOMER_STORAGE_STATE = path.join(__dirname, ".auth", "customer.json");
export const PARTNER_STORAGE_STATE = path.join(__dirname, ".auth", "partner.json");

export const PASSWORD = "E2eTest@123";

export const CUSTOMER_A = {
  email: "e2e.customera@mymakantest.local",
  password: PASSWORD,
  userId: 19777,
};

export const CUSTOMER_B = {
  email: "e2e.customerb@mymakantest.local",
  password: PASSWORD,
  userId: 19778,
};

export const MEDIATOR_A = {
  email: "e2e.mediatora@mymakantest.local",
  password: PASSWORD,
};

// Backend base URL for direct API calls (unauthorized-access spec). Mirrors
// frontend/.env.local's VITE_API_BASE_URL — see docs/testing/mymakan-e2e-test-report.md
// §0's "known environment quirk" note (port 8010 has a stuck socket on this
// machine; 8000 is the real local backend).
// Trailing slash matters: Playwright's APIRequestContext resolves relative
// request paths against baseURL using standard URL-join rules — without it,
// a request for e.g. "auth/login" would resolve to ".../login" (dropping
// "/api" entirely) instead of ".../api/auth/login". Callers should also use
// PATHS WITHOUT a leading "/" for the same reason (a leading "/" resets to
// the origin root, discarding "/api" regardless of the trailing slash here).
export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://localhost:8000/api/";

/** Frontend origin — must match playwright.config.ts's baseURL exactly
 * (including port), since global-setup.ts's storageState localStorage
 * entries are only replayed by the browser for a matching origin. */
export const FRONTEND_ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:8083";

export const PROPERTIES = {
  /** "E2E Complete Rent — Al Yasmin 3BR Apartment" — 100/100 complete, rent, SAR 8,500/month. */
  RENT_COMPLETE: { id: 14377, title: "E2E Complete Rent" },
  /** "E2E Complete Sale — Al Yasmin 4BR Villa" — 100/100 complete, sale, SAR 2,200,000. */
  SALE_COMPLETE: { id: 14379, title: "E2E Complete Sale" },
  /** Prompt 10 residual fixture, rent, zero viewings/negotiations as of Prompt 16 —
   * the one property in this ledger explicitly earmarked for a fresh lifecycle. */
  RENT_FRESH: { id: 15501, title: "P10 Test Rent Apartment" },
};

/** Negotiation 3131 (property 14377) — accepted in Prompt 6, its transaction
 * (1250) driven to "Ready for Rental Contract Process" in Prompt 7. Read-only
 * verifiable per the ledger's own note — this suite never mutates it. */
export const RENT_ACCEPTED_NEGOTIATION_ID = 3131;

/**
 * Waits until React has actually hydrated the page, not just until the SSR
 * shell has painted.
 *
 * This app (TanStack Start) server-renders real, data-populated HTML —
 * headings/counts/forms all appear immediately, well before client JS has
 * attached any event handlers. A click that lands in that window is
 * silently swallowed (no listener yet) or, for a controlled input, its
 * typed value gets wiped the moment hydration's first reconcile snaps the
 * DOM back to React's (still-empty) state. `networkidle` is unreliable here
 * because data-heavy pages (the map / AI search) keep background network
 * activity alive well past hydration. Checking for React's own internal
 * fiber marker on a real interactive element is a generic, non-invasive
 * signal that hydration's initial commit has actually run.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("button, a, input, textarea");
      if (!el) return false;
      return Object.keys(el).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
    },
    // `waitForFunction(pageFunction, arg, options)` — the timeout MUST go in
    // the 3rd (options) position; passing it as the 2nd argument silently
    // becomes the page function's `arg` instead, leaving this at whatever
    // the config's default actionTimeout is (10s — too tight for the
    // heavier, data/map-laden pages under load).
    undefined,
    { timeout: 20_000 },
  );
}

export async function loginAsCustomer(
  page: Page,
  creds: { email: string; password: string } = CUSTOMER_A,
): Promise<void> {
  await page.goto("/auth");
  await waitForHydration(page);
  await page.getByTestId("auth-email").fill(creds.email);
  await page.getByTestId("auth-password").fill(creds.password);
  await page.getByTestId("auth-submit").click();
  // Successful login navigates to "/" (see routes/auth.tsx handleSubmit).
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
}

export async function loginAsPartner(
  page: Page,
  creds: { email: string; password: string } = MEDIATOR_A,
): Promise<void> {
  await page.goto("/partner");
  await waitForHydration(page);
  // PartnerLoginGate (routes/partner.tsx) — only rendered when logged out.
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);
    await page.getByRole("button", { name: "Sign in to Partner Portal" }).click();
  }
}

/** Reads the access token back out of a storageState file written by
 * global-setup.ts — lets an API-only spec (e.g. the unauthorized-access
 * sweep) reuse Customer A's already-established session instead of
 * spending another call against the shared login rate limit. */
export function readStoredAccessToken(storageStatePath: string, tokenKey: string): string {
  const state = JSON.parse(fs.readFileSync(storageStatePath, "utf-8"));
  const entry = state.origins?.[0]?.localStorage?.find((e: { name: string }) => e.name === tokenKey);
  if (!entry) throw new Error(`No "${tokenKey}" entry found in ${storageStatePath}`);
  return entry.value as string;
}

/**
 * Best-effort teardown so re-running this suite against the SAME shared dev
 * database doesn't get progressively blocked by its own previous runs.
 *
 * `RENT_FRESH` (15501) has zero viewings/negotiations by design (per the
 * ledger) specifically so a test can drive it through a full fresh
 * lifecycle — but "confirmed" viewings and "submitted"/"countered"
 * negotiations are NOT terminal states, so leaving one behind blocks the
 * next run's "Schedule viewing"/"Make an offer" CTA from ever appearing
 * again (accepted negotiations ARE terminal and harmless to leave, per
 * `find_active_negotiation()` — this cleanup is a no-op, not a workaround,
 * for that case). Uses the page's own already-authenticated session
 * (reads the token straight out of localStorage) rather than a second
 * login, so it costs nothing against the shared login rate limit. Failures
 * are swallowed deliberately — e.g. a negotiation that DID reach "accepted"
 * genuinely can't be withdrawn any more, and that's success, not an error.
 */
export async function withdrawNegotiationBestEffort(page: Page, negotiationId: string): Promise<void> {
  try {
    const token = await page.evaluate(() => localStorage.getItem("maskan_user_token"));
    if (!token) return;
    await page.request.post(`${API_BASE_URL}negotiations/${negotiationId}/withdraw`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { reason: "E2E Prompt 17 suite cleanup — resetting fixture for the next run" },
      failOnStatusCode: false,
    });
  } catch {
    // Best-effort only.
  }
}

export async function cancelViewingBestEffort(page: Page, viewingId: string): Promise<void> {
  try {
    const token = await page.evaluate(() => localStorage.getItem("maskan_user_token"));
    if (!token) return;
    await page.request.post(`${API_BASE_URL}viewings/${viewingId}/cancel`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { reason: "Plans changed" },
      failOnStatusCode: false,
    });
  } catch {
    // Best-effort only.
  }
}

/** Extracts the trailing numeric id from a route like "/negotiations/3184" or
 * "/viewings/987" — used to hop from a customer-side confirmation link straight
 * to the matching partner-portal URL without re-deriving the id via a list scan. */
export function idFromHref(href: string | null): string {
  if (!href) throw new Error("Expected an href with a trailing numeric id, got null");
  const match = href.match(/(\d+)\/?$/);
  if (!match) throw new Error(`Could not extract a numeric id from href: ${href}`);
  return match[1];
}
