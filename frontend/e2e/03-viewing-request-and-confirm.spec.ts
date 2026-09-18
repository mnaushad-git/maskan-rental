import { test, expect, type Page } from "@playwright/test";
import {
  CUSTOMER_STORAGE_STATE,
  PARTNER_STORAGE_STATE,
  PROPERTIES,
  cancelViewingBestEffort,
  idFromHref,
  waitForHydration,
} from "./fixtures";

/**
 * Prompt 17 items 3 + 4: Property → Viewing request (customer), then
 * Partner → Viewing confirmation.
 *
 * Uses property 15501 ("P10 Test Rent Apartment") — the one fixture the
 * ledger explicitly earmarks as untouched (zero viewings/negotiations as of
 * Prompt 16), so this test creates a brand-new viewing rather than fighting
 * over already-terminal fixture state on 14377/14379. Runs the customer and
 * partner (Mediator A, who owns this property) sides in two independent
 * browser contexts so each keeps its own portal-scoped session
 * (see lib/auth-storage.ts — /partner/* and the rest of the site are
 * deliberately separate localStorage namespaces).
 */

async function pickFirstAvailableDay(page: Page) {
  // react-day-picker gives every day button (enabled AND disabled) a full
  // descriptive ACCESSIBLE NAME via aria-label (e.g. "Today, Friday,
  // September 18th, 2026" or "Saturday, September 19th, 2026") — only the
  // rendered TEXT CONTENT is the bare day-of-month number, so filter on
  // `hasText` (text content), not `getByRole(..., { name })` (accessible
  // name), to find the day cells at all. "before today" is disabled per the
  // modal's own `disabled={{ before: today }}`, so the first ENABLED one in
  // the visible month is always a valid, clickable future date (the
  // prev/next-month nav buttons don't have bare-digit text, so they're
  // naturally excluded by the same filter).
  const calendar = page.getByTestId("viewing-date-calendar");
  const dayButtons = calendar.locator("button").filter({ hasText: /^\d{1,2}$/ });
  const count = await dayButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = dayButtons.nth(i);
    if (await btn.isEnabled()) {
      await btn.click();
      return;
    }
  }
  throw new Error("No enabled day button found in the viewing modal calendar");
}

test("customer requests a viewing and the owning mediator confirms it", async ({ browser }) => {
  // Both sessions come from global-setup.ts's storageState — no live login
  // here, keeping this test's contribution to the shared login rate limit
  // at zero (login itself is already covered by spec 01).
  const customerCtx = await browser.newContext({ storageState: CUSTOMER_STORAGE_STATE });
  const partnerCtx = await browser.newContext({ storageState: PARTNER_STORAGE_STATE });
  const customerPage = await customerCtx.newPage();
  const partnerPage = await partnerCtx.newPage();

  let viewingId: string | undefined;

  try {
    await test.step("customer: request a viewing on property 15501", async () => {
      await customerPage.goto(`/property/${PROPERTIES.RENT_FRESH.id}`);
      await waitForHydration(customerPage);
      await expect(customerPage.getByText(PROPERTIES.RENT_FRESH.title)).toBeVisible();

      const modal = customerPage.getByTestId("viewing-modal");
      await customerPage.getByRole("button", { name: "Schedule viewing" }).click();
      await expect(modal).toBeVisible();

      await pickFirstAvailableDay(customerPage);
      await modal.getByRole("button", { name: "Next", exact: true }).click(); // date -> time

      await customerPage.getByTestId("viewing-time-slots").getByRole("button").first().click();
      await modal.getByRole("button", { name: "Next", exact: true }).click(); // time -> note

      await customerPage
        .getByPlaceholder(/anything the mediator should know/i)
        .fill("E2E Prompt 17 automated viewing request.");
      await modal.getByRole("button", { name: "Next", exact: true }).click(); // note -> review

      await modal.getByRole("button", { name: "Request viewing" }).click();

      // On success the modal closes and the ActionsCard's CTA swaps to a real
      // "View appointment" link carrying the new viewing's id.
      await expect(modal).not.toBeVisible({ timeout: 15_000 });
      // Desktop sidebar + the mobile sticky action bar both render this same
      // link (same href) — .first() is fine, they're never inconsistent.
      const viewLink = customerPage.getByRole("link", { name: "View appointment" }).first();
      await expect(viewLink).toBeVisible();
      const href = await viewLink.getAttribute("href");
      viewingId = idFromHref(href);
      expect(Number(viewingId)).toBeGreaterThan(0);
    });

    await test.step("partner: confirm the viewing as Mediator A (the owning mediator)", async () => {
      await partnerPage.goto(`/partner/viewings/${viewingId}`);
      await waitForHydration(partnerPage);
      await expect(partnerPage.getByText(PROPERTIES.RENT_FRESH.title)).toBeVisible({ timeout: 15_000 });

      const confirmButton = partnerPage.getByRole("button", { name: "Confirm Viewing" });
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();

      // Status should flip to Confirmed and the Confirm action disappear.
      await expect(partnerPage.getByText(/Confirmed/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(confirmButton).not.toBeVisible();
    });

    await test.step("customer: sees the viewing is now confirmed", async () => {
      await customerPage.reload();
      await waitForHydration(customerPage);
      await expect(customerPage.getByText(/Confirmed/i).first()).toBeVisible({ timeout: 15_000 });
    });
  } finally {
    // Teardown: a "confirmed" viewing is NOT terminal, so leaving it behind
    // would block this exact test's "Schedule viewing" CTA on its next run
    // against this same shared dev DB (see fixtures.ts). Best-effort and
    // outside any assertion — a cleanup failure must never mask a real test
    // failure above it.
    if (viewingId) await cancelViewingBestEffort(customerPage, viewingId);
    await customerCtx.close();
    await partnerCtx.close();
  }
});
