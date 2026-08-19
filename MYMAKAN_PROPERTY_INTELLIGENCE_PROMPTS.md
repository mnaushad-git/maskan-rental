# myMakan Property Intelligence & AI Decision Center — Copy-Paste Session Prompts

Companion to the original "myMakan Property Intelligence & AI Decision Center" brief,
same pattern as `MYMAKAN_PHASE1_PROMPTS.md`. Run these **in order, one per fresh Claude
Code window/session**. Each prompt is self-contained: it lists exactly which files to
read (so the session doesn't re-explore the whole repo) and exactly when to stop. Do not
paste two prompts into the same session.

Working directory: repo root. Branch: `feature/mymakan-phase1` (current branch — stay on
it unless told otherwise).

All progress is tracked in `docs/implementation/mymakan-property-intelligence.md`
(created in Prompt 1). If a session runs out before finishing its prompt, the next
session should read that doc first to see what's already done.

**Note on `CLAUDE.md`:** there is no repo-root `CLAUDE.md` in this project (only
`mobile/CLAUDE.md`). Prompts below that say "Read: CLAUDE.md" mean "read
`mobile/CLAUDE.md` if it exists, otherwise skip" — only Prompt 11 (mobile) needs it.

**Ground truth already gathered** (so later prompts don't need to re-discover it):
- `property.$id.tsx` (web) and `mobile/app/property/[id].tsx` are monolithic single-file
  routes, not split into named sub-components — there is no `Summary`/`ActionsCard`/
  `RentalIntelligence`/`FairRent` component to import; new UI is added as new sections
  inside these files (or extracted into new components you create).
- The existing AI **`rental_score`** endpoint (`backend/app/api/routes/ai.py:868`, POST
  `/ai/rental-score`, deterministic fallback `_deterministic_rental_score` at line 848)
  is a 0–100 "quality/value" badge shown today on the property page. It is **not** a fair
  *range* and must not be duplicated — the new Price Intelligence service is a distinct,
  additive capability. Say so explicitly in the tracking doc so nobody merges the two.
- `backend/app/api/routes/properties.py:246` `get_similar_properties`
  (`GET /properties/{id}/similar`) already does a cheap same-city/status comparable query
  — extend this pattern for the new comparable-selection service rather than inventing a
  new query style.
- `backend/app/services/home_finder_scoring.py` (`WEIGHTS` dict, `score_property`,
  `rank`, `pick_categories`, missing-dimension renormalization) is the existing pattern
  for deterministic, centrally-weighted scoring with graceful missing-data handling —
  the new Decision Score and Personalized Fit services should follow the same shape and,
  where the dimension is literally the same (budget/location/bedrooms/amenities/lifestyle
  fit against user criteria), reuse its logic rather than reimplementing it.
- `frontend/src/routes/home-finder.tsx:931` and `mobile/app/home-finder.tsx:777` already
  have a `WhyThisPropertyModal` component (`{ result, criteria, onClose }`) — this is
  the base to upgrade into the richer Decision Sheet, not something to duplicate.
- AI Advisor context handoff already exists: `property.$id.tsx` sets
  `sessionStorage.setItem("maskan_advisor_ctx", ...)` before navigating to `/advisor`,
  which reads/clears it. Reuse this exact mechanism for "Ask myMakan" quick questions.
- Feature flags: `backend/app/core/feature_flags.py` (`FLAGS` dict + `is_enabled()`),
  `backend/app/core/config.py` (`Settings`), frontend mirror
  `frontend/src/lib/phase1-flags.ts` (`PHASE1_FLAGS`, manually kept in sync, no backend
  fetch) — follow this exact pattern for the new `FEATURE_PROPERTY_INTELLIGENCE` flag.

---

## Prompt 1 — Feature flag + tracking doc + deterministic Property Decision Score

```
Read only: docs/implementation/mymakan-ai-home-finder.md,
backend/app/models/property.py, backend/app/models/area_intelligence.py,
backend/app/schemas/property.py (PropertyOut only),
backend/app/services/home_finder_scoring.py (full file — this is your pattern
reference for weighting + missing-dimension renormalization),
backend/app/core/feature_flags.py, backend/app/core/config.py.

We are building myMakan's "Property Intelligence & AI Decision Center" — a
decision-support upgrade to the existing Property Detail page. Full scope
lives only in the user's original brief (not in this repo); this prompt file
breaks it into small steps. Do NOT read ahead into later prompts' scope.

Task:
1. Add a new feature flag `FEATURE_PROPERTY_INTELLIGENCE` (default ON) to
   `feature_flags.py`/`config.py`/`.env.example`, following the exact existing
   pattern (see e.g. `area_intelligence`/`FEATURE_AREA_INTELLIGENCE`). No new
   flag mechanism.
2. Create `docs/implementation/mymakan-property-intelligence.md` with these
   section headers (fill what you know now, leave the rest
   `TODO — filled in by a later prompt`): Feature completed / Existing
   functionality reused / APIs / Scoring methodology / Price-intelligence
   methodology / Comparable methodology / Data-confidence methodology / AI
   usage / Screens changed / Tests / Known data limitations / Investor demo
   steps. Note explicitly that the existing AI `rental_score` endpoint
   (ai.py:868) is a separate 0-100 quality badge, not reused/replaced here.
3. Create `backend/app/services/property_decision_score.py`: a deterministic
   (no LLM) `score_property_decision(property, area_intel=None,
   comparable_count=0) -> PropertyDecisionScore` computing these dimensions
   when data is available: price_value, location_fit, property_fit,
   amenities, area, listing_confidence. (price_value and location_fit will
   initially be placeholder-simple since Price Intelligence and Comparables
   don't exist yet — a later prompt will wire richer inputs in; keep the
   function signature stable and accept optional richer inputs as `None` for
   now.) Central `WEIGHTS` dict summing to 1.0, defined once. Any dimension
   whose required data is missing is excluded and the remaining weights
   renormalize (mirror home_finder_scoring's approach). Return: overall
   0-100 score, per-dimension scores, one-line deterministic reason string
   per dimension, and a list of which dimensions were omitted for missing
   data.
4. Unit tests in `backend/tests/test_property_decision_score.py`: full-data
   case, missing-amenities case (renormalization), missing-area-intel case,
   verify weights always sum to 1.0 pre-renormalization.

Do not add any API route. Do not touch frontend or mobile. Fill in only the
"Scoring methodology" section of the tracking doc (plus the note in step 2).
Run `pytest backend/tests/test_property_decision_score.py -q` and confirm it
passes. Commit is not required. Stop there.
```

---

## Prompt 2 — Price Intelligence service (Rent + Buy), deterministic

```
Read only: docs/implementation/mymakan-property-intelligence.md,
backend/app/api/routes/ai.py (lines ~824-920 only — rental_score,
_deterministic_rental_score, _district_avg_monthly_rent — to understand and
NOT duplicate the existing quality-score endpoint),
backend/app/models/property.py, backend/app/core/search/filters.py.

Task: create `backend/app/services/price_intelligence.py` with two entry
points, both deterministic (no LLM):

1. `rent_price_intelligence(db, property) -> RentPriceIntelligence`: pulls
   comparable *rent* listings (same city, same/similar district, similar
   bedrooms/size, Published status — reuse `build_property_filters`/query
   style from `filters.py`, bounded query, no N+1). Computes a fair range
   from the comparable distribution (e.g. an interquartile-style spread
   around the median — pick a simple, explainable method and document it),
   asking rent, % difference from midpoint, and a classification (Excellent
   Value / Good Value / Fair / Above Market / Significantly Above Market)
   via centrally-defined deviation thresholds. Also returns the list of
   factors actually used (district, type, bedrooms, bathrooms, size,
   furnishing — only ones with real data).
2. `buy_price_intelligence(db, property) -> BuyPriceIntelligence`: same idea
   for *sale* listings — price/sqm using `size_sq_m`, comparable median
   price/sqm, estimated value range, % difference, same classification
   scale.
3. Insufficient-data path: if fewer than 3 usable comparables exist, return
   a `sufficient_data=False` result with an explanation string and no
   fabricated range/classification — never invent numbers.

Unit tests in `backend/tests/test_price_intelligence.py`: rent classification
across all 5 buckets, buy price/sqm + range calc, insufficient-data fallback
(both rent and buy), factor list only lists fields with real data.

No API route yet, no frontend/mobile changes. Update only the
"Price-intelligence methodology" section of the tracking doc (include the
range-calculation method and thresholds you chose). Run
`pytest backend/tests/test_price_intelligence.py -q`. Stop there.
```

---

## Prompt 3 — Comparable properties + Data Confidence service

```
Read only: docs/implementation/mymakan-property-intelligence.md,
backend/app/api/routes/properties.py (lines ~240-275, get_similar_properties
only), backend/app/core/search/filters.py,
backend/app/models/area_intelligence.py,
backend/app/services/price_intelligence.py (from Prompt 2, for its
comparable-query pattern — reuse rather than re-deriving it independently).

Task:
1. `backend/app/services/comparable_properties.py`:
   `find_comparable_properties(db, property, limit=10) ->
   list[ComparableProperty]` — same transaction_type + city + similar
   district/property_type/bedrooms/size range/price range, Published only,
   eager-load `listing_images` to avoid N+1, bounded to `limit` (cap 10 per
   the brief). Extend `get_similar_properties`'s approach rather than
   inventing a new query style — same file/module is fine if that's the
   cleanest home for it, otherwise this new service file. Each result
   includes: price difference vs. subject property, price/sqm (buy only),
   a deterministic match-similarity % (based on how many of
   district/type/bedrooms/size-band/price-band actually match), and a value
   label (Better Value / Similar Price / Higher Price) only when
   deterministically supported by price difference.
2. `backend/app/services/data_confidence.py`:
   `compute_data_confidence(property, area_intel, comparable_count) ->
   DataConfidence` returning High/Moderate + a deterministic one-line reason
   string. Inputs: core listing completeness (specs, images, coordinates,
   mediator verification present), comparable_count from step 1, whether
   area intelligence exists for the district. Never implies government
   verification.

Unit tests: `backend/tests/test_comparable_properties.py` (ordering, value
labels, match-similarity calc, bounded limit, no N+1 — assert query count if
feasible), `backend/tests/test_data_confidence.py` (High vs Moderate cases,
reason string content).

No API route, no frontend/mobile changes. Update "Comparable methodology" and
"Data-confidence methodology" sections of the tracking doc. Run both new test
files. Stop there.
```

---

## Prompt 4 — Personalized fit, strengths/considerations, smart questions, negotiation insight

```
Read only: docs/implementation/mymakan-property-intelligence.md,
backend/app/services/home_finder_scoring.py (score_property, criteria
matching helpers — reuse these for personalized fit rather than
reimplementing budget/location/bedrooms/amenity matching rules),
backend/app/schemas/home_finder.py (HomeFinderCriteria shape),
backend/app/models/property.py,
backend/app/services/price_intelligence.py,
backend/app/services/comparable_properties.py.

Task, all deterministic (no LLM) in new files under backend/app/services/:

1. `personalized_fit.py`: `personalized_fit(property, criteria:
   HomeFinderCriteria) -> PersonalizedFit` — reuses home_finder_scoring's
   per-dimension matching logic (import/call it, don't duplicate) to produce
   a list of `{label, status: match|moderate|miss, detail}` rows (e.g.
   "3 Bedrooms — Match", "Under SAR 75K — Match") plus an "N/M priorities
   matched" summary. Returns `None`/absent cleanly when no criteria supplied
   — never fabricate personalization.
2. `property_highlights.py`: deterministic strengths/considerations/
   things-to-verify generator, fed by the property fields + the Prompt 2/3
   outputs (price_intelligence, comparables) + area_intel. "Things to
   verify" only from genuinely missing/ambiguous fields (e.g. no furnishing
   data recorded → "Verify furnishing inventory") — never claim a problem
   that isn't evidenced.
3. `smart_questions.py`: `generate_smart_questions(property) -> list[str]`
   — 4-7 questions from a rent question bank and a separate buy question
   bank (see brief examples: negotiable rent, payment count, maintenance,
   parking assignment, availability date, furnishings for rent; property
   age, service charges, occupancy, renovations, what's included for buy).
   Skip any question whose answer is already present on the listing.
4. `negotiation_intelligence.py`: `negotiation_insight(property,
   price_intelligence) -> NegotiationInsight | None` — asking price, market
   midpoint, a discussion range, and a plain-language approach sentence,
   computed only when `price_intelligence.sufficient_data` is True (Prompt
   2); returns `None` otherwise. Never claims a guaranteed outcome.

Unit tests (one file per module is fine, keep them short):
`backend/tests/test_personalized_fit.py`,
`backend/tests/test_property_highlights.py`,
`backend/tests/test_smart_questions.py`,
`backend/tests/test_negotiation_intelligence.py`. Cover: no-criteria case,
full-match vs. partial-match, question filtering when data is known,
negotiation omitted when comparables insufficient.

No API route, no frontend/mobile changes. Update the tracking doc noting all
four modules are deterministic. Run the four new test files. Stop there.
```

---

## Prompt 5 — Assembly API: `GET /properties/{id}/intelligence`

```
Read only: docs/implementation/mymakan-property-intelligence.md,
backend/app/api/routes/properties.py (router setup + get_similar_properties
for the eager-loading/query-shape pattern),
backend/app/api/routes/home_finder.py (for the `_require_enabled`
feature-flag-gating pattern and how it accepts a criteria payload),
backend/app/schemas/property.py, backend/app/core/feature_flags.py,
and every service file created in Prompts 1-4
(backend/app/services/property_decision_score.py, price_intelligence.py,
comparable_properties.py, data_confidence.py, personalized_fit.py,
property_highlights.py, smart_questions.py, negotiation_intelligence.py).

Task:
1. `backend/app/schemas/property_intelligence.py`: response schema with
   fields `decision_score`, `component_scores`, `data_confidence`,
   `price_intelligence`, `comparable_summary`, `strengths`, `considerations`,
   `things_to_verify`, `personalized_fit` (nullable), `smart_questions`,
   `negotiation_intelligence` (nullable), `area_intelligence` (a small
   reference object — area name/score/short summary, not a full duplicate of
   the Area Intelligence model).
2. Add `GET /api/v1/properties/{id}/intelligence` in `properties.py`
   (extend the existing router, per the brief's "avoid unnecessary API
   proliferation" — do not create a new top-level router). Gate it behind
   `FEATURE_PROPERTY_INTELLIGENCE` the same way `home_finder.py` gates its
   router. Decide how personalization criteria are supplied: if
   `HomeFinderCriteria` can be encoded as query params cleanly, do that;
   otherwise add optional query params for just the handful of fields the
   brief actually needs (budget, bedrooms, districts, required amenities) —
   document your choice in the tracking doc rather than over-designing it.
3. Wire all 8 services together with ONE property fetch (eager-loaded
   relations) and bounded comparable/area queries — no N+1. Missing-data
   dimensions must propagate as omitted, not fabricated, at every layer.

Tests in `backend/tests/test_property_intelligence_api.py`: full 200 response
shape for a rent fixture and a sale fixture, `personalized_fit` is
null/absent with no criteria and populated with criteria, feature-flag-off
behavior (404/503, matching home_finder's convention), a minimal-data
property (few fields, no comparables) still returns 200 with appropriate
omissions rather than erroring.

No frontend/mobile changes. Update the tracking doc's "APIs" section with the
final endpoint signature and the criteria-passing decision from step 2. Run
the new test file plus `pytest backend/tests/test_price_intelligence.py
backend/tests/test_comparable_properties.py -q` as a smoke check nothing
regressed. Stop there.
```

---

## Prompt 6 — AI Summary endpoint (grounded, deterministic-fallback)

```
Read only: docs/implementation/mymakan-property-intelligence.md,
backend/app/core/ai/gateway.py (run_chat signature),
backend/app/core/ai/prompts.py (registry pattern — _register/get_prompt),
backend/app/services/home_finder_ai.py (explain_match function only — this
is the exact pattern to mirror: grounded narration over deterministic data,
with a safe fallback on AI failure),
backend/app/api/routes/ai.py (rate_limit_dependency usage only),
backend/app/schemas/property_intelligence.py (from Prompt 5).

Task:
1. Add a new prompt template (e.g. `PROPERTY_INTELLIGENCE_SUMMARY`) to
   `prompts.py` whose instructions make clear: explain the given
   deterministic facts only, never invent numbers, never assign scores,
   never calculate a valuation, keep it short (2-4 sentences), and support
   both English and Arabic output.
2. `backend/app/services/property_intelligence_ai.py`:
   `summarize_property_intelligence(intelligence, language) -> str` — builds
   a compact facts block strictly from the Prompt 5 intelligence payload
   (score, price classification, top strengths/considerations,
   personalized-fit summary if present), calls `run_chat`, and returns a
   grounded summary. Deterministic template fallback (both languages) if
   `ANTHROPIC_API_KEY` is unset or the call fails — mirror
   `_FALLBACK_REASONING`'s approach in ai.py.
3. Add `POST /api/v1/properties/{id}/ai-summary` in `properties.py`
   (`{language: "en"|"ar"}` body), rate-limited the same way
   `ai_rental_score` is (`rate_limit_dependency`), gated behind
   `FEATURE_PROPERTY_INTELLIGENCE`.

Tests in `backend/tests/test_property_intelligence_ai.py`: grounding (mock
`run_chat`, assert the facts passed to it match the intelligence payload —
no fabricated content reaches the prompt), fallback on AI failure/no API key,
Arabic output requested and returned, and an explicit
"AI response containing an invented number/score is not blindly trusted" note
if you find the gateway has no existing validation for that (flag as a known
limitation in the tracking doc if so, don't over-engineer a validator here).

No frontend/mobile changes yet. This completes the entire backend surface.
Update the tracking doc's "AI usage" section. Run
`pytest backend/tests/test_property_intelligence_api.py
backend/tests/test_property_intelligence_ai.py -q` plus the full backend
suite (`pytest -q`) to confirm nothing else regressed — note any pre-existing
unrelated failures (there is a known one,
`test_list_properties_date_range_filter_excludes_conflicting_booking`, not
yours to fix). Stop there.
```

---

## Prompt 7 — Web: Intelligence hero + Decision Score + Price Intelligence UI

```
Read only: docs/implementation/mymakan-property-intelligence.md,
frontend/src/routes/property.$id.tsx (skim for structure/imports and the
existing hero/price area — it's ~2500 lines, you don't need to read all of
it; also note the ContactModal (~line 1295) and the sessionStorage advisor
handoff (~line 1549) locations for later prompts),
frontend/src/lib/api/maskan.ts (existing fetch/type patterns, especially
fetchRentalScore ~line 1326 as a template for the new call),
frontend/src/components/maskan/ScoreIndicator.tsx,
frontend/src/components/maskan/Badges.tsx,
frontend/src/lib/i18n/en.ts and ar.ts (the `property` namespace, ~line 508),
frontend/src/lib/phase1-flags.ts.

Task:
1. Add `fetchPropertyIntelligence(propertyId, criteria?)` to `maskan.ts`
   calling `GET /properties/{id}/intelligence` (matching whatever
   query-param shape Prompt 5 landed on), typed to match
   `property_intelligence.py`'s schema.
2. In `property.$id.tsx`: fetch intelligence *after* the existing property
   data has rendered (separate loading state; the page must remain fully
   usable if this call is slow or fails — show a lightweight skeleton, then
   hide the section gracefully on error, never block the rest of the page).
3. Render a "myMakan Intelligence" hero section near the top: match % (only
   if personalized_fit present), value classification, asking price, fair
   range, one-line personalized summary if available, and action buttons —
   Why this property? / Compare / Ask myMakan / Contact Agent — wired to
   existing handlers/routes where they already exist (compare selection,
   ContactModal, advisor handoff), placeholder/no-op only for pieces built
   in later prompts (say so with a short TODO comment).
4. Render a Property Decision Score card (overall + per-dimension bars via
   the existing `ScoreBar`/`ScoreRing`), only showing present dimensions.
5. Render a Price Intelligence card: Rent variant (fair range, classification,
   factors used) or Buy variant (price/sqm, comparable median, range,
   classification), plus the "Limited market data" fallback state when
   `sufficient_data` is false. Include the required disclaimer copy ("myMakan
   market estimate based on available platform data") for Buy.
6. Add new i18n keys under `property.intelligence.*` in both `en.ts`/`ar.ts`
   (RTL-safe strings, no hardcoded direction assumptions).

Do not build comparables/area/questions/negotiation sections yet — later
prompts. Verify: `npx tsc --noEmit` and `npx vite build` in `frontend/`, both
clean. Start the dev server and manually check one rent property and one
sale property page render the new hero/score/price sections without console
errors (use whatever real property ids exist in the dev DB). Update the
tracking doc's "Screens changed" section (web, partial). Stop there.
```

---

## Prompt 8 — Web: Similar Properties + At a Glance + Area Intelligence embed

```
Read only: docs/implementation/mymakan-property-intelligence.md,
frontend/src/routes/property.$id.tsx (current state after Prompt 7),
frontend/src/components/maskan/PropertyCard.tsx (or wherever the property
card component lives — locate via the intelligence-hero/comparables area you
just added), frontend/src/routes/areas.tsx (for the area-intelligence
display fields/summary format to mirror), the `fetchAreaIntelligence` call
in frontend/src/lib/api/maskan.ts.

Task:
1. "Similar Properties" section rendering `comparable_summary` from the
   intelligence payload using the existing `PropertyCard`, with a
   Better Value / Similar Price / Higher Price badge (reuse the `Badge`
   component) and a "Compare with this property" action wired into whatever
   page-local compare-selection pattern already exists elsewhere in this
   codebase (e.g. `compareIds` state used on `search.tsx`/`compare.tsx`) —
   do not build a new compare mechanism.
2. "At a Glance" — Strengths / Considerations two-column (or stacked on
   mobile web) card section from `intelligence.strengths` /
   `intelligence.considerations`, plus a small "Things to verify" list if
   present.
3. Condensed Area Intelligence embed: "Living in {district}" with
   lifestyle/school/hospital-access scores, rent trend, typical price/rent
   band, and the existing area overview text, plus an "Explore {district}"
   link into the existing `/areas` page for that district (do not duplicate
   the Area Intelligence backend or build a second summary).
4. Data Confidence badge (High/Moderate) with an expandable "Why?" showing
   the deterministic reason string from the API.
5. Keep initial render light per the brief's performance requirement: put
   Similar Properties / Area Intelligence embed behind either a details
   toggle, an intersection-observer-based lazy render, or render-on-scroll —
   pick whichever is simplest given this file's existing patterns (check if
   anything already does lazy/expand-collapse elsewhere in this repo before
   introducing a new pattern).

New i18n keys in `en.ts`/`ar.ts`, RTL-checked. Verify `npx tsc --noEmit` +
`npx vite build` clean, and manually check both property types in the dev
server. Update the tracking doc. Stop there.
```

---

## Prompt 9 — Web: Decision Sheet upgrade, Personalized Fit, Smart Questions, Negotiation Insight, Ask myMakan

```
Read only: docs/implementation/mymakan-property-intelligence.md,
frontend/src/routes/home-finder.tsx (WhyThisPropertyModal, ~line 931 — the
component to generalize/upgrade), frontend/src/routes/property.$id.tsx
(current state; the sessionStorage advisor handoff ~line 1549 and
ContactModal ~line 1295), frontend/src/routes/advisor.tsx and
frontend/src/components/maskan/AiChat.tsx (deep-link pattern),
frontend/src/components/maskan/ContactButtons.tsx,
frontend/src/routes/lead.new.tsx (message/prefill fields, if any).

Task:
1. Generalize `WhyThisPropertyModal` (extract to a shared component if that's
   clean, otherwise keep it in home-finder.tsx and import it — your call,
   document which) into a richer Decision Sheet with three sections: Why it
   works / Trade-offs / Things to verify, sourced from the intelligence
   payload's strengths/considerations/things_to_verify. Wire
   `property.$id.tsx`'s "Why this property?" button (added in Prompt 7) to
   open it.
2. "How it fits your needs" personalized suitability section on
   `property.$id.tsx`, rendered ONLY when `personalized_fit` is present in
   the intelligence response (i.e. the user arrived with home-finder
   criteria or an active search context) — check how navigation from
   home-finder results to a property currently passes context (query param,
   sessionStorage, or nothing) and extend that minimally if no context
   currently survives the navigation; do not fabricate personalization when
   none exists.
3. "Smart Questions" section: list from `intelligence.smart_questions`,
   "Copy Questions" (clipboard), and "Send to Agent" that reuses the
   existing lead/message journey — prefill into `lead.new.tsx`'s message
   field or the property page's `ContactModal` textarea (whichever already
   accepts free text), not a new messaging system.
4. "Negotiation Insight" card from `intelligence.negotiation_intelligence`
   (omit the whole section when it's null/insufficient data), with a
   "Draft Message" action. If Prompt 6's AI-summary endpoint doesn't already
   support a negotiation-message variant, add one small optional parameter
   to it rather than building a second AI endpoint — check first. Drafted
   text appears in an editable textarea for the user to review; never
   auto-sends.
5. Extend the AI Advisor handoff with property-aware quick questions (the
   ~7 from the brief: fair pricing, compromises, compare, what to ask agent,
   family suitability, negotiate help, area info, + price/sqm and rental
   income for Buy) passed through the existing `sessionStorage`
   ("maskan_advisor_ctx") mechanism — do not build a separate chat surface.

New i18n keys, RTL-checked. Verify `npx tsc --noEmit` + `npx vite build`
clean; manually check the full flow (home-finder → property → Why this
property / Smart Questions / Negotiation / Ask myMakan) in the dev server.
Update the tracking doc. Stop there.
```

---

## Prompt 10 — Web: Compare enhancement + layout/performance pass + sticky actions

```
Read only: docs/implementation/mymakan-property-intelligence.md,
frontend/src/routes/compare.tsx, frontend/src/routes/property.$id.tsx
(full current state after Prompts 7-9).

Task:
1. Extend `compare.tsx` to show, per compared property (bounded to however
   many the page already supports, typically ≤4): Decision Score, Match
   Score (if available), fair-price classification, area score,
   verification, and strength/consideration counts — fetched via
   `GET /properties/{id}/intelligence` per property (bounded batch, not
   N+1 per render).
2. Add a deterministic "myMakan Recommendation" row: Best Overall / Best
   Value / Best Location, computed by a small pure function (mirror
   `home_finder_scoring.py`'s category-picking style — could live in the
   frontend if the comparison is simple arithmetic over already-fetched
   scores, or as a tiny backend helper if it needs data the frontend
   doesn't have; your call, document it). AI may only add a one-line
   "why" explanation per winner (reuse the AI-summary endpoint or a
   short deterministic template if AI involvement isn't worth a new call)
   — AI must never choose the winner itself.
3. Confirm `property.$id.tsx`'s section order matches: Images → Price/Core
   Details → myMakan Intelligence hero → Personalized Fit → Price
   Intelligence → Strengths & Considerations → Comparable Properties → Area
   Intelligence → Smart Questions → Negotiation Insight → Ask myMakan →
   Agent/Contact. Reorder if Prompts 7-9 landed sections out of this order.
   Make sure lower sections are collapsed-by-default or lazy-rendered
   (should already be true from Prompt 8 — confirm, don't redo).
4. Add a sticky bottom action bar at mobile-web viewport widths only:
   primary "Contact Agent", secondary "Save" and "Ask AI" — reuse existing
   handlers, no new logic.

Verify `npx tsc --noEmit` + `npx vite build` clean; manually check compare
with 2-3 real properties and both a rent and sale property page at a mobile
viewport width. Update the tracking doc's "Screens changed" (web) and start
"Investor demo steps" with the web Rent and web Buy walkthroughs. Stop there.
```

---

## Prompt 11 — Mobile: mirror the full experience

```
Read only: mobile/CLAUDE.md (if present),
docs/implementation/mymakan-property-intelligence.md,
mobile/app/property/[id].tsx, mobile/app/home-finder.tsx
(WhyThisPropertyModal, ~line 777), mobile/app/compare.tsx,
mobile/src/lib/api/maskan.ts, mobile/src/lib/i18n/en.ts and ar.ts,
mobile/src/components/ui/ (list the directory — locate BottomSheet /
SegmentedControl / Chip or equivalents already used by home-finder.tsx).

Task: port Prompts 7-10's web functionality into
`mobile/app/property/[id].tsx` and `mobile/app/compare.tsx`, using the SAME
backend endpoints from Prompts 5-6 (no mobile-only backend changes):
- Intelligence hero, Property Decision Score, Price Intelligence card
- Similar Properties, Strengths & Considerations, Area Intelligence embed
- Decision Sheet (as a native bottom sheet, matching home-finder.tsx's
  existing `WhyThisPropertyModal` pattern), Personalized Fit section
- Smart Questions (with copy/share), Negotiation Insight, Ask myMakan quick
  questions via the mobile advisor handoff
- Compare screen enhancement (Decision Score / Match Score / classification
  / myMakan Recommendation)
- Sticky bottom action bar: primary Contact Agent, secondary Save / Ask AI

Use mobile's existing UI kit components (bottom sheets, cards, chips) —
do not introduce a new component library. Add i18n keys to
`mobile/src/lib/i18n/en.ts`/`ar.ts` mirroring the web keys added in Prompts
7-9 (same key names/namespace where practical, for consistency).

Verify `npx tsc --noEmit` in `mobile/` is clean. If a device/emulator or
`npx expo start` is available in this environment, manually walk through:
home-finder → property → Why this property / Smart Questions / Negotiation,
and the compare screen, for both a rent and sale property. If no
device/emulator is available, say so explicitly rather than claiming a
manual check happened. Update the tracking doc's "Screens changed" (mobile)
and add mobile-specific notes to "Investor demo steps" only if materially
different from web. Stop there.
```

---

## Prompt 12 — Tests, validation, and progress-doc finalization

```
Read only: docs/implementation/mymakan-property-intelligence.md, and
`git diff main...feature/mymakan-phase1 --stat` scoped mentally to files
touched by Prompts 1-11 (do not re-read every file in full — use the diff
stat plus the tracking doc's running notes to know what changed).

Task:
1. Run the full backend suite: `pytest -q` in `backend/`. Confirm only the
   already-known unrelated failure remains
   (`test_list_properties_date_range_filter_excludes_conflicting_booking`,
   a pre-existing test-DB drift issue, not related to this work) and that
   nothing from Prompts 1-6 regressed. If you find a genuine small gap in
   coverage called out anywhere in the brief (Arabic AI-summary output,
   insufficient-data behaviors, negotiation omission) that isn't already
   tested, add a focused test for it — do not build a large new suite.
2. Run `npx tsc --noEmit` and `npm run build` in `frontend/`; run
   `npx tsc --noEmit` in `mobile/`. All must be clean.
3. Fill in every remaining TODO section of
   `docs/implementation/mymakan-property-intelligence.md`: Feature
   completed, Existing functionality reused, APIs, Scoring methodology,
   Price-intelligence methodology, Comparable methodology, Data-confidence
   methodology, AI usage, Screens changed, Tests, Known data limitations,
   Investor demo steps. For "Investor demo steps," write out the full Rent
   walkthrough (AI Home Finder → 94% Match → Open Property → myMakan
   Intelligence → Decision Score → Fair Rent range → priorities matched →
   Strengths & Considerations → Similar Properties → Area Intelligence →
   Smart Questions → Negotiation Insight → Contact Agent) and the full Buy
   walkthrough (AI Home Finder → villa search → Open Property → Purchase
   Price Intelligence → price/sqm comparison → Comparable properties → Area
   Intelligence → Decision Score → Strengths & Considerations → indicative
   rental yield IF data supports it → Smart Questions → Negotiation Insight
   → Contact Agent), each referencing real property ids from the dev DB
   where possible so the demo is copy-pasteable.
4. Give a concise final implementation summary in your response (not a new
   file) covering: what was built, what existing functionality was reused,
   the two new API endpoints, and any known data limitations an investor
   demo should route around.

Do not start any other feature. Commit is optional — leave staged/unstaged
changes for the user to review. Stop there.
```
