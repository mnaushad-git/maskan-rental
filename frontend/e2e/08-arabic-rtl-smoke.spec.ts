import { test, expect } from "@playwright/test";
import { CUSTOMER_STORAGE_STATE, PROPERTIES, waitForHydration } from "./fixtures";

/**
 * Prompt 17 item 10: Arabic smoke test (one representative screen, RTL + key text).
 *
 * Property Detail is the richest single screen already covered elsewhere in
 * this suite (English), so reusing it here for the Arabic pass gives the
 * most coverage per test rather than picking a shallower screen. Switches
 * language through the real UI control (TopNav's language switcher), not by
 * pre-seeding localStorage, so this also exercises the switcher itself. Auth
 * itself is pre-seeded via global-setup.ts's storageState (login is already
 * covered by spec 01).
 */

test.use({ storageState: CUSTOMER_STORAGE_STATE });

test("switching to Arabic flips the property page to RTL with real Arabic copy", async ({ page }) => {
  await page.goto(`/property/${PROPERTIES.RENT_COMPLETE.id}`);
  await waitForHydration(page);
  await expect(page.getByText(PROPERTIES.RENT_COMPLETE.title)).toBeVisible();

  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("button", { name: "العربية" }).click();

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");

  // Property Intelligence heading — real Arabic translation, not the English
  // fallback and not an untranslated key leaking through.
  await expect(page.getByText("مؤشر قرار العقار")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Property Decision Score")).toHaveCount(0);

  // SAR amounts stay in the SAR/Latin-numeral convention the rest of the
  // Arabic pass (Prompt 14) already verified — just confirm the figure is
  // still present and correct after the language switch, not corrupted.
  // "SAR 8,500" bare also legitimately appears elsewhere on this data-dense
  // page (header price, rent calculator) — match the specific per-month
  // hint's exact Arabic string instead of a loose substring.
  await expect(page.getByText("~ SAR 8,500/شهريًا", { exact: true })).toBeVisible();
});
