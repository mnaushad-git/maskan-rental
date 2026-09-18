import { test, expect } from "@playwright/test";
import { CUSTOMER_STORAGE_STATE, RENT_ACCEPTED_NEGOTIATION_ID, waitForHydration } from "./fixtures";

test.use({ storageState: CUSTOMER_STORAGE_STATE });

/**
 * Prompt 17 item 7: Customer → Transaction Workspace.
 *
 * Negotiation 3131 (property 14377) was accepted in Prompt 6 and its
 * auto-created transaction (1250) was already driven to
 * "Ready for Rental Contract Process" / 100% in Prompt 7 — the ledger (§3)
 * explicitly flags this as now terminal and "read-only-verifiable" rather
 * than a fresh in-progress fixture. This spec therefore does exactly that:
 * clicks "Continue Transaction" from the negotiation (which only looks up
 * the already-existing transaction, never creates a duplicate — see
 * negotiations.$id.tsx's handleContinueTransaction) and verifies the
 * workspace renders the correct, consistent final state without mutating it.
 */

test("Continue Transaction from an accepted negotiation opens the correct, terminal workspace", async ({ page }) => {
  await page.goto(`/negotiations/${RENT_ACCEPTED_NEGOTIATION_ID}`);
  await waitForHydration(page);

  await expect(page.getByText("Accepted", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Continue Transaction" }).click();

  await page.waitForURL(/\/transaction\/\d+$/, { timeout: 15_000 });
  // This exact phrase legitimately repeats (status badge, progress
  // stepper's current-step label, and the Next Best Action copy) — .first()
  // is fine, they're never inconsistent with each other.
  await expect(page.getByText("Ready for Rental Contract Process").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("100%")).toBeVisible();
  // Must never claim anything beyond this deterministic, conservative final
  // state — no Ejar/contract-signed/payment-completed wording.
  await expect(page.getByText(/contract signed|payment completed|ejar/i)).toHaveCount(0);
});
