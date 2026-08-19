# myMakan Property Verification & Trust Center — Session-Sized Prompt Plan

This feature (full spec: see chat/task history — "Property Verification & Trust Center") is too large
for one Claude Code session. This document splits it into 12 prompts, ordered by dependency. Run them
one at a time, in order, each in a fresh session. Each prompt is self-contained.

Existing files this plan is grounded in (verified against the repo, 2026-08-16):

- `backend/app/models/property.py`, `mediator.py`, `review.py`, `user.py`, `audit_log.py`
- `backend/app/api/routes/properties.py`, `mediators.py`, `reviews.py`, `verification.py`, `property_request_admin.py`
- `backend/app/services/` — `data_confidence.py`, `price_intelligence.py`, `comparable_properties.py`,
  `property_decision_score.py`, `personalized_fit.py`, `negotiation_intelligence.py`, `smart_questions.py`,
  `property_highlights.py`, `property_intelligence_ai.py`, `home_finder_ai.py`, `home_finder_scoring.py`
- `backend/app/core/ai/gateway.py` (`get_client`, `run_chat`, `log_ai_call`), `core/ai/prompts.py`
- `backend/app/core/feature_flags.py`, `core/config.py`
- `frontend/src/routes/property.$id.tsx`, `components/maskan/PropertyCard.tsx`, `routes/agent.$id.tsx`
  (existing mediator/agent public profile page — web),
  `routes/partner.tsx` (+ `partner.requests*.tsx`, `partner.register.tsx`), `routes/admin.tsx` (+ `admin_.*.tsx`),
  `lib/i18n/en.ts` / `ar.ts`
- `mobile/app/property/[id].tsx`, `mobile/app/agent/[id].tsx` (existing mediator/agent public profile
  screen — mobile), `mobile/src/components/PropertyCard.tsx`

**Naming collision warning:** mobile already has `mobile/src/components/TrustBadge.tsx`
(`TrustBadgeChip`/`TrustBadgeCard`) with a `computeTrustScore`/`ApiTrustMetrics` helper — that is the
**renter's own identity-verification trust score** (mock-Nafath flow via `verification.tsx`), a completely
different concept from this spec's **listing/mediator trust**. Do not reuse, extend, or rename that
component for the new feature — name new components distinctly (e.g. `PropertyTrustBadge`,
`ListingTrustCenter`) so the two trust concepts stay visually and semantically separate for the user.

**Global constraints — copy into every session, non-negotiable:**
- Feature-first investor demo mode. Phase 1 (Rent + Buy) only. Do not start another feature.
- No Nafath/Ejar/REGA/payment verification/blockchain/new Redis/new queues/new microservices.
- Trust/completeness/consistency scores are 100% deterministic — never LLM-calculated.
- Verification wording: only "✓ Verified by myMakan" is allowed today. Never say "Government Verified",
  "REGA Verified", "Ejar Verified", "Nafath Verified". Keep the data model extensible for future external
  verification (a separate status per provider), but don't build the integrations.
- AI (via `core/ai/gateway.py`) may only explain/summarize/improve wording from facts it's given — never
  invent amenities, dimensions, location, verification, availability, price, complaints, or fraud claims.
- Reuse existing services (`data_confidence.py`, `price_intelligence.py`, etc.) rather than recalculating.
- Property Detail must render trust instantly from already-loaded data; AI explanation loads async, never blocks.
- Update `docs/implementation/mymakan-trust-center.md` incrementally as each prompt completes (create it in Prompt 1).

---

## Prompt 1 — Backend: Trust Model core service (deterministic)

Read `CLAUDE.md`, `docs/implementation/mymakan-phase1.md`, `docs/implementation/mymakan-property-intelligence.md`.

Scope: `backend/app/services/` only (new files), `backend/app/core/config.py` or a new
`backend/app/core/trust_config.py` for centralized/configurable weights, `backend/tests/`.

Build:
- `TrustAssessment` dataclass/schema: overall score, trust level (High/Good/Moderate/Limited Confidence),
  component scores, positive signals, missing information, things to verify, data confidence.
- Component calculators: Listing Completeness (reuse config pattern from `property_decision_score.py` for
  required/important/optional field weighting — spec section 7), Listing Consistency (spec section 10:
  info/warning/blocking severity, e.g. price<=0, area<=0, unreasonable bed/bath counts, rent/sale field
  mismatch, missing district), Mediator Trust (from `mediator.py`'s `is_verified`, ratings/review count via
  `review.py`, listing history), Listing Freshness (published/updated dates, thresholds configurable —
  spec section 16 categories: Recently Confirmed / Recently Updated / Needs Reconfirmation / Potentially Stale),
  Marketplace Confidence (reuse `comparable_properties.py` + `data_confidence.py`, do not recompute).
