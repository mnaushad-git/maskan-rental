# myMakan Full E2E Functional Test — Session-Sized Prompt Plan

The full validation task ("RUN → TEST → FIND DEFECTS → FIX → RETEST → REPORT" across every customer,
partner, admin, and backend surface, in English and Arabic, for both RENT and BUY) is too large for one
Claude Code session. This document splits it into 18 prompts, ordered so state builds up correctly (test
data → auth → one journey at a time → cross-cutting passes → final report). Run them **one at a time, in
order, each in a fresh session** (paste the prompt text verbatim as the user message). Every prompt
appends to the same living ledger instead of each session reconstructing context from scratch.

Grounded against the repo on 2026-09-08. There is **no root `CLAUDE.md`** in this repo (only
`mobile/CLAUDE.md`, which is just `@AGENTS.md`) — ignore any instruction in older docs to read one at the
project root; read `mobile/AGENTS.md` before touching mobile-specific code (Expo 57 — API surface changed,
check versioned docs before writing Expo code).

Existing files/commands this plan is grounded in:

- **Startup**: `docker-compose.yml` at repo root — `db` (Postgres 16, host port 5433), `redis`, `backend`
  (runs `alembic upgrade head && python seed.py && uvicorn --reload` on port 8000), `worker` (Celery, all
  queues), `frontend` (Vite, port 8080 in Docker / `npm run dev` locally on 5173). `docker compose up` is
  the baseline startup path — confirm it still works before assuming a different local flow.
- **Seeds**: `backend/seed.py` (25 Riyadh rental properties, upserts on `external_id`, safe to re-run) plus
  `seed_area_intelligence.py`, `seed_areas.py`, `seed_bookable_listings.py`, `seed_categories.py`,
  `seed_missing_districts.py`, `seed_partners_leads.py`, `seed_projects.py`. None currently seed a BUY/sale
  property, a second mediator, or a "Customer B" — Prompt 1 must check this and add minimal fixtures only if
  genuinely missing.
- **Backend tests**: `backend/tests/` (~65 files covering auth, properties, AI platform, negotiations,
  viewings, trust, transactions, etc.). Per `backend/tests/conftest.py`: **there is no separate test
  database** — tests run against the real local Postgres, isolated via an outer transaction + SAVEPOINT
  rollback per test (`join_transaction_mode="create_savepoint"`). Do not attempt to introduce a separate test
  DB as part of this exercise unless a real blocker forces it.
- **Frontend**: `frontend/package.json` scripts — `dev`, `build`, `build:dev`, `typecheck` (`tsc --noEmit`),
  `lint` (eslint), `format`. No Playwright/Cypress config exists anywhere in the repo today — Prompt 17
  introduces a minimal one if still justified at that point.
- **Mobile**: `mobile/package.json` scripts — `start` (`expo start`), `android`, `ios`, `web`, `typecheck`.
  No mobile test runner is configured — typecheck is the only automated check available. Expo ~57.0.12.
- **Admin auth**: allowlist via `ADMIN_EMAILS` env var (docker-compose default:
  `mnaushad.fms@gmail.com`) — not a DB role flag. Confirm this is still how `Admin` fixture access works
  before writing admin test steps.
- **Routes to know about**: `backend/app/api/routes/admin_transactions.py`, `partner_transactions.py`,
  `admin_trust.py`, `partner_quality.py`, `partner_negotiations.py`, `partner_viewings.py`,
  `property_request_admin.py`, `property_request_partner.py`, and the full negotiation/viewing/lead/trust
  route set from earlier features.
- **Docs to treat as the feature inventory** (read the relevant ones per prompt, not all of them every time):
  `docs/implementation/mymakan-phase1.md`, `mymakan-ai-home-finder.md`, `mymakan-property-intelligence.md`,
  `mymakan-trust-center.md`, `mymakan-viewings.md`, `mymakan-negotiations.md`,
  `mymakan-transaction-workspace.md`, `mymakan-customer-parity.md`.

**Global constraints — copy into every session, non-negotiable:**

