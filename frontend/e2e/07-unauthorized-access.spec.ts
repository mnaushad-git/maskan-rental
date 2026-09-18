import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  API_BASE_URL,
  CUSTOMER_B,
  CUSTOMER_STORAGE_STATE,
  RENT_ACCEPTED_NEGOTIATION_ID,
  readStoredAccessToken,
} from "./fixtures";

/**
 * Prompt 17 item 9: Unauthorized resource access (expect rejection).
 *
 * Direct API-level IDOR/auth checks (not just UI navigation) against the
 * backend, mirroring the sweep style Prompt 12 already established. Uses
 * negotiation 3131 (property 14377, Customer A) and its transaction — both
 * read-only here, never mutated. `API_BASE_URL` talks straight to the
 * FastAPI backend on :8000 (frontend/.env.local's VITE_API_BASE_URL — see
 * fixtures.ts), independent of whatever port Vite landed on.
 */

const RENT_TRANSACTION_REF = { id: 1250 };

test.describe("Unauthorized resource access is rejected, not silently allowed", () => {
  test("Customer B's own token cannot read Customer A's negotiation or transaction (IDOR)", async () => {
    const api = await playwrightRequest.newContext({ baseURL: API_BASE_URL });

    const loginResp = await api.post("auth/login", {
      data: { email: CUSTOMER_B.email, password: CUSTOMER_B.password },
    });
    expect(loginResp.ok()).toBeTruthy();
    const { access_token } = await loginResp.json();
    expect(access_token).toBeTruthy();

    const negResp = await api.get(`negotiations/${RENT_ACCEPTED_NEGOTIATION_ID}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(negResp.status()).toBe(403);

    const txResp = await api.get(`transactions/${RENT_TRANSACTION_REF.id}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect([403, 404]).toContain(txResp.status());

    await api.dispose();
  });

  test("an unauthenticated client cannot read either resource at all", async () => {
    const api = await playwrightRequest.newContext({ baseURL: API_BASE_URL });

    const negResp = await api.get(`negotiations/${RENT_ACCEPTED_NEGOTIATION_ID}`);
    expect(negResp.status()).toBe(401);

    const txResp = await api.get(`transactions/${RENT_TRANSACTION_REF.id}`);
    expect(txResp.status()).toBe(401);

    await api.dispose();
  });

  test("Customer A's own token can still read their own negotiation (control — the 403 above is ownership, not a broken route)", async () => {
    const api = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
    // Reuses the session global-setup.ts already established — no need to
    // spend another call against the shared login rate limit just for a
    // control assertion.
    const access_token = readStoredAccessToken(CUSTOMER_STORAGE_STATE, "maskan_user_token");

    const negResp = await api.get(`negotiations/${RENT_ACCEPTED_NEGOTIATION_ID}`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(negResp.status()).toBe(200);
    const body = await negResp.json();
    expect(body.status).toBe("accepted");

    await api.dispose();
  });
});