- If a component can't be calculated, omit it and renormalize remaining weights — never invent values.
- Weights centralized in one config object/dict, documented.

Do NOT add API routes or DB migrations yet (next prompt). Do NOT touch frontend/mobile.

Write unit tests for: completeness calc, trust score, missing-data normalization, freshness thresholds,
consistency severity classification.

Create `docs/implementation/mymakan-trust-center.md` with a "Trust Methodology" section documenting the
model. Report a concise summary only.

---

## Prompt 2 — Backend: Trust API + availability confirmation + reports DB + duplicate awareness

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md` (Prompt 1 output).

Scope: `backend/app/api/routes/properties.py` (or a new `trust.py` router included from `main.py`),
`backend/app/models/property.py`, a new `backend/app/models/property_report.py`, one new Alembic migration
in `backend/alembic/versions/`, `backend/app/services/` (duplicate detector), `backend/app/schemas/`, tests.

Build:
- `GET /api/v1/properties/{id}/trust` — returns the `TrustAssessment` from Prompt 1, built from
  already-loaded property/mediator/review data (no N+1 queries).
- Property model: add `availability_confirmed_at` (nullable timestamp) migration. Optional `quality_score`
  column only if you decide persistence is justified (prefer calculating on read).
- `PropertyReport` model per spec section 24 (id, property_id, reporter_user_id, reason enum, comment,
  status: Open/Under Review/Resolved/Dismissed, created_at, resolved_at, resolved_by, resolution_notes).
- `POST /api/v1/properties/{id}/reports` — authenticated, one active duplicate report per
  user/property/reason, audit-logged via existing `audit_log.py` pattern.
- Lightweight duplicate-awareness service (spec section 17): same mediator + location + characteristics,
  same image URL, same building+beds+size+similar price, normalized description match. Returns
  possible-duplicate + confidence + reasons. No auto-merge/delete.

Do NOT touch partner/admin endpoints (later prompts) or any frontend/mobile.

Tests: trust endpoint shape, availability confirmation persists, report creation + duplicate-report
rejection, duplicate-detector true/false cases, permission checks.

Append to `docs/implementation/mymakan-trust-center.md`: new APIs, DB changes.

---

## Prompt 3 — Backend: Partner listing quality API + AI description assist + image signals

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: new `backend/app/api/routes/partner_quality.py` (or extend existing partner routes if a file exists
under that name — check first), reuse Prompt 1's completeness calculator, `backend/app/core/ai/gateway.py`
+ `core/ai/prompts.py` for the AI-assist call, `backend/app/services/` (image quality signals), tests.

Build:
- `GET /api/v1/partner/properties/{id}/quality` — listing completeness % + missing-field suggestions
  (reuse Prompt 1's completeness calculator, same config used by customer Trust Center and admin).
- `POST /api/v1/partner/properties/{id}/confirm-availability` — sets `availability_confirmed_at` (from
  Prompt 2's column), permission-checked to the owning mediator.
- Deterministic image-quality signals (spec section 9): no images, too few images, duplicate image
  references, missing primary image, low resolution if dimensions available. No computer vision.
- AI "Improve with AI" endpoint: takes only the mediator's own supplied property facts, asks the gateway
  to improve description/title readability. Must not invent amenities/dimensions/location/price/
  verification/availability. Returns a suggestion the partner must explicitly approve — do not auto-save.

Do NOT touch admin or customer-facing endpoints. Do NOT touch frontend/mobile yet.

Tests: completeness reuse consistency with Prompt 1, missing-field suggestion accuracy, availability
confirmation permissions, AI-assist grounding (mock gateway, assert prompt contains only supplied facts).

Append APIs section to the progress doc.

---

## Prompt 4 — Backend: Mediator trust profile data + review intelligence AI summary

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: `backend/app/api/routes/mediators.py` (extend the existing `/public` endpoint), `backend/app/services/`
(new review-summary service), `core/ai/prompts.py`, tests.

Build:
- Extend mediator public response with trust/activity fields per spec section 11: verification status,
  rating, review count, active/rental/sale listing counts, areas covered, member-since, response info if
  available. All from existing `mediator.py`/`review.py`/`property.py` data — no new tracking infra.
- Review Summary service (spec section 12): AI-summarizes existing approved reviews into positive themes +
  considerations. Requires a minimum review count (configurable) before AI summary runs; below threshold,
  deterministic fallback (e.g. just show rating + count). AI must ground strictly in actual review text —
  no invented themes. Never modifies original reviews. English/Arabic.

Do NOT touch frontend/mobile. Do NOT build the AI Trust Summary (property-level) — that's Prompt 5.

Tests: mediator trust fields correctness, review summary minimum-count gating, grounding (mock gateway,
assert summary only references supplied review text), fallback behavior.

Append to progress doc.

---

## Prompt 5 — Backend: AI Trust Summary (property-level)

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: `backend/app/services/` (new, e.g. `trust_ai_summary.py`), `core/ai/prompts.py`,
likely exposed as part of the Prompt 2 trust endpoint response or a separate async-fetched field/route —
decide based on what keeps Property Detail non-blocking (spec section 22: deterministic assessment
displays immediately, AI explanation loads async).

Build: takes ONLY the Prompt 1 `TrustAssessment`, property facts, mediator trust facts, and the Prompt 4
review summary as input. Produces a short natural-language trust explanation (see spec section 18 example).
Must never accuse anyone of fraud, invent verification, invent complaints, infer criminal behavior, or make
unsupported safety claims. If the AI call fails, the caller must fall back to deterministic trust reasons
(no error state shown to the user).

Do NOT touch frontend/mobile.

Tests: grounding (mock gateway, assert input contains only the four permitted sources), fallback on
gateway failure, no-blocking contract (function is separately callable/awaitable from the trust endpoint).

Append to progress doc.

---

## Prompt 6 — Backend: Admin moderation extensions

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: extend `backend/app/api/routes/property_request_admin.py` pattern (mirror it) or add
`backend/app/api/routes/admin_trust.py`, reuse `audit_log.py`, reuse Prompts 1-2's services, tests.

Build (spec sections 14-15):
- Dashboard aggregate endpoint(s): counts for listings requiring review, low-completeness listings, stale
  listings, open reports, mediators pending verification, recently reported properties.
- Property moderation list endpoint: property, transaction type, city, mediator, trust score,
  completeness, freshness, report count, status — filterable by rent/sale, trust level, completeness,
  reported, stale, mediator verification, city.
- Property review detail endpoint: full trust assessment + data quality + mediator info + reports +
  property intelligence (reuse existing services, do not recompute) + moderation history (from
  `audit_log.py`).
- Actions, each audit-logged and permission-checked against existing admin auth: hide/unpublish (reuse
  existing property status mechanism — check `property.py` for the status enum first), restore, resolve
  report (Open → Under Review/Resolved/Dismissed).

Do NOT build a separate moderation platform — extend the existing admin route/permission patterns. Do NOT
touch frontend/mobile.

Tests: dashboard counts correctness, filter combinations, review detail assembly, moderation action
permission checks, audit log entries created, report status transitions.

Append to progress doc.

---

## Prompt 7 — Web: Customer Property Trust Center UI

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md` (all backend APIs now exist).

