import { test, expect } from "@playwright/test";
import { CUSTOMER_STORAGE_STATE, waitForHydration } from "./fixtures";

/**
 * Prompt 17 item 2: AI Home Finder → Property Intelligence.
 *
 * Runs a real natural-language query through the actual AI interpretation +
 * deterministic search endpoints (no mocking) — verifies NL → criteria →
 * ranked results → clicking into a result lands on a real property page with
 * its Property Intelligence section rendered. Starts pre-authenticated via
 * global-setup.ts's storageState — login itself is already covered by spec
 * 01, and re-driving it here would just spend more of the shared login rate
 * limit for no extra coverage.
 */

test.use({ storageState: CUSTOMER_STORAGE_STATE });

test("AI Home Finder interprets a real query and hands off into Property Intelligence", async ({ page }) => {
  await page.goto("/home-finder");
  await waitForHydration(page);

  await page.getByRole("button", { name: "Rent", exact: true }).click();
  await page
    .getByPlaceholder(/3-bedroom apartment for my family/i)
    .fill("I need a 3 bedroom apartment to rent in Riyadh, ideally in Al Yasmin, with parking.");
  await page.getByRole("button", { name: "Find My Best Matches" }).click();

  // Step 2: "Here is what myMakan understood" — the AI's structured criteria,
  // editable before the deterministic search actually runs.
  await expect(page.getByText("Here is what myMakan understood")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Find My Best Matches" }).click();

  // Step 3: ranked, deterministic results — real properties, not AI-invented ones.
  await expect(page.getByText("Best Matches for You")).toBeVisible({ timeout: 30_000 });
  const results = page.getByTestId("home-finder-results");
  await expect(results).toBeVisible();

  const firstResultLink = results.getByRole("link").first();
  await expect(firstResultLink).toBeVisible();
  await firstResultLink.click();

  await page.waitForURL(/\/property\/\d+$/);
  // Property Intelligence section — confirms the hand-off landed on a real
  // property detail page with intelligence data computed, not a blank/error page.
  await expect(page.getByText("Property Decision Score")).toBeVisible({ timeout: 15_000 });
});
