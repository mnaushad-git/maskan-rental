import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E suite (Prompt 17 of docs/testing/mymakan-e2e-test-prompts.md).
 *
 * Runs against the ALREADY-RUNNING local dev stack (backend on :8000, frontend
 * on :8083 per docs/testing/mymakan-e2e-test-report.md §0/§20) — this config
 * intentionally has no `webServer` block. Prior E2E prompts in this chain found
 * Vite doesn't always land on the same port (8080-8082 were occupied by other
 * processes on this shared dev machine), so start the stack yourself first and
 * point BASE_URL/API_BASE_URL at whatever ports are actually listening if they
 * ever differ from the defaults below.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8083";

export default defineConfig({
  testDir: "./e2e",
  // Logs in Customer A + Mediator A ONCE per run and saves their sessions as
  // storageState files most specs reuse — see global-setup.ts for why
  // (backend login rate limit is shared across the whole suite).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Capped rather than left at Playwright's default (CPU count, 8 on this
  // dev machine): the local stack this suite targets is a single uvicorn
  // process + a single Vite dev server, not a scaled deployment — 8
  // concurrent browser sessions genuinely starve each other's hydration
  // (observed directly: 4 failures at the default worker count, 0 at 4,
  // across otherwise-identical runs). 4 was the highest count that stayed
  // reliably green in this environment.
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    // Screenshots/video/trace only on failure — per this prompt's brief, not
    // every run (keeps the artifact directory small on a green suite).
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
