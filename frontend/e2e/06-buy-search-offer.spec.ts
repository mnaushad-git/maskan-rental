import { test, expect } from "@playwright/test";
import { CUSTOMER_STORAGE_STATE, PROPERTIES, idFromHref, waitForHydration, withdrawNegotiationBestEffort } from "./fixtures";

test.use({ storageState: CUSTOMER_STORAGE_STATE });

/**
 * Prompt 17 item 8: Buy search → Property → Offer flow.
 *
 * Uses property 14379 ("E2E Complete Sale — Al Yasmin 4BR Villa"). Its only
 * existing negotiation (3695) is already `accepted` — a terminal status
 * excluded from `find_active_negotiation()` (see
 * backend/app/services/property_negotiation.py), so the property's "Make an
 * offer" CTA is fresh for Customer A and this spec's new offer is additive,
 * never touching the Prompt 8 fixture's own accepted negotiation/transaction.
 */

test("customer searches Buy, opens the sale fixture, and submits a purchase offer", async ({ page }) => {
  let negotiationId: string | undefined;

  try {
    await page.goto("/search?listingType=sale&city=Riyadh");
    await waitForHydration(page);
    const card = page.getByRole("link").filter({ hasText: PROPERTIES.SALE_COMPLETE.title });
    await page.getByRole("button", { name: "List view" }).click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    await page.waitForURL(new RegExp(`/property/${PROPERTIES.SALE_COMPLETE.id}$`));
    await expect(page.getByText(PROPERTIES.SALE_COMPLETE.title)).toBeVisible();
    // Buy-specific: sale price shown (scoped to the actions sidebar — "Sale
    // price" is also a label on unrelated search-result cards elsewhere in
    // the DOM), no rent-only wording on this screen.
    await expect(page.locator("aside").getByText("Sale price")).toBeVisible();
    await expect(page.getByText(/monthly rent|annual rent/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Make an offer" }).click();
    const modal = page.getByTestId("offer-modal");
    await expect(modal).toBeVisible();

    await modal.getByRole("button", { name: "Next", exact: true }).click(); // intelligence -> amount
    await modal.getByTestId("offer-amount-input").fill("2100000");
    await modal.getByRole("button", { name: "Next", exact: true }).click(); // amount -> message
    await modal.getByRole("button", { name: "Next", exact: true }).click(); // message -> review

    // Review step shows the offer vs. listing price comparison before submit.
    await expect(modal.getByText(/2,100,000/)).toBeVisible();
    await modal.getByRole("button", { name: "Submit offer" }).click();

    const viewNegotiationLink = modal.getByRole("link", { name: "View negotiation" });
    await expect(viewNegotiationLink).toBeVisible({ timeout: 15_000 });
    negotiationId = idFromHref(await viewNegotiationLink.getAttribute("href"));
  } finally {
    // Teardown: "submitted" is NOT terminal — withdraw it so this test's
    // "Make an offer" CTA on property 14379 doesn't get permanently hidden
    // behind "View negotiation" the next time this suite runs against this
    // same shared dev DB (see fixtures.ts). Best-effort, outside any
    // assertion above.
    if (negotiationId) await withdrawNegotiationBestEffort(page, negotiationId);
  }
});