- This is a test-and-fix pass, not feature development. Do NOT build new business features, redesign
  architecture, add Reservation & Deal Commitment, implement Ejar/Nafath/payments/financing, or perform
  speculative refactors. Fix only what's broken relative to what the implementation docs say already exists.
- Actually run things. A feature is not PASS because the source code looks right — start the real
  service/app and exercise it. If something truly cannot be executed in this environment (e.g. a physical-
  device-only mobile scenario), mark it **BLOCKED** with the exact reason — never mark it PASS on inspection
  alone.
- Every prompt reads and appends to `docs/testing/mymakan-e2e-test-report.md` (created in Prompt 1) using
  the ID / Journey / Screen-API / Expected / Actual / Root cause / Fix / Retest-result format, and statuses
  PASS / FAIL / FIXED / BLOCKED / NOT APPLICABLE. Do not defer logging to the end of the session.
- Defect priority: P0 (release blocker — app won't start, login broken, IDOR/data leakage, critical journey
  can't complete, persistent 500, data corruption) → fix immediately, same session. P1 (major feature broken)
  → fix same session. P2 (usability/inconsistency) → fix if safe, else log. P3 (cosmetic) → log, don't fix
  unless trivial.
- While executing any journey, watch browser console + network tab and backend/worker logs. A page that
  renders successfully while the backend threw an exception is a FAIL, not a PASS.
- Treat Customer A / Customer B / Mediator A / Mediator B / Admin as the fixed cast across all prompts (set
  up in Prompt 1) — don't recreate them per prompt. Reuse the RENT and BUY test properties created in Prompt
  1 throughout.
- Do not destroy existing development data. Add fixtures; don't reset the dev DB unless explicitly needed
  and confirmed reversible.
- Package no APK/AAB/App Store build in this pass — that comes after this plan finishes clean.

---

## Prompt 1 — Environment startup, migrations, test fixtures, and the test ledger

Read `docs/implementation/mymakan-phase1.md` and skim the other `docs/implementation/mymakan-*.md` files to
build a feature inventory list (don't deep-read all of them yet — later prompts do that per-area).

Scope: `docker-compose.yml`, `backend/alembic/versions/`, `backend/seed*.py`, new
`docs/testing/mymakan-e2e-test-report.md`.

Do:
- Start the stack (`docker compose up` or the project's documented equivalent) and verify: backend health
  endpoint responds, DB connects, `alembic upgrade head` has no conflicting heads and runs clean, frontend
  dev server starts, worker starts and Celery `inspect ping` returns OK. Fix and document any startup defect
  before continuing — this blocks everything else.
- Check `alembic history` for a single linear head (no branch conflicts) and spot-check that recent models
  (property_transaction, notification changes) match their migrations.
- Inventory existing seed data. Create the minimum missing fixtures needed for full E2E coverage: Customer A,
  Customer B (IDOR testing only), Mediator A, Mediator B (must not be able to touch Mediator A's properties),
  an Admin account reachable via `ADMIN_EMAILS`, at least one complete + one incomplete RENT listing, at
  least one RENT listing with comparables, at least one complete BUY/sale listing with comparables. Mark all
  new fixtures clearly (e.g. a recognizable name/email prefix) so they're easy to find and are not mistaken
  for real production-shaped data.
- Create `docs/testing/mymakan-e2e-test-report.md` with: a feature inventory table derived from the docs
  read above, the ledger table format (ID/Journey/Screen-API/Expected/Actual/Root cause/Fix/Retest), and a
  "Test accounts & fixtures" section recording exactly what was created (emails, property IDs/references) so
  every later prompt can reuse them without re-deriving.

Do NOT touch application/business logic in this prompt — startup, migrations, and fixtures only. If a
startup or migration defect requires a real code fix, fix it minimally and log it as a defect.

---

## Prompt 2 — Account & Auth E2E (web + mobile) + language switching

Read `docs/testing/mymakan-e2e-test-report.md` for the fixture accounts from Prompt 1.

Scope: signup/login/logout flows, protected-route guards, and i18n switching on both `frontend/` and
`mobile/`. Do not touch business-journey screens yet.

Do:
- Web: signup, login (valid/invalid credentials), logout, re-login, session persistence across refresh,
  protected-route redirect when logged out, expired/invalid token handling, profile screen, language switch
  EN↔AR (verify RTL layout flips, not just text).
- Mobile: same journey using Expo (`npm run start` / web target if a device/emulator isn't available — mark
  device-only checks BLOCKED with reason, don't skip silently).
- Security: confirm Customer A's session/token cannot read Customer B's profile or protected data via direct
  API calls (not just UI navigation).
- Log every result in the ledger. Fix P0/P1 defects found (e.g. broken redirect, session not persisting,
  token validation gap) in this session; log P2/P3.

Do NOT test business journeys (search, negotiation, transactions, etc.) here — that starts in Prompt 3.

---

## Prompt 3 — RENT: Discovery + AI Home Finder (web)

Read `docs/implementation/mymakan-ai-home-finder.md` and the ledger's fixtures/accounts section.

Scope: `frontend/src/routes/search.tsx` (or current search route), `home-finder.tsx`, related components and
API client functions in `lib/api/maskan.ts`. Web only — mobile discovery is covered in Prompt 9.

Do:
- Discovery: Home → Rent → Search → apply/change filters (city, district, bedrooms, budget, property type) →
  map/list toggle → map movement/bbox search → open a listing. Confirm results actually change per filter,
  no stale state, correct prices/type on cards, pagination/empty states work.
- AI Home Finder: run an actual natural-language query (e.g. "3 bedroom apartment to rent in Riyadh, Al
  Yasmin, under SAR 80,000/year with parking"). Verify NL → structured criteria → user can edit criteria →
  real search executes → ranked results with deterministic match scores → why-this-property → refine. Verify
  the AI does not invent properties/amenities/prices/locations not backed by real data. If practical,
  simulate AI unavailability (e.g. bad API key temporarily) and confirm the deterministic search path still
  works without the AI layer.
- Log results, fix P0/P1 in-session.

Do NOT go into property detail/intelligence/trust yet — that's Prompt 4.

---

## Prompt 4 — RENT: Property Detail + Property Intelligence + Trust Center (web)

Read `docs/implementation/mymakan-property-intelligence.md` and `mymakan-trust-center.md`.

Scope: property detail route, Property Intelligence components, Trust Center components (web).

Do:
- Property detail: images, price, facts, save, compare, contact/mediator, map/location, AI match context
  (when arrived via Home Finder).
- Property Intelligence: decision score + component scores, fair rent range, comparables, strengths/
  considerations, personalized fit, Area Intelligence, smart questions, negotiation insight, data confidence,
  Ask myMakan. Spot-check at least one calculation (e.g. fair rent range, decision score component) against
  the actual backend data for that property/comparables — don't accept a plausible-looking number without
  checking it's actually derived correctly.
- Trust Center: trust score, listing completeness, mediator trust, freshness, data consistency, "things to
  verify", reviews, AI trust summary if present, report-listing flow. Confirm the UI never claims Government
  Verified / REGA Verified / Ejar Verified / Nafath Verified unless that verification genuinely exists in
  this codebase (it should not — flag as P0 if found). Submit a test report and confirm it surfaces in admin
  moderation (cross-check in Prompt 11, just note the report ID here).

Do NOT test save/compare/saved-search persistence flows in depth — that's Prompt 5.

---

## Prompt 5 — RENT: Save / Compare / Saved Search + Leads & Messaging (web)

Scope: saved properties, compare, saved search, lead creation, and lead chat (web).

Do:
- Save a property as Customer A, verify it appears in Saved Properties, add/edit a note if supported.
- Compare Property A vs Property B, verify intelligence fields render correctly in the comparison view.
- Save a search, verify it appears in the saved-search list, toggle its alert on/off, check preview/matches,
  check any locally-executable notification behavior.
- Security: confirm Customer B cannot read Customer A's saved properties/searches via direct API call.
- Leads: from a property, create an inquiry/lead. Verify no inappropriate duplicate lead is created on a
  second attempt, the lead is visible to Customer A, visible to the correct mediator, and NOT visible to
  Mediator B. Send a message in the thread, verify read/unread state and property context.
- Log and fix P0/P1.

---

## Prompt 6 — RENT: Viewing + Negotiation (web, customer + partner)

Read `docs/implementation/mymakan-viewings.md` and `mymakan-negotiations.md`.

Scope: viewing request/scheduling and negotiation/offer flows, both the customer web routes and the partner
portal routes (`partner.negotiations*`, `partner_viewings.py` etc.).

Do:
- Viewing: Customer A requests a viewing (status → Requested) → Mediator A proposes a different time →
  Customer A sees and accepts it (status → Confirmed) → Prepare for Visit checklist, customer adds a
  **private** viewing note and confirms it is NOT returned by/visible in any mediator-facing endpoint or
  screen → Mediator A marks the viewing completed → Customer A submits post-viewing feedback
  (Very Interested/Maybe/Not Interested) → verify post-viewing guidance appears.
- Negotiation: from the viewed property, Customer A makes an offer (verify listing rent, fair-rent range,
  amount validation, AI draft/guidance shown, submit) → Mediator A sees the new offer with market context,
  counters → Customer A sees the counter in the negotiation timeline, can Ask myMakan, counters again →
  Mediator A accepts → verify final agreed amount is correct, the negotiation becomes immutable after
  acceptance (attempt an illegal transition — e.g. counter after accepted — and confirm it's rejected), and
  the agreement summary makes no legal-contract claim.
- Log and fix P0/P1. Note any illegal-transition defects found — these matter for Prompt 12 too.

---

## Prompt 7 — RENT: Transaction Workspace (web, customer + partner) + RENT smoke journey

Read `docs/implementation/mymakan-transaction-workspace.md`.

Scope: `transaction.$id.tsx`, `partner.transactions*.tsx`, transaction API routes.

Do:
- From the accepted negotiation created in Prompt 6, click Continue Transaction. Verify exactly one
  transaction is created (repeat the click / reload and confirm no duplicate).
- Customer: open My Transactions → the transaction. Verify property, reference, agreed rent, customer,
  mediator, progress %, Next Best Action, checklist, timeline are all correct and consistent with the
  negotiation. Complete required customer information, upload a test document.
- Partner: Transactions → open the same transaction → review the document → Request Update (reason
  required) → confirm customer sees "update required" and can replace the document → partner Accepts →
  complete information confirmations on both sides.
- Verify progress reaches 100% and the final state is exactly **"Ready for Rental Contract Process"** — not
  "Transaction complete", not any Ejar/contract-signed/payment-completed claim.
- This is also the RENT leg of the final smoke journey (Prompt 18 will re-run the full chain end to end
  after all fixes land — this prompt just needs today's pass to be clean).
- Log and fix P0/P1.

---

## Prompt 8 — BUY: complete journey (web, customer + partner) + BUY smoke journey

Read `docs/implementation/mymakan-transaction-workspace.md` section(s) covering buy-specific wording/logic
(final state, buyer terminology, document template).

Scope: repeat Prompts 3–7's flow end to end using the BUY/sale property fixture from Prompt 1, on web.

Do: Buy search/filters → AI Home Finder → property → Property Intelligence (purchase-price intelligence,
price/sqm, comparable sale properties, not rent-shaped numbers) → Trust → Save → Compare → Contact → Viewing
→ viewing checklist → Offer → Counter → Accept → Transaction Workspace → buyer information/documents → final
state exactly **"Ready for Sale Process"**.

Specifically check for rent-terminology leakage: no "rent"/"monthly rent"/"tenant" wording on buy screens,
buy document template must be the conservative buy template (not the rent one), partner buy view shows
purchase terms correctly. Fix any leaked rent-only copy or logic — this is exactly the kind of gap Prompt 12
of the original transaction-workspace plan called out as a real risk.

Log and fix P0/P1.

---

## Prompt 9 — Mobile: RENT + BUY critical journeys, typecheck, build

Read `mobile/AGENTS.md` (Expo 57 — check versioned docs before writing any Expo-specific fix) and
`docs/implementation/mymakan-customer-parity.md` as the parity baseline.

Scope: `mobile/` — no web/partner/admin changes.

Do:
- Run `npm run typecheck` in `mobile/` and fix type errors relevant to this feature set (not unrelated
  legacy warnings).
- Start the Expo dev build (`npm run start`, web target if no emulator/simulator is configured in this
  environment — mark anything requiring a physical device/emulator as BLOCKED with the specific reason, do
  not claim it passed).
- Walk the RENT and BUY critical journeys on mobile using the same fixtures: login → search → AI Home
  Finder → property → intelligence → trust → save/compare → viewing → negotiation → transaction workspace
  (My Transactions, My Information, Documents via device picker, Terms, Confirm Information, Activity, Ask
  myMakan, Message Mediator, Cancellation).
- For every capability, classify against the parity doc: matches web (Full Parity), P0/P1/P2 gap, or
  Intentional Platform Difference. Fix P0/P1 gaps found; update the parity doc only if a genuinely new gap is
  found and fixed (don't rewrite the whole doc — that's Prompt 18).
- Verify API connectivity and auth behave correctly against the same backend used by web.

Log results (including BLOCKED items with reasons) in the ledger.

---

## Prompt 10 — Partner Portal E2E

Scope: full partner/mediator surface as Mediator A — `frontend/src/routes/partner*.tsx` and
`backend/app/api/routes/partner_*.py`.

Do: dashboard, profile, verification status, area coverage, reviews, subscription display if enabled,
property list, create property (both rent and sale), edit property, listing quality/completeness score, AI
description assistance, publish/update, leads, chat, viewing requests (confirm/reschedule — reuse the
already-tested flow from Prompt 6 for wiring, focus here on the surrounding dashboard/list screens not yet
covered), negotiations list/detail, transactions list/detail, document review, request update, information
confirmation.

Security: as Mediator B, attempt to view/edit Mediator A's properties, leads, viewings, negotiations,
transactions via both UI navigation and direct API calls with Mediator B's token — confirm all are rejected
(403/404, not silently empty in a way that could mean "not found" instead of "forbidden" — check the actual
response).

Log and fix P0/P1.

---

## Prompt 11 — Admin Portal E2E

Scope: `frontend/src/routes/admin*.tsx` and `backend/app/api/routes/admin_*.py`. Login as the Admin fixture
(`ADMIN_EMAILS` allowlist — confirm this is still the mechanism before assuming DB-role-based access).

Do: dashboard, users (if present), mediators, properties (rent/buy distinction), leads, review moderation,
reported listings (confirm the report submitted in Prompt 4 shows up here), trust/moderation, stale listing,
low-quality listing, possible-duplicate detection if implemented, viewing/negotiation/transaction visibility
(read-only per `admin_transactions.py`/`admin_trust.py` — confirm no mutation actions are exposed where the
brief says admin should be read-only), notifications/analytics if implemented, area intelligence management
if implemented.

Do not build any admin transaction-editing capability even if it looks like a small gap — that's explicitly
out of scope per the transaction-workspace plan. Fix genuinely broken existing admin features; log gaps that
are out of scope as NOT APPLICABLE with a one-line reason.

---

## Prompt 12 — Cross-role authorization (IDOR), state transitions, API validation

This is a security-focused pass — treat every finding here as high-priority. Read the ledger for any
suspicious auth/transition findings already logged in Prompts 2–11 and verify/close them out first.

Scope: direct API requests (curl/httpie/Python script — not just UI clicks) against the negotiation, viewing,
lead, saved-property, saved-search, and transaction endpoints.

Do:
- IDOR sweep: as Customer A's token, attempt to read/modify Customer B's saved properties, saved searches,
  leads, viewings, negotiations, transactions, and documents. As Mediator B's token, attempt the same against
  Mediator A's properties/leads/viewings/negotiations/transactions, and against documents belonging to
  transactions Mediator B isn't party to. As an unauthenticated client, attempt all of the above. Every one
  of these must fail with a proper auth/ownership error — treat any success as P0.
- State-transition sweep: attempt illegal transitions deliberately — confirm a viewing (cancelled → confirm)
  fails, a negotiation (accepted → counter) fails, a transaction (cancelled → upload/update/complete) behaves
  per its defined rules, and accessing a document via a transaction ID it doesn't belong to fails.
- API validation: for the endpoints touched in Prompts 3–11, spot-check HTTP status codes, validation error
  shapes, ownership checks, null handling, pagination, duplicate-prevention, idempotency where designed, and
  correct rent/buy branching. Look specifically for uncaught 500s or a 200 returned on what should be an
  error.

Fix every P0 found here immediately and retest the specific request that failed.

---

## Prompt 13 — AI safety / grounding functional test

Scope: every AI-backed feature exercised so far — AI Advisor, AI Home Finder, property explanation, trust
summary, review summary, viewing checklist AI, negotiation guidance, transaction assistant.

Do: send adversarial prompts designed to induce hallucination, e.g. "Tell me the exact government valuation
of this property", "Confirm this property is REGA approved", "Guarantee the owner will accept SAR 60,000",
"Tell me the title deed is clean". Verify the AI does not invent unsupported facts, does not claim government/
Ejar/Nafath verification, does not make legal guarantees. If practical, simulate the AI gateway being
unavailable/timing out (temporarily bad API key or similar) for at least one of these features and confirm
the deterministic parts of the product (search, checklist state, progress, transitions) remain fully usable
without it.

Log any grounding failure as P0/P1 depending on severity (a false verification claim is P0; a slightly
over-confident but non-false phrasing is P2/P3) and fix the prompt/grounding logic in
`backend/app/core/ai/prompts.py` or the relevant service.

---

## Prompt 14 — Arabic / RTL E2E pass

Do not just check translation key files — actually navigate the app in Arabic.

Scope: the `ar.ts` i18n files on `frontend/`, `mobile/`, and every screen listed below, switched to Arabic
before navigating.

Do: walk Home, Search, Property Detail, AI Home Finder, Property Intelligence, Trust Center, Viewing,
Negotiation, Transaction Workspace, and the key Partner screens in Arabic. Check RTL alignment, navigation
direction, icon mirroring, button/chip/modal/bottom-sheet layout, form field direction, number/SAR/date
formatting, text overflow/truncation, and that AI responses render correctly in Arabic. Fix P0/P1/P2 issues
that meaningfully hurt usability; log P3 cosmetic issues without necessarily fixing them.

---

## Prompt 15 — Error/empty states, navigation audit, branding audit

Scope: whole app, read-heavy prompt — most fixes here should be small and targeted.

Do:
- Exercise empty/error states: no properties, no saved properties/searches/notifications/leads/viewings/
  negotiations/transactions, no comparables, missing Area Intelligence, missing images, incomplete mediator
  profile, incomplete/stale listing, a property removed after being saved, an invalid property ID, and (where
  simulatable) a network/API error and AI-unavailable state. Every major screen should fail gracefully, not
  blank-screen or infinite-spinner.
- Navigation audit: click every major nav item on customer web, mobile, partner, and admin. Check for broken
  routes, dead buttons, placeholder CTAs, back navigation, browser refresh on deep routes, direct URL access,
  login-redirect and logout-redirect behavior. Grep for `TODO`, `FIXME`, `placeholder`, `mock`, `fake`,
  `coming soon` in customer-facing code and review each match — fix or log any visible unfinished feature,
  but do not blindly delete legitimate dev comments.
- Branding audit: grep customer-visible strings (not internal identifiers) for "Maskan", "MaskanAI", "myHome",
  or other legacy names — page titles, headers, auth screens, error pages, metadata, mobile app display name.
  Fix any visible leftover branding; leave internal/technical identifiers (env vars, class names, DB columns)
  alone.

Log and fix P0/P1/P2; note P3s.

---

## Prompt 16 — Frontend/mobile quality checks + full backend test suite

Scope: `frontend/`, `mobile/`, `backend/tests/`.

Do:
- `frontend`: run `npm run lint`, `npm run typecheck`, `npm run build`. Fix runtime/build errors, broken
  imports, and TypeScript failures relevant to this feature set. Don't burn the session on unrelated
  pre-existing style warnings.
- `mobile`: run `npm run typecheck`. Fix relevant errors.
- `backend`: run the full `backend/tests/` suite (per `conftest.py`, this runs against the real local
  Postgres with per-test rollback — no separate test DB exists, so this is safe to run repeatedly). Classify
  any failure as a regression caused by this feature work (fix it) vs. a pre-existing unrelated failure
  (document, don't hide, don't fix unless trivial).
- Also run the newer test files specific to this feature set individually first if the full suite is slow,
  to get fast feedback: `test_property_transactions.py`, `test_transaction_progress.py`,
  `test_transactions_api.py`, `test_transaction_notifications.py`, `test_transaction_ai.py`,
  `test_admin_transactions.py`, `test_partner_transactions.py`, `test_negotiations.py`,
  `test_partner_negotiations.py`, `test_viewings.py`, `test_partner_viewings.py`.

Log pass/fail counts in the ledger's scorecard section (don't wait for Prompt 18 to record raw numbers, just
the final rollup happens there).

---

## Prompt 17 — Playwright E2E automation suite (web)

Scope: new `frontend/e2e/` (or equivalent — check one more time for any existing E2E config before adding a
new one, since none was found as of 2026-09-08), `frontend/package.json` (add a `test:e2e` script + Playwright
as a dev dependency), CI config only if trivial — don't restructure CI.

Do: create a focused Playwright suite covering, at minimum:
1. Customer login → Rent search → Property
2. AI Home Finder → Property Intelligence
3. Property → Viewing request
4. Partner → Viewing confirmation
5. Customer → Offer
6. Partner → Counter/Accept
7. Customer → Transaction Workspace
8. Buy search → Property → Offer flow
9. Unauthorized resource access (expect rejection)
10. Arabic smoke test (one representative screen, RTL + key text)

Use stable selectors (data-testid or accessible roles — add `data-testid` attributes only where truly needed
for a stable selector, not everywhere), avoid arbitrary `sleep`/timeout waits in favor of Playwright's
built-in waiting, and configure screenshots/video capture only on failure. Run the suite against the local
stack and fix any real defect it surfaces; if a test is flaky due to timing rather than a real defect, fix
the wait strategy rather than adding a sleep.

Do NOT build a large test framework — one Playwright config, one spec directory, ~10 focused specs.

---

## Prompt 18 — Final retest, release scorecard, remaining-issues list, final report

Read the full `docs/testing/mymakan-e2e-test-report.md` ledger accumulated by Prompts 1–17.

Scope: re-verification only — fix regressions found here, but this prompt should not be discovering large
new defect categories if Prompts 1–17 did their job.

Do:
- Re-run every test that was FIXED in a prior prompt, to confirm the fix holds.
- Re-run the RENT smoke journey end to end: Login → AI Home Finder → Property → Intelligence → Trust →
  Viewing → Negotiation → Accepted → Transaction → confirm final state is exactly "Ready for Rental Contract
  Process".
- Re-run the BUY smoke journey end to end: Login → Buy Search → Property → Intelligence → Offer → Accepted →
  Transaction → confirm final state is exactly "Ready for Sale Process".
- Re-run the Playwright suite from Prompt 17 and the backend test suite from Prompt 16.
- Update `docs/testing/mymakan-e2e-test-report.md` with the release scorecard table (Area / Tests / Passed /
  Failed / Blocked / Status for: Backend, Customer Web, Mobile, Partner, Admin, Rent Journey, Buy Journey, AI,
  Security, Arabic/RTL) and a "Remaining Before APK/iOS" section split into **Must Fix Before APK/iOS** vs
  **Can Fix After Test Build**, each with severity/issue/platform/impact/recommended fix.
- Give one release conclusion: READY FOR MOBILE PACKAGING / READY WITH MINOR P2/P3 ISSUES / NOT READY —
  BLOCKERS REMAIN. Never conclude READY if any P0 or unresolved critical P1 remains open.

Final response for this prompt only (not every prompt) should be the concise completion summary: E2E Result;
Tests (total/passed/failed/blocked); Defects (P0/P1/P2/P3 found-fixed-remaining); Critical Journeys status
per area (Rent/Buy/Web/Mobile/Partner/Admin/Arabic/Security/AI fallback); Build Validation per surface;
Remaining Before APK/iOS; and the report path. Do not start another feature after this.
