import { test, expect } from "@playwright/test";
import {
  CUSTOMER_STORAGE_STATE,
  PARTNER_STORAGE_STATE,
  PROPERTIES,
  idFromHref,
  waitForHydration,
  withdrawNegotiationBestEffort,
} from "./fixtures";

/**
 * Prompt 17 items 5 + 6: Customer → Offer, then Partner → Counter/Accept.
 *
 * Uses property 15501 (same untouched rent fixture as spec 03, but this test
 * only touches its negotiations, never its viewings — independent resource,
 * safe to run in parallel with spec 03). Drives a fresh negotiation all the
 * way from submitted → countered → accepted so both the partner's Counter
 * action and the customer's resulting Accept action are exercised for real.
 */

test("customer submits an offer, mediator counters, customer accepts the counter", async ({ browser }) => {
  // Both sessions come from global-setup.ts's storageState — see spec 03's
  // comment; keeps this test's login rate-limit cost at zero.
  const customerCtx = await browser.newContext({ storageState: CUSTOMER_STORAGE_STATE });
  const partnerCtx = await browser.newContext({ storageState: PARTNER_STORAGE_STATE });
  const customerPage = await customerCtx.newPage();
  const partnerPage = await partnerCtx.newPage();

  let negotiationId: string | undefined;

  try {
    await test.step("customer: make an offer on property 15501", async () => {
      await customerPage.goto(`/property/${PROPERTIES.RENT_FRESH.id}`);
      await waitForHydration(customerPage);
      await expect(customerPage.getByText(PROPERTIES.RENT_FRESH.title)).toBeVisible();

      await customerPage.getByRole("button", { name: "Make an offer" }).click();
      const modal = customerPage.getByTestId("offer-modal");
      await expect(modal).toBeVisible();

      await modal.getByRole("button", { name: "Next", exact: true }).click(); // intelligence -> amount
      await modal.getByTestId("offer-amount-input").fill("65000");
      await modal.getByRole("button", { name: "Next", exact: true }).click(); // amount -> message
      await modal.getByRole("button", { name: "Next", exact: true }).click(); // message -> review
      await modal.getByRole("button", { name: "Submit offer" }).click();

      const viewNegotiationLink = modal.getByRole("link", { name: "View negotiation" });
      await expect(viewNegotiationLink).toBeVisible({ timeout: 15_000 });
      const href = await viewNegotiationLink.getAttribute("href");
      negotiationId = idFromHref(href);
      expect(Number(negotiationId)).toBeGreaterThan(0);
    });

    await test.step("partner: counter the offer as Mediator A", async () => {
      await partnerPage.goto(`/partner/negotiations/${negotiationId}`);
      await waitForHydration(partnerPage);
      await expect(partnerPage.getByText("Countered").or(partnerPage.getByText("Offer Submitted"))).toBeVisible({
        timeout: 15_000,
      });

      await partnerPage.getByRole("button", { name: "Counter Offer" }).click();
      const counterModal = partnerPage.getByTestId("partner-counter-modal");
      await expect(counterModal).toBeVisible();
      await counterModal.getByTestId("partner-counter-amount-input").fill("67000");
      await counterModal.getByRole("button", { name: "Send counter-offer" }).click();

      await expect(counterModal).not.toBeVisible({ timeout: 15_000 });
      await expect(partnerPage.getByText("Countered")).toBeVisible();
    });

    await test.step("customer: sees the mediator's counter and accepts it", async () => {
      await customerPage.goto(`/negotiations/${negotiationId}`);
      await waitForHydration(customerPage);
      await expect(customerPage.getByText("Countered")).toBeVisible({ timeout: 15_000 });

      const acceptButton = customerPage.getByRole("button", { name: "Accept Offer" });
      await expect(acceptButton).toBeVisible();
      await acceptButton.click();

      await expect(customerPage.getByText("Accepted", { exact: true })).toBeVisible({ timeout: 15_000 });
      // Final agreed amount is the mediator's counter (67,000), not the
      // customer's original 65,000 offer — this figure legitimately repeats
      // across the page (offer block, timeline, summary), so .first() suffices.
      await expect(customerPage.getByText(/67,000/).first()).toBeVisible();

      // Immutability: an already-accepted negotiation must not offer a Counter
      // action any more (illegal transition: accepted -> counter).
      await expect(customerPage.getByRole("button", { name: "Counter Again" })).not.toBeVisible();
    });
  } finally {
    // Teardown: best-effort only. If this test reached "accepted", the
    // negotiation is terminal and withdrawal is a harmless no-op (accepted
    // negotiations don't block a future run's "Make an offer" CTA anyway —
    // see property_negotiation.py's find_active_negotiation). If a failure
    // above left it "submitted"/"countered" instead, this is what stops
    // that partial failure from also permanently blocking every subsequent
    // run against this same shared dev DB.
    if (negotiationId) await withdrawNegotiationBestEffort(customerPage, negotiationId);
    await customerCtx.close();
    await partnerCtx.close();
  }
});
