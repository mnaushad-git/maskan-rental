import { request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_BASE_URL, CUSTOMER_A, FRONTEND_ORIGIN, MEDIATOR_A } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Logs in Customer A and Mediator A ONCE per suite run (via direct API
 * calls — no browser needed) and writes their sessions out as Playwright
 * `storageState` files that every spec (except the login spec itself, which
 * deliberately drives the real UI form) reuses via `test.use({ storageState })`.
 *
 * Why this exists: `POST /api/auth/login` is rate-limited (10 requests / 5
 * minutes per client — see backend/app/api/routes/auth.py) shared across
 * this whole IP. Logging in through the UI in every single test (this
 * suite has ~10 specs, several needing both a customer and a partner
 * session) burned through that budget during this prompt's own development
 * and started 429-ing real test runs — the same class of self-inflicted
 * rate-limit exhaustion already documented in docs/testing/mymakan-e2e-test-report.md
 * §2 (Prompt 16, P16-006) for the backend's own pytest suite. Logging in
 * exactly twice per run here, rather than once per test, is the fix.
 *
 * `lib/auth-storage.ts` namespaces localStorage by "portal" (user/partner/
 * admin), derived from the URL path — reproducing that shape directly is
 * what makes a pre-seeded storageState indistinguishable from a real login
 * to the app on load.
 */

async function loginViaApi(email: string, password: string) {
  const api = await request.newContext({ baseURL: API_BASE_URL });
  const resp = await api.post("auth/login", { data: { email, password } });
  if (!resp.ok()) {
    throw new Error(
      `global-setup: login failed for ${email} — ${resp.status()} ${await resp.text()}. ` +
        `If this is a 429, the shared login rate limit (10/5min) is likely still cooling down from a previous run.`,
    );
  }
  const body = await resp.json();
  await api.dispose();
  return body as { access_token: string; user: unknown };
}

function storageStateFor(scope: "user" | "partner", token: string, user: unknown) {
  return {
    cookies: [],
    origins: [
      {
        origin: FRONTEND_ORIGIN,
        localStorage: [
          { name: `maskan_${scope}_token`, value: token },
          { name: `maskan_${scope}_user`, value: JSON.stringify(user) },
        ],
      },
    ],
  };
}

export default async function globalSetup() {
  const authDir = path.join(__dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });

  const customer = await loginViaApi(CUSTOMER_A.email, CUSTOMER_A.password);
  fs.writeFileSync(
    path.join(authDir, "customer.json"),
    JSON.stringify(storageStateFor("user", customer.access_token, customer.user), null, 2),
  );

  const partner = await loginViaApi(MEDIATOR_A.email, MEDIATOR_A.password);
  fs.writeFileSync(
    path.join(authDir, "partner.json"),
    JSON.stringify(storageStateFor("partner", partner.access_token, partner.user), null, 2),
  );
}
