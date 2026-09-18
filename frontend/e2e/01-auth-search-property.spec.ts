import { test, expect } from "@playwright/test";
import { CUSTOMER_A, PROPERTIES, loginAsCustomer, waitForHydration } from "./fixtures";

/**
 * Prompt 17 item 1: Customer login → Rent search → Property.
 *
 * Also covers the invalid-credentials path (a real, not-just-inspected login
 * failure) since it's cheap to fold in here and both belong to the same
 * "auth + first search" journey.
 */

test.describe("Customer login → Rent search → Property", () => {
  test("rejects invalid credentials with an inline error, not a silent failure", async ({ page }) => {
    await page.goto("/auth");
    await waitForHydration(page);
    await page.getByTestId("auth-email").fill(CUSTOMER_A.email);
    await page.getByTestId("auth-password").fill("wrong-password-123");
    await page.getByTestId("auth-submit").click();

    await expect(page.getByText(/invalid|incorrect|credentials/i)).toBeVisible();
    // Must NOT have navigated away from /auth on a failed login.
    await expect(page).toHaveURL(/\/auth/);
  });

  test("logs in, searches Rent in Riyadh, and opens a real property", async ({ page }) => {
    await loginAsCustomer(page);

    await page.goto("/search?listingType=rent&city=Riyadh");
    await waitForHydration(page);
    // Default view is "map" — switch to List so result cards are real DOM
    // links rather than markers inside a map widget.
    await page.getByRole("button", { name: "List view" }).click();

    const card = page.getByRole("link").filter({ hasText: PROPERTIES.RENT_COMPLETE.title });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();

    await page.waitForURL(new RegExp(`/property/${PROPERTIES.RENT_COMPLETE.id}$`));
    await expect(page.getByText(PROPERTIES.RENT_COMPLETE.title)).toBeVisible();
    // SAR 8,500/month fixture rent — sanity-checks the card→detail data is
    // the same property, not a mismatched id.
    await expect(page.getByText(/SAR 8,500\/month/)).toBeVisible();
  });
});