Scope: `frontend/src/routes/property.$id.tsx`, `frontend/src/components/maskan/` (new Trust Center
components), `frontend/src/lib/api/maskan.ts` (new API calls for Prompts 2/5 endpoints),
`frontend/src/lib/i18n/en.ts` + `ar.ts` (new keys, follow existing nesting convention), `PropertyCard.tsx`.

Build (spec sections 5, 6, 19):
- Trust badge/entry on Property Detail: score, level, 3-4 top positive/needs-verification signals,
  "View Trust Details" action. Renders from the deterministic `/trust` endpoint immediately; AI Trust
  Summary (Prompt 5) loads async underneath without blocking.
- Trust Center sheet/page: Listing Confidence (completeness with ✓/△ per field), Mediator block (reuse
  data already on the page where possible), Listing Freshness, Price Confidence (reuse existing Property
  Intelligence UI/data — do not recalculate), Things to Verify (deterministic list from the assessment),
  Report a Concern action (opens Prompt-9's report modal — stub the trigger now).
- Small trust signals on `PropertyCard.tsx` (✓ myMakan Verified / 92% Complete / Recently Updated) — keep
  minimal, don't clutter the card.
- Verification component: reusable "Verification" block showing myMakan ✓ vs future providers
  ("Not connected"), per spec section 21 — build the component generically now, only render the myMakan row.

Do NOT touch mobile, partner, or admin. Arabic RTL must work — test both locales.

Report a concise summary; do a quick visual check via `run` skill/dev server if practical.

---

## Prompt 8 — Web: Partner listing quality assistant + duplicate warning UI

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: partner property create/edit form under `frontend/src/routes/partner*.tsx` (locate the actual
create/edit form first — it wasn't found by name in the initial scan, so identify it before editing),
`frontend/src/lib/api/maskan.ts`, i18n files.

Build (spec sections 8, 9, 16, 17):
- "Listing Quality" panel: live completeness % (from Prompt 3 endpoint) that updates as fields are filled,
  suggestion list, "Improve with AI" flow (shows AI suggestion, partner must explicitly approve before it's
  applied to the form — never auto-saved).
- "Confirm Availability" action wired to Prompt 3's confirm-availability endpoint.
- Duplicate warning: before publish, call Prompt 2's duplicate-detector; if flagged, show "This listing may
  already exist" with a compare/continue-anyway choice — never auto-block.
- Image quality suggestions surfaced near the image upload UI.

Do NOT touch customer or admin UI. Do NOT touch mobile.

---

## Prompt 9 — Web: Mediator trust profile + review summary + report listing modal

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: `frontend/src/routes/agent.$id.tsx` (existing mediator/agent public profile page — extend it, do not
create a new one; it already links from Property Detail's contact section), a new Report Listing modal
component wired into Prompt 7's "Report a Concern" trigger, i18n files.

Build (spec sections 11, 12, 13):
- Mediator "Trust & Activity" section: verification badge, rating, review count, listing counts, areas
  covered, member-since. Include a "What does myMakan Verified mean?" explainer (plain language, explicitly
  not government verification).
- Review Summary block: rating, count, AI-generated positive themes/considerations (Prompt 4), with a
  visible "AI Summary" label and deterministic fallback when below minimum review count.
- Report Listing modal: reason list from spec section 13, optional comment, submits to Prompt 2's endpoint,
  handles the "already reported" case gracefully.

Do NOT touch admin or mobile.

---

## Prompt 10 — Mobile: Customer Trust Center + report + mediator trust parity

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`. Treat Prompts 7 and 9 as the reference
implementation — mirror their behavior and copy, not the pixel layout.

Scope: `mobile/app/property/[id].tsx`, `mobile/app/agent/[id].tsx` (existing mediator/agent profile
screen — extend it, do not create a new one), `mobile/src/components/` (new Trust Center components — see
the naming-collision warning at the top of this doc: do NOT touch or extend `TrustBadge.tsx`, that's the
renter's own identity-verification badge, unrelated to listing/mediator trust), `mobile/src/lib/api/maskan.ts`,
`mobile/src/lib/i18n/en.ts` + `ar.ts`.

Build: property-listing trust badge + Trust Center screen/sheet on property detail (new component, name it
distinctly from `TrustBadge`, e.g. `PropertyTrustBadge`), PropertyCard trust signals, Report Listing flow,
mediator "Trust & Activity" section + review summary added to `mobile/app/agent/[id].tsx`. Same content
rules as web: deterministic first, AI async, myMakan-only verification wording.

Do NOT touch web, partner, or admin. Do NOT add a partner-portal surface to mobile — none exists today and
the spec's partner flows (listing quality, confirm availability, publish) are web/partner-portal only.

---

## Prompt 11 — Web: Admin Trust & Moderation dashboard + property review page

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md`.

Scope: `frontend/src/routes/admin.tsx` + new `admin_.trust-moderation.tsx` (or similar, following the
existing flat-file admin routing convention seen in `admin_.property-requests.tsx`), i18n files.

Build (spec sections 14, 15): dashboard cards from Prompt 6's aggregate endpoint; moderation table with the
specified columns and filters; property review detail page showing property/trust/data-quality/mediator/
reports/property-intelligence/moderation-history sections with action buttons (review property, review
mediator, view reports, request correction, hide/unpublish, restore, resolve report) calling Prompt 6's
endpoints. Gate actions behind existing admin permission checks — don't invent a new permission system.

Do NOT touch customer, partner, or mobile.

---

## Prompt 12 — Tests pass, demo verification, and progress doc finalization

Read `CLAUDE.md` and `docs/implementation/mymakan-trust-center.md` (should now have incremental sections
from Prompts 1-11).

Scope: `backend/tests/`, any missing frontend/mobile test coverage, `docs/implementation/mymakan-trust-center.md`.

Do:
- Run only the affected backend test files (trust, completeness, consistency, freshness, reports,
  duplicate detection, partner quality, mediator trust, review summary grounding, AI trust-summary
  grounding, admin moderation, permissions) and fix any regressions — don't run the full unrelated suite.
- Spot-check the frontend/mobile builds affected by Prompts 7-11 (typecheck at minimum; use the `run` skill
  to click through the investor demo storyline in spec section 20 on web if practical: AI Home Finder match
  → Property → Intelligence → Trust & Verification → 89/100 → Verified mediator → Completeness → Freshness
  → Rating → AI Summary → Things to Verify → Smart Questions → Contact; then Partner: Quality 72% → add
  details → 91% → Confirm Availability → Publish; then Admin: Trust & Moderation → reported/stale listing →
  review data quality → review mediator → resolve).
- Finalize `docs/implementation/mymakan-trust-center.md`: what was implemented, trust methodology,
  verification terminology, customer/partner/admin changes, APIs, DB changes, tests, known limitations,
  future external-verification extension points, investor demo steps.

Report a concise implementation summary only — this is the final prompt in the sequence.
