# Maskan — Copy-Paste Session Prompts

Companion to `ROADMAP_AQAR_AI.md`. Run these **in order, one per fresh Claude Code window**. Each prompt is self-contained: it tells the session exactly which files to read (so it doesn't re-explore the whole repo) and exactly when to stop. Do not paste two prompts into the same session.

Working directory for all prompts: `d:\Naushad\Projects\Maskan-Rental\maskan-rental`

---

## Prompt 1 — Rental Contracts: Backend

```
Read only these files before starting — do not explore the rest of the codebase:
ROADMAP_AQAR_AI.md (section "1. Digital Rental Contract Management"),
backend/app/models/lead.py, backend/app/models/mediator.py (pattern reference),
backend/app/api/routes/leads.py, backend/app/db/base.py.

Task: Build the backend for digital rental contract management (Maskan's Ejar-equivalent).
- New model backend/app/models/contract.py: tied to an accepted Lead, with tenant,
  landlord/mediator, property, rent amount, deposit, start/end date, status
  (draft/pending_signature/active/expired), and separate signed_at timestamps for
  each party.
- New Alembic migration for the contracts table.
- New route backend/app/api/routes/contracts.py: create contract from an accepted
  lead, get contract, list contracts for a user, sign endpoint (tenant/landlord
  sign separately).
- Register the router in main.py the same way other routers are registered.

Acceptance criteria: tenant can generate a contract from an accepted lead via API,
both parties can fetch it, signing endpoint updates status correctly, migration
runs cleanly.

Stay backend-only — do not touch the frontend. When done: run the migration, run
existing backend tests, commit, and update the Status table in ROADMAP_AQAR_AI.md
(row 1) noting what's done and what's left for the frontend session. Do not start
any other roadmap item in this session even if you finish early.
```

---

## Prompt 2 — Rental Contracts: Frontend + AI Contract Assistant

*(Prereq: Prompt 1 done)*

```
Read only: ROADMAP_AQAR_AI.md section 1, backend/app/api/routes/contracts.py,
backend/app/api/routes/ai.py, backend/app/core/ai/prompts.py,
frontend/src/routes/advisor.tsx (AI chat pattern), and one existing property/lead
detail page for frontend layout conventions.

Task:
- New frontend page/route to view and sign a contract for a given lead.
- Add an "AI Contract Assistant": send contract terms to a new endpoint in ai.py
  that flags at least 3 categories of concerns in plain language (e.g. deposit vs.
  district average using area_intelligence data, missing maintenance clause,
  unusual duration).
- Wire the assistant output into the contract page as a panel.

Acceptance: tenant can view the contract, see AI flags before signing, sign, and
see status update.

Frontend + one new AI endpoint only — don't change the contract data model further.
Commit, update Status table row 1 to Done. Stop there.
```

---

## Prompt 3 — Renter Identity Verification: Backend

```
Read only: ROADMAP_AQAR_AI.md section 2, backend/app/models/mediator.py
(is_verified pattern), backend/app/api/routes/mediators.py (verification approval
endpoint pattern), backend/app/models/user.py.

Task: Add renter identity verification mirroring the mediator pattern.
- Add verification fields to User (is_verified, verification_status,
  verification_submitted_at) — or a separate UserVerification model if that fits
  the existing User model shape better, your call.
- New route: renter submits a verification request (mock — capture a document
  reference/ID number, no real Nafath call), admin approves/rejects (reuse the
  admin auth pattern from mediators.py).
- Migration for the new fields/table.

Acceptance: renter can submit, admin can approve, is_verified flips correctly,
exposed on the user profile response.

Backend only. Commit, update Status table row 2. Stop there.
```

---

## Prompt 4 — Renter Identity Verification: Frontend + AI Trust Badge

*(Prereq: Prompt 3 done)*

```
Read only: ROADMAP_AQAR_AI.md section 2, the verification route from the prior
session, the frontend profile page, backend/app/models/review.py.

Task:
- Frontend: renter-facing verification submission flow + status display.
- "AI Trust Badge": combine verification status + review history + response rate
  into a single score/badge. A deterministic weighted formula is fine — it doesn't
  need a live LLM call, just clear scoring logic — shown on profile and reviews.

Acceptance: badge renders correctly for verified vs. unverified users with review
history.

Frontend + scoring logic only. Commit, update Status table row 2 to Done. Stop there.
```

---

## Prompt 5 — Fix the Mocked Moyasar Payment Gateway

```
Read only: ROADMAP_AQAR_AI.md section 3 (blocker note), backend/app/api/routes/
mediators.py (around the subscription activation code, ~lines 62-63 and 116),
backend/app/models/payment.py.

Task: Replace the mocked instant-activation subscription payment with a real
Moyasar API call. If live credentials aren't available right now, build the
integration behind an env flag USE_REAL_PAYMENTS so it's ready to enable, and
document exactly what's needed in .env.example.

Acceptance: with the flag on, subscription activation goes through Moyasar's real
charge/webhook flow; with it off, existing mock behavior is unchanged so nothing
breaks.

Backend only. Commit, update Status table row 3 noting which mode is active. Stop there.
```

---

## Prompt 6 — Renter Premium Tier: Backend

*(Prereq: Prompt 5 done)*

```
Read only: ROADMAP_AQAR_AI.md section 3, backend/app/models/mediator.py
(subscription_status/tier fields), backend/app/core/deps.py (subscription gating
pattern), the payment work from the prior session.

Task: Add a renter-facing premium tier.
- Add subscription_status/tier fields to User, mirroring Mediator's pattern.
- Reuse the payment flow from the previous session for renter subscriptions.
- Add a dependency/gate (mirror deps.py's existing pattern) for premium-only
  features.

Acceptance: renter can subscribe and unsubscribe, the gate correctly blocks/allows
access, expiry works.

Backend only. Commit, update Status table row 3. Stop there.
```

---

## Prompt 7 — Renter Premium Tier: Frontend + AI Alert Plus

*(Prereq: Prompt 6 done)*

```
Read only: ROADMAP_AQAR_AI.md section 3, the new gate/fields from the prior
session, backend/app/models/saved_search.py + saved_search_matcher.py
(alert_frequency field), backend/app/api/routes/ai.py.

Task:
- Frontend upgrade/upsell flow for premium.
- "AI Alert Plus": premium users' saved-search alerts use instant delivery
  (alert_frequency="instant" already supported) plus a one-line AI-generated
  summary of why each new match fits, attached to the notification payload via
  ai.py.
- Free tier gets a daily cap on AI Advisor chat messages; premium is unlimited
  (simple counter check, not a new AI feature).

Acceptance: premium user sees instant AI-summarized alerts; free user hits the
chat cap and sees an upgrade prompt.

Frontend + light backend touch on the notification payload only. Commit, update
Status table row 3 to Done. Stop there.
```

---

## Prompt 8 — Short-Term Booking: Backend

```
Read only: ROADMAP_AQAR_AI.md section 4, backend/app/models/lead.py (contrast —
bookings are not leads), backend/app/models/property.py, backend/app/core/locks.py.

Task: Build the booking data layer.
- New model backend/app/models/booking.py: property, renter, check_in, check_out,
  status, total_price.
- Prevent overlapping bookings for the same property at the DB level (exclusion
  constraint, or app-level locking consistent with the locks.py pattern).
- New route backend/app/api/routes/bookings.py: check availability for a date
  range, create booking, list bookings for a property/user.
- Migration.

Acceptance: overlapping bookings are rejected, availability check works, migration
is clean.

Backend only — no pricing/AI logic yet, that's the next session. Commit, update
Status table row 4a to Done, note 4b is next. Stop there.
```

---

## Prompt 9 — Short-Term Booking: Frontend + AI Pricing/Availability Assistant

*(Prereq: Prompt 8 done)*

```
Read only: ROADMAP_AQAR_AI.md section 4, backend/app/api/routes/bookings.py,
backend/app/models/area_intelligence.py, backend/app/api/routes/ai.py.

Task:
- Frontend calendar UI on the property page for picking check-in/check-out and
  booking.
- AI dynamic pricing suggestion for landlords: given area intelligence + season,
  suggest a nightly rate range (small new endpoint or helper via ai.py).
- Availability note for renters ("usually booked X weeks out") — a computed stat
  from booking history is fine, doesn't need a live AI call if that's clearer.

Acceptance: renter can pick dates and book end-to-end; landlord sees a suggested
nightly rate when listing/editing.

Commit, update Status table rows 4a/4b to Done. Stop there.
```

---

## Prompt 10 — Rent Financing Waitlist + AI Affordability Advisor

```
Read only: ROADMAP_AQAR_AI.md section 5, backend/app/models/payment.py,
backend/app/api/routes/ai.py.

Task: Build an interest-capture stub — no real financing partner is confirmed yet,
so this is not a real payment integration.
- New lightweight model/table for financing interest requests: renter, property,
  stated budget, timestamp.
- Endpoint to submit interest.
- "AI Affordability Advisor": given stated budget + property rent, a short
  AI-generated note (via ai.py) on whether it's a stretch and what installment
  cadence would make sense.
- Frontend: "Request financing" button on the property page leading to a short
  form.

Acceptance: submissions are stored and visible to admin; the AI note renders on
the confirmation screen.

Commit, update Status table row 5 to Done. Stop there.
```

---

## Prompt 11 (optional/bonus) — Server-Side AI Rental Scoring

```
Read only: ROADMAP_AQAR_AI.md bonus section, frontend/src/lib/api/maskan.ts
(estimateRentalScore function), backend/app/api/routes/ai.py,
backend/app/models/area_intelligence.py.

Task: Move the client-side rental-score heuristic to a real backend AI call.
- New endpoint in ai.py that computes the rental score server-side using the same
  inputs the heuristic used plus area intelligence data, via the existing Claude
  integration.
- Frontend calls the new endpoint instead of estimateRentalScore(); keep the old
  function only as an offline fallback if the API call fails.

Acceptance: the rental score badge normally reflects a real backend AI call;
falls back to the heuristic only if the API is unreachable.

Commit, update Status table bonus row to Done. Stop there.
```

---

# Phase 2 — New Differentiator Features (beyond Aqar)

Phase 1 (Prompts 1-11, all of Part 2 in ROADMAP_AQAR_AI.md) is complete. These prompts build
Part 2B: features Aqar doesn't have. Same rules apply — one prompt per fresh window, in order,
each stops at its own acceptance criteria.

---

## Prompt 12 — AI-Assisted Listing Creation

```
Read only: ROADMAP_AQAR_AI.md section 6, backend/app/api/routes/ai.py (specifically
the pricing-suggestion endpoint as your template for the rate-limit/gateway/fallback/
log_ai_call pattern), backend/app/core/ai/prompts.py, frontend/src/routes/partner.tsx
(PartnerListingForm).

Task: Let landlords draft listing copy with AI instead of writing it by hand.
- New endpoint POST /api/ai/listing-draft in ai.py: takes rough input (property
  type, area, bedrooms, a few free-text keywords/bullet points from the landlord),
  returns a drafted title + description + suggested amenity tags. Follow the exact
  established pattern: rate_limit_dependency(...), gateway.run_chat(...) wrapped in
  try/except with a _deterministic_listing_draft() fallback (simple template fill
  from the inputs), finally: gateway.log_ai_call(...), response includes
  generated_by: "ai"|"fallback". New prompt LISTING_DRAFT_ASSISTANT registered in
  prompts.py the same way PRICING_ASSISTANT is.
- Frontend: a "Draft with AI" button in PartnerListingForm that calls the endpoint
  and fills the title/description fields — landlord can still edit before
  submitting, this never auto-submits.

Acceptance: landlord can generate a draft from a few keywords, see it fill the
form, edit it, and submit normally.

No new DB model needed. Commit, update Status table row 6 to Done. Stop there.
```

---

## Prompt 13 — Real Landlord Analytics + AI Portfolio Insights: Backend

```
Read only: ROADMAP_AQAR_AI.md section 7, backend/app/api/routes/analytics.py,
backend/app/models/lead.py, backend/app/models/contract.py,
backend/app/models/review.py, backend/app/models/booking.py,
backend/app/models/mediator.py, backend/app/api/routes/ai.py (pattern reference,
same as Prompt 12).

Task: Make the analytics numbers real, then add an AI narrative on top.
- In analytics.py's /summary (or a new mediator-scoped endpoint), replace the
  fabricated fields with real aggregates: funnel stage "Contracts signed" should
  count actual Contract rows (not total_users), search_demand/kpis deltas/aiTrends
  should either be computed from real data or removed if there's no real signal
  for them yet — don't leave arithmetic that looks real but isn't.
- Add a mediator-scoped section: lead funnel breakdown (Lead.status counts),
  contract count, average review rating, booking count, and price vs. district
  average (reuse the existing _district_avg_monthly_rent helper).
- New endpoint POST /api/ai/portfolio-insights (mediator auth required): given
  that mediator's real numbers, generate a plain-language summary + 1-2 concrete
  recommendations. Same rate-limit/gateway/fallback/log_ai_call pattern as other
  ai.py endpoints; new prompt PORTFOLIO_INSIGHTS_ASSISTANT in prompts.py.

Acceptance: /summary's numbers are all traceable to a real query, no filler
arithmetic remains; the new insights endpoint returns a narrative grounded in that
mediator's real data.

Backend only — don't touch analytics.tsx yet, that's the next session. Commit,
update Status table row 7a to Done. Stop there.
```

---

## Prompt 14 — Real Landlord Analytics + AI Portfolio Insights: Frontend

*(Prereq: Prompt 13 done)*

```
Read only: ROADMAP_AQAR_AI.md section 7, frontend/src/routes/analytics.tsx, the
new backend fields/endpoint from the prior session.

Task:
- Remove the hardcoded fallback arrays that don't correspond to real data (kpis
  deltas, aiTrends, dataQuality, the old funnel filler) — the page should show
  real data or an honest "not enough data yet" empty state, never silently fall
  back to fabricated numbers on a fetch failure.
- Add an "AI Portfolio Insights" panel that calls the new endpoint and renders the
  narrative + recommendations for the logged-in mediator.

Acceptance: analytics page reflects only real data or an explicit empty state; AI
Insights panel renders correctly for a mediator with and without much history.

Commit, update Status table row 7b to Done. Stop there.
```

---

## Prompt 15 — AI Lease Renewal Assistant

```
Read only: ROADMAP_AQAR_AI.md section 8, backend/app/models/contract.py,
backend/app/jobs/expire_assignments.py (job pattern), backend/app/main.py
(scheduler registration, around the add_job calls), backend/app/tasks/
notifications.py (around _deliver and how a Notification row is constructed),
backend/app/api/routes/ai.py (pattern reference).

Task: Proactively remind tenants and landlords before a lease expires.
- Migration: add renewal_reminder_sent_at (nullable datetime) to Contract.
- New AI function in ai.py (not necessarily its own HTTP endpoint — can be called
  directly like generate_affordability_note() is from financing.py): given a
  contract nearing expiry, compare current rent to the district's updated average
  (_district_avg_monthly_rent / AreaIntelligence) and generate a renew/renegotiate/
  vacate note. New prompt RENEWAL_ASSISTANT in prompts.py, same fallback pattern.
- New scheduled job (mirror expire_assignments.py's structure and registration
  style in main.py, e.g. daily or every few hours): find contracts where end_date
  is within 45 days, status is active, and renewal_reminder_sent_at is null;
  generate the note; create a Notification for both tenant and landlord
  (construct it the same shape _deliver's callers use); set
  renewal_reminder_sent_at so it doesn't re-fire.

Acceptance: a contract expiring within the window gets exactly one reminder per
party, containing the AI (or fallback) note; contracts outside the window or
already reminded are untouched.

No new frontend needed — the existing generic notification rendering
(notificationDisplay.ts) already handles unknown types. Commit, update Status
table row 8 to Done. Stop there.
```

---

## Prompt 16 — Roommate/Family-Fit Matching: Backend

```
Read only: ROADMAP_AQAR_AI.md section 9, backend/app/models/user.py,
backend/app/models/area_intelligence.py (tags/family_score for reference, not
reuse — these are area-level not user-level), backend/app/api/routes/ai.py
(pattern reference).

Task: Let renters opt into roommate/family-fit matching.
- Migration: add preference fields to User — household_size, budget_min/max,
  lifestyle_tags (array/JSON), family_status, looking_for_roommate (bool, default
  false, this is the opt-in).
- New route (e.g. backend/app/api/routes/roommate_matching.py): submit/update own
  preferences; a matching endpoint that finds other opted-in users compatible on
  budget overlap/area/lifestyle tags, returning candidates with an AI-generated
  compatibility explanation (new prompt ROOMMATE_MATCH_ASSISTANT, same
  rate-limit/gateway/fallback pattern — deterministic fallback is a simple
  weighted score, similar in spirit to the existing trust-score formula in
  mobile/src/lib/trustScore.ts, just described in words instead of an LLM call).

Acceptance: a renter can set preferences and opt in, then get a list of compatible
candidates each with a short explanation of why they're a fit.

Backend only. Commit, update Status table row 9a to Done. Stop there.
```

---

## Prompt 17 — Roommate/Family-Fit Matching: Frontend (Mobile)

*(Prereq: Prompt 16 done)*

```
Read only: ROADMAP_AQAR_AI.md section 9, the new backend routes from the prior
session, mobile/app/(tabs)/profile.tsx and mobile/app/verification.tsx (screen
pattern reference), mobile/src/components/TrustBadge.tsx (compact-card pattern
reference).

Task: Mobile-only (myHome is the renter-facing app; this is a renter feature).
- New preference-setup screen (mirror verification.tsx's submit/status flow).
- New browse/matches screen: list compatible candidates with their AI
  compatibility explanation.
- "Express interest" action: no new chat system needed — just create a
  notification to the other user containing the AI explanation, reusing the
  existing notification creation shape from Prompt 15's session (or the general
  pattern in notifications.py if that's cleaner).

Acceptance: renter can opt in, set preferences, browse matches with an AI
explanation per match, and express interest in one.

Commit, update Status table row 9b to Done. Stop there.
```

