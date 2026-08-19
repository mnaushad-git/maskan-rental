# myMakan Property Intelligence & AI Decision Center

Decision-support upgrade to the existing Property Detail page. Built on top of
Phase-1 (`docs/implementation/mymakan-phase1.md`) and AI Home Finder
(`docs/implementation/mymakan-ai-home-finder.md`), reusing the existing
property database, search filters, area intelligence, home-finder scoring
patterns, AI gateway, and Save/Compare/Contact journeys rather than building
parallel systems.

Progress is tracked prompt-by-prompt below. If a session runs out before
finishing its prompt, the next session should read this doc first.

**Important distinction:** the existing AI `rental_score` endpoint
(`backend/app/api/routes/ai.py:868`, `POST /ai/rental-score`, deterministic
fallback `_deterministic_rental_score` at line 848) is a separate, pre-existing
0-100 "quality/value" badge shown today on the property page. It is **not** a
fair-price *range* and is not reused or replaced by this work — the new Price
Intelligence service (Prompt 2) is a distinct, additive capability. Do not
merge or confuse the two.

## Feature completed

**myMakan Property Intelligence & AI Decision Center** — a decision-support
layer on top of the existing Property Detail page (web + mobile) and Compare
page (web + mobile), covering both Rent and Buy:

- **Property Decision Score** — a 0-100 overall score across 6 weighted
  dimensions (price value, location fit, property fit, amenities, area,
  listing confidence), each with a deterministic one-line reason; missing
  dimensions are excluded and the rest renormalize, never guessed.
- **Price Intelligence** — a fair rent range (rent) or price/sqm + estimated
  value range (buy), built from the real comparable-listing distribution,
  with a 5-bucket classification (Excellent Value → Significantly Above
  Market) and an honest "not enough data" state below 3 comparables.
- **Comparable Properties** — up to 10 real comparable listings with a
  match-similarity % and a Better/Similar/Higher price label.
- **Data Confidence** — a High/Moderate badge from real listing-completeness
  signals, with an expandable plain-language reason — never implies
  government verification.
- **Personalized Fit** — "how it fits your needs" against AI Home Finder
  criteria, shown only when the visitor actually arrived with stated
  criteria (a new sessionStorage handoff added in Prompt 9 — previously no
  context survived that navigation at all).
- **Strengths / Considerations / Things to Verify**, a **Decision Sheet**
  (web modal / mobile bottom sheet) generalizing the "why this property"
  concept to full Property Intelligence data.
- **Smart Questions** (4-9, rent/buy-specific, skips anything already on the
  listing), with copy/share and "send to agent."
- **Negotiation Insight** — a discussion range and hedged approach sentence,
  plus an AI-drafted (always user-editable, never auto-sent) message to the
  agent, grounded strictly in the deterministic negotiation facts.
- **Ask myMakan** — 7 (rent) or 9 (buy) property-aware quick questions into
  the existing AI Advisor.
- **Compare enhancement** — a myMakan Intelligence metric row group and a
  separate, deterministic myMakan Recommendation (Best Overall / Best Value
  / Best Location) alongside the pre-existing AI recommendation.
- **AI Summary** — a short grounded narration of the intelligence payload,
  bilingual (EN/AR), with a deterministic fallback.

All of the above ships on **both web and mobile**, backed by the same two
new backend endpoints (no mobile-only or web-only backend logic).

## Existing functionality reused

- **`home_finder_scoring.py`** — `personalized_fit.py` calls its
  `_budget_fit`/`_location_fit`/`_bedrooms_fit`/`_property_type_fit`/
  `_required_amenities_fit` functions directly rather than reimplementing
  criteria matching.
- **`app.core.search.filters`** (`PropertyFilterCriteria`/
  `build_property_filters`) — the base filter vocabulary for both
  `price_intelligence.py`'s and `comparable_properties.py`'s comparable
  queries, the same one search/saved-searches/property-request-matching
  already share.
- **`get_similar_properties`** (`properties.py`) — its district-first,
  price-proximity query shape is what `comparable_properties.py` extends
  rather than reinventing.
- **AI gateway + prompt registry** (`app.core.ai.gateway`/`prompts.py`) —
  `property_intelligence_ai.py` is a third consumer alongside the existing
  Rental Score and AI Home Finder narration, same call/log/fallback shape.
- **`rate_limit_dependency`** — the AI summary endpoint is rate-limited the
  same way `POST /ai/rental-score` already is.
- **Feature-flag pattern** (`app.core.feature_flags`) — `FEATURE_PROPERTY_INTELLIGENCE`
  follows the exact `FEATURE_AREA_INTELLIGENCE`/`FEATURE_AI_HOME_FINDER`
  shape (env-backed `Settings` field + `FLAGS` dict entry), gated per-request
  the same way `home_finder.py`'s `_require_enabled` already works.
- **Web `PropertyCard`, `Badge`, `ScoreRing`/`ScoreBar`, `ContactModal`** —
  reused as-is for comparable cards, classification/value/status pills, and
  score visualizations; `ContactModal`'s state was lifted to the page level
  (not duplicated) so the new hero/Smart Questions/Negotiation actions can
  all open the same modal, optionally pre-filled.
- **Web `storeAdvisorCtx` + `/advisor?propertyId&q` handoff** — reused
  verbatim for every new "Ask myMakan" entry point (hero button, Decision
  Sheet, quick-question chips).
- **Web `search.tsx`'s page-local `compareIds` pattern** — reused for Similar
  Properties' "Compare with this property," not a new compare mechanism.
- **Mobile UI kit** (`BottomSheet`, `ScoreRing`/`ScoreBar`, `Badge`,
  `Skeleton`, `PropertyCard`) — no new component library added.
- **Mobile `/lead/new`'s existing `note` prefill param** (already used by a
  project's "Contact" CTA) — reused for Smart Questions "send to agent" and
  Negotiation "send to agent," not a new messaging system.
- **`wa.me`'s native `?text=` query param** — reused for mobile's
  "Send via WhatsApp" negotiation action, no new library.

## APIs

### `GET /api/v1/properties/{id}/intelligence` (also `/api/properties/...`)

Added in `backend/app/api/routes/properties.py` (extends the existing
properties router — no new top-level router, per the brief's "avoid
unnecessary API proliferation"). Gated behind `FEATURE_PROPERTY_INTELLIGENCE`
via a per-request `_require_property_intelligence_enabled` dependency,
mirroring `home_finder.py`'s `_require_enabled` pattern (503 when the flag is
off — main.py's router registration only re-evaluates flags on process
restart, so a per-request check is what lets the flag be toggled/tested at
runtime). 404 for an unknown property id.

**Criteria-passing decision:** rather than encode the full
`HomeFinderCriteria` shape as query params, the endpoint accepts only the
handful of fields the brief's personalization actually needs: `max_price`,
`min_price`, `bedrooms`, `districts[]`, `required_amenities[]`. When none are
supplied, `personalized_fit` in the response is `None` — the service layer's
own "never fabricate personalization" rule, not a special case in the route.

**Implementation:** one `Property` fetch (`selectinload(listing_images)`),
one bounded `AreaIntelligence` lookup (same ilike-match pattern
`ai.py`'s `rental_score` already uses), then all 8 Prompt 1-4 services are
called against that single loaded row plus its already-fetched comparable
list — no per-service re-fetch, no N+1.

**Response shape** (`backend/app/schemas/property_intelligence.py`,
`PropertyIntelligenceOut`): `decision_score` (0-100 overall),
`component_scores` (per-dimension `{score, reason}`),
`omitted_score_dimensions`, `data_confidence` (`{level, reason}`),
`price_intelligence` (rent- and buy-shaped fields folded into one schema,
tagged by `type: "rent" | "buy"`), `comparable_summary` (`{count, items[]}`,
each item a light summary — id/title/image/price/match%/value label, not a
full `PropertyOut`), `strengths` / `considerations` / `things_to_verify`,
`personalized_fit` (nullable), `smart_questions`, `negotiation_intelligence`
(nullable), and `area_intelligence` (a small reference object — name/city/
score/short summary, not the full `AreaIntelligence` row).

### `POST /api/v1/properties/{id}/ai-summary`

Added in `backend/app/api/routes/properties.py`, gated behind
`FEATURE_PROPERTY_INTELLIGENCE` (same `_require_property_intelligence_enabled`
dependency as the GET endpoint) and rate-limited the same way
`POST /ai/rental-score` is (`rate_limit_dependency`, 30 requests/10min).
Body: `{"language": "en" | "ar"}`. Response: `{"summary": str, "generated_by":
"ai" | "fallback"}`.

Internally re-fetches the property and calls the same
`_assemble_property_intelligence` helper the GET endpoint uses (no
personalization criteria — this endpoint has no query params for them, so
`personalized_fit` is always `None` here today), then narrates it via
`property_intelligence_ai.summarize_property_intelligence`.

## Scoring methodology

`backend/app/services/property_decision_score.py` —
`score_property_decision(property, area_intel=None, comparable_count=0) ->
PropertyDecisionScore`, deterministic, no LLM. Mirrors
`home_finder_scoring.py`'s pattern: a central `WEIGHTS` dict (sums to 1.0),
per-dimension scoring functions, missing-dimension exclusion with weight
renormalization over the remaining dimensions, and a one-line deterministic
reason string per dimension.

Dimensions and weights:

| Dimension | Weight | Basis (Prompt 1) |
|---|---|---|
| `price_value` | 0.20 | Placeholder-simple for now — scored from `Property.commission_percent`/whether a price exists at all; Prompt 2 will wire in the real Price Intelligence classification (fair range % deviation) as the richer input via the optional `price_classification` param. |
| `location_fit` | 0.15 | Placeholder-simple for now — scored from `area_intel.area_score` when supplied; Prompt 3's comparable-density signal may enrich this later. |
| `property_fit` | 0.20 | Core spec completeness: bedrooms, bathrooms, size_sq_m, property_type, living_rooms all present. |
| `amenities` | 0.15 | Count of the same verifiable amenity columns AI Home Finder scores (has_kitchen, has_water, has_electricity, has_private_roof, has_elevator, has_airconditioners, in_villa, has_two_entrances, has_separate_electrical_meter, furnished). |
| `area` | 0.15 | `area_intel.area_score` (0-100) when an `AreaIntelligence` row exists for the property's district/city; excluded otherwise. |
| `listing_confidence` | 0.15 | Deterministic completeness signal: images present, coordinates present, mediator verified, `comparable_count` > 0 (passed in, defaults to 0 until Prompt 3 wires the real comparable-selection service). |

Any dimension whose required data is missing is excluded from the weighted
average and the remaining weights renormalize so they still sum to 1.0 —
identical approach to `home_finder_scoring.score_property`. The function
signature intentionally accepts optional richer inputs (`price_classification`,
`comparable_count`) as `None`/`0` for now so Prompts 2-3 can wire real data in
without changing the signature shape callers depend on.

Returned `PropertyDecisionScore`: `overall` (0-100 int), `dimensions: dict[str,
DimensionScore]` (`score: int, reason: str` per present dimension),
`omitted_dimensions: list[str]` (which dimensions were excluded and why, as a
short string).

## Price-intelligence methodology

`backend/app/services/price_intelligence.py` — `rent_price_intelligence(db,
property)` / `buy_price_intelligence(db, property)`, both deterministic, no
LLM. Distinct from the existing AI `rental_score` endpoint (see note above):
that endpoint returns a single 0-100 quality badge derived from a district
*average*; this service returns a fair *range* derived from the actual
comparable-listing *distribution*.

**Comparable retrieval:** reuses `PropertyFilterCriteria`/
`build_property_filters` (`app.core.search.filters`) for transaction type,
city, district, and property type, plus additional band filters layered on
top: bedrooms ±1, bathrooms ±1, size ±25%, and an exact furnishing match —
each applied only when the subject property has real data for that field.
Tier 1 scopes to the subject's district; if that returns fewer than
`MIN_COMPARABLES` (3) rows, a Tier 2 query drops the district (and the
furnishing/bathrooms constraints) and searches city-wide instead. Both tiers
are bounded to 50 rows, no N+1.

**Fair-range calculation:** an interquartile-style spread — the market
midpoint is the **median** of the comparable set (rent: `monthly_rent`; buy:
`sale_price / size_sq_m`), and the fair range is the **25th–75th percentile**
band of that same distribution (linear-interpolation percentile, no external
stats dependency). Chosen over mean ± stddev because it's robust to outlier
listings and easy to explain to a non-technical user ("the middle half of
comparable listings"). Buy's estimated value range is the price-per-sqm
range multiplied by the subject's own `size_sq_m`.

**Classification thresholds** (central constants in `price_intelligence.py`,
`percent_difference` = (asking − median) / median):

| % difference from median | Classification |
|---|---|
| ≤ −15% | Excellent Value |
| −15% to −5% | Good Value |
| −5% to +5% | Fair |
| +5% to +15% | Above Market |
| > +15% | Significantly Above Market |

**Insufficient-data path:** fewer than 3 usable comparables (or the subject
property itself is missing `monthly_rent`/`sale_price`+`size_sq_m`) returns
`sufficient_data=False` with a plain explanation string and no range/
classification — never a fabricated number.

**Factors used:** `factors_used` lists only the subject fields that actually
had data and therefore genuinely constrained the comparable query — district,
type, bedrooms, bathrooms, size, furnishing — in that order, skipping any the
listing doesn't have.

## Comparable methodology

`backend/app/services/comparable_properties.py` —
`find_comparable_properties(db, property, limit=10) ->
list[ComparableProperty]`, deterministic, no LLM. Extends
`get_similar_properties`'s query shape (`app/api/routes/properties.py:245`):
same city + Published + district-first-then-price-proximity ordering, plus a
`transaction_type` (listing_type) match, eager-loaded `listing_images` via
`selectinload` (no N+1 when callers render comparable cards — covered by
`test_no_n_plus_1_when_touching_listing_images`), and a hard cap of
`MAX_COMPARABLES = 10` regardless of the `limit` argument passed in.

Each `ComparableProperty` includes:
- `price_difference`: comparable's price minus the subject's (same field the
  subject's `transaction_type` implies — `monthly_rent` for rent,
  `sale_price` for sale); `None` if either price is missing.
- `price_per_sqm`: buy only, when both `sale_price` and `size_sq_m` are on
  the comparable.
- `match_similarity_percent`: matched-criteria / considered-criteria × 100
  across district, property type, bedrooms (exact), size (±20%), and price
  (±20%) — a criterion is only "considered" when the *subject* has real data
  for it, so an incomplete subject listing never inflates or deflates the
  score artificially.
- `value_label`: `Better Value` / `Similar Price` / `Higher Price` from the
  same ±5% deviation threshold as `price_intelligence.py`'s classification
  logic, computed only when both prices are known — `None` otherwise (never
  a fabricated label).

## Data-confidence methodology

`backend/app/services/data_confidence.py` —
`compute_data_confidence(property, area_intel, comparable_count) ->
DataConfidence`, deterministic, no LLM. Six binary signals: core specs
complete (bedrooms/bathrooms/size/type all present), listing photos present,
map coordinates present, mediator account verified, `comparable_count >= 3`
(from the Comparable Properties service above), and an `AreaIntelligence` row
existing for the district. `level = "High"` when at least 5 of 6 signals are
present, else `"Moderate"`. The reason string lists which signals are present
(High) or missing (Moderate) in plain language — e.g. "mediator-verified",
never "government-verified" or "officially verified"; the platform has no
government-verification pipeline and must never imply one
(`test_reason_string_never_implies_government_verification`).

## AI usage

`backend/app/services/property_intelligence_ai.py` —
`summarize_property_intelligence(intelligence, language, user_id=None) ->
(summary, generated_by)`. Mirrors `home_finder_ai.explain_match`'s pattern
exactly: a grounded narration over already-computed deterministic data
(never a fresh calculation), same gateway (`app.core.ai.gateway.run_chat`)
and prompt registry (`PROPERTY_INTELLIGENCE_SUMMARY` in `prompts.py`), same
`log_ai_call` accounting (`feature="property_intelligence_summary"`).

The compact facts block passed to the model is built strictly from the
already-assembled `PropertyIntelligenceOut` payload: decision score, price
classification, top 3 strengths, top 3 considerations, and the
personalized-fit summary line if present. The prompt instructs the model to
explain these facts only — never invent a number, never assign its own
score, never calculate a valuation, 2-4 sentences, plain text, in the
requested language.

**Fallback:** a deterministic bilingual template (English/Arabic) is used
when `ANTHROPIC_API_KEY` is unset or the call raises — Property Intelligence
never depends on the AI call succeeding.

**Known limitation:** unlike `home_finder_ai.py`'s structured-JSON
sanitizers (which constrain fields to a fixed vocabulary before they reach
the scoring engine), this endpoint's output is free-form narration with no
structured field to validate against — the AI reply is trusted as-is once
returned, the same trust level `home_finder_ai.explain_match`'s narration
already operates at elsewhere in this codebase. A real numeric-hallucination
guard would be new infrastructure beyond this prompt's scope; documented and
covered by `test_known_limitation_ai_reply_trusted_as_is` in
`test_property_intelligence_ai.py` rather than silently left unverified.

## Screens changed

### Web — `frontend/src/routes/property.$id.tsx` (Prompt 7, partial)

Added right after the existing `Summary` section (before the pre-existing
`RentalIntelligence`/`FairRent`/`PurchasePriceInsight` sections, which are
untouched — Prompt 10 reconciles final section order):

- **`IntelligenceHero`** — "myMakan Intelligence" badge, `ScoreRing` for the
  Decision Score, personalized match % badge (only when `personalized_fit`
  is present), price classification badge, asking price + fair range (both
  expressed in the same unit `price_intelligence.py` actually computed on —
  monthly for rent, total for sale — explicitly labelled `/mo` for rent so
  it's never confused with the page's usual annual-rent convention used
  elsewhere on this page), personalized-fit summary line, and four action
  buttons: **Compare** (existing `/compare` link) and **Ask myMakan**
  (existing `storeAdvisorCtx` + `/advisor` handoff) are fully wired;
  **Contact Agent** opens the existing `ContactModal` via state lifted from
  `ActionsCard` up to the parent `PropertyDetail` component (so both the
  hero and the sidebar action card share one saved-record/contact-modal
  state instead of duplicating the save-then-contact flow); **Why this
  property?** is a placeholder (TODO comment in code) — Prompt 9 wires it to
  the full Decision Sheet.
- **`DecisionScoreCard`** — overall `ScoreRing` + per-dimension `ScoreBar`s
  for whichever of the 6 dimensions are present, with an omitted-dimensions
  note when some were excluded for missing data.
- **`PriceIntelligenceCard`** — Rent variant (fair range, market midpoint,
  classification, factors used, all monthly) or Buy variant (price/sqm,
  comparable median price/sqm, estimated value range, classification,
  required disclaimer copy), and the "Limited market data" fallback state
  when `sufficient_data` is `false` — verified live against a real
  insufficient-data sale listing (SAR 30M tower, too few comparables).

Intelligence is fetched in its own `useEffect`/loading state *after* the
core property fetch resolves (`fetchPropertyIntelligence` in `maskan.ts`),
so a slow or failing call never blocks the rest of the page — on error the
hero/cards render nothing rather than an error state.

**Manually verified** live against the real dev backend + Postgres (not just
build-clean): a rent property (id 63, "5-Bed Villa — Al Khalidiyya,
Madinah") and a sale property (id 141, "Tower for Sale — Al Yasmin", which
exercises the insufficient-data path), both in English and Arabic/RTL, via a
headless-Chromium script (no `chromium-cli` available in this environment,
so a small Playwright script was used instead — see the note below). No
console errors beyond one pre-existing, unrelated 404
(`/areas/Al%20Khalidiyya/intelligence` — no `AreaIntelligence` seed row for
that district, already handled gracefully by the existing `.catch(() =>
null)`).

**Dev-environment note:** verification found a stale `uvicorn --reload`
backend process already bound to port 8000 (pre-dating this session) that
was not serving the new route despite `--reload` — Windows allowed a second
process to *appear* to bind the same port without erroring, so the fix was
to stop the stale process and re-verify on a fresh instance. If `/properties/
{id}/intelligence` ever 404s unexpectedly in local dev, restart the backend
process rather than trusting `--reload`.

### Web — Prompt 8 (Similar Properties, At a Glance, Area Intelligence embed)

Added after `PriceIntelligenceCard`:

- **`AtAGlanceCard`** — Strengths / Considerations two-column (stacked on
  mobile) from `intelligence.strengths`/`considerations`, a "Things to
  verify" list when present, and a Data Confidence badge (High/Moderate)
  with an expandable "Why?" showing `data_confidence.reason` verbatim.
  Rendered eagerly — no extra fetch, all data already in the Prompt 7
  `intelligence` payload.
- **`SimilarPropertiesSection`** — distinct from the pre-existing
  `ComparableListings` further down the page (which still uses the older
  client-side rental-score heuristic via `/properties/{id}/similar`, kept
  as-is per Prompt 8's scope): this one is powered by Prompt 3's
  deterministic comparable-selection service through
  `intelligence.comparable_summary`. Reuses the existing `PropertyCard`
  component — since `comparable_summary` items are intentionally light
  (Prompt 5's "not a full `PropertyOut`" decision), each comparable's full
  `Property` is fetched via the existing `fetchProperty`/`mapApiProperty`
  (the exact pair `ComparableListings` already uses), bounded to the ≤10
  items the backend returns. A Better Value/Similar Price/Higher Price
  `Badge` and a "Compare with this property" action are rendered below each
  card (not injected into `PropertyCard` itself, to avoid fighting its
  internal layout). Compare selection reuses the same page-local
  `compareIds` array pattern `search.tsx` already uses (not shared with
  `/compare`, which loads its own default set — same known limitation
  already documented for AI Home Finder's compare button, not a new one).
- **`AreaIntelligenceEmbed`** — "Living in {district}" with lifestyle/
  school/healthcare scores, a rent-trend direction arrow, and a "typical
  range" figure reused directly from `intelligence.price_intelligence`'s
  fair range/estimated value range (ties the two data sources together
  instead of inventing a second summary), plus the existing area overview
  text and an "Explore {district}" link into `/areas?area=...`. Reuses the
  *full* `ApiAreaIntelligence` the page's own `loadAll` effect already
  fetches — no second area-intelligence call.

**Lazy rendering:** Similar Properties and the Area Intelligence embed are
both gated behind an expand/collapse toggle — this file's existing
`readMore`/`readLess` `useState` pattern (`DescriptionSection`), the only
lazy/expand pattern already present anywhere in this codebase (no
`IntersectionObserver`/`useInView` usage exists elsewhere to reuse instead).
Similar Properties additionally defers its per-comparable `fetchProperty`
calls until the section is actually expanded.

**Manually verified** live (same rent id 63 / sale id 141 fixtures as
Prompt 7) in English and Arabic/RTL: At a Glance, Similar Properties (10
cards with value-label badges and working compare toggling), and the Area
Intelligence embed (only appears when an `AreaIntelligence` row exists for
the district — correctly absent for Al Khalidiyya/Madinah, which has none
seeded, same pre-existing gap noted in Prompt 7). No new console errors.

### Backend — Prompt 9 addition (negotiation-message AI variant)

Prompt 9's negotiation "Draft Message" action reuses the Prompt 6
`POST /properties/{id}/ai-summary` endpoint rather than a new one, via an
optional `variant: "summary" | "negotiation_message"` request field (default
`"summary"`, fully backward compatible). `property_intelligence_ai.py` now
has two prompt templates (`PROPERTY_INTELLIGENCE_SUMMARY`,
`PROPERTY_NEGOTIATION_MESSAGE`) sharing one `summarize_property_intelligence`
entry point, one gateway/fallback/logging code path. The negotiation variant
is grounded *only* in `negotiation_intelligence` facts (asking price, market
midpoint, discussion range, approach) — general strengths/considerations
never leak into a negotiation-message prompt. Requesting
`variant="negotiation_message"` when `negotiation_intelligence` is `None`
returns 422 rather than fabricating a message. New tests in
`test_property_intelligence_ai.py`: grounding, fallback with/without an API
key, and the 422 case. Full backend suite after this change: **282 passed,
23 skipped, 0 failed.**

### Web — Prompt 9 (Decision Sheet, Personalized Fit, Smart Questions, Negotiation, Ask myMakan)

- **`DecisionSheet`** — a new, separate modal component (NOT extracted from
  home-finder.tsx's `WhyThisPropertyModal`, which stays untouched: it's
  driven by AI Home Finder's own match-result type, a different data shape
  than `ApiPropertyIntelligence`, and generalizing both into one shared
  component would mean forcing an abstraction between two genuinely
  different data sources — the "your call" documented here per Prompt 9's
  own allowance). Three sections — Why it works / Trade-offs / Things to
  verify — sourced directly from `strengths`/`considerations`/
  `things_to_verify`. Wired to the hero's "Why this property?" button (a
  placeholder since Prompt 7).
- **"How it fits your needs" (`PersonalizedFitSection`)** — renders only
  when `intelligence.personalized_fit` is present. Before this prompt, *no*
  context survived navigation from AI Home Finder results to a property page
  at all (`PropertyCard`'s plain `Link`, no query param, no sessionStorage).
  Minimal extension added: `home-finder.tsx`'s `MatchCard` now writes the
  active search criteria to `sessionStorage` (`maskan_home_finder_criteria`)
  in an `onClick` right before navigation — same idiom as the existing
  `maskan_advisor_ctx` handoff, not a new mechanism. `property.$id.tsx`
  reads and immediately clears that key (`consumeHomeFinderCriteria`) and
  passes it as `PropertyIntelligenceCriteria` to `fetchPropertyIntelligence`.
  No criteria stored → `personalized_fit` stays `None` → section doesn't
  render — never fabricated.
- **`SmartQuestionsSection`** — numbered list from `intelligence.
  smart_questions`, "Copy questions" (Clipboard API) and "Send to agent"
  (prefills the existing `ContactModal`'s message field via prefill state
  lifted to `PropertyDetail` — no new messaging system).
- **`NegotiationInsightCard`** — omitted entirely when
  `negotiation_intelligence` is `null`. Shows asking price / market midpoint
  / discussion range / approach, plus "Draft message" → calls
  `/ai-summary` with `variant: "negotiation_message"` → AI-drafted text
  appears in an editable `<textarea>` (verified live: real Anthropic call
  correctly grounded in the actual asking price) → "Use in Contact Agent"
  sends the (user-editable) draft into the same lifted `ContactModal` prefill
  state as Smart Questions — never auto-sent.
- **`AskMyMakanQuickQuestions`** — the ~7 base quick questions from the
  brief (fair pricing, compromises, compare, what to ask the agent, family
  suitability, negotiate help, area info) plus 2 more for Buy (price/sqm,
  rental income), each a chip linking to `/advisor?propertyId&q=...` via the
  existing `storeAdvisorCtx` sessionStorage handoff — not a new chat surface.

**Manually verified live**, full flow: simulated the AI Home Finder →
property handoff (writing the same sessionStorage key `MatchCard` now
writes) and confirmed on the rent fixture (id 63): Personalized Fit renders
and the sessionStorage key is cleared after read; Decision Sheet opens with
real strengths/trade-offs/things-to-verify; Smart Questions' copy button
works; Negotiation Insight's "Draft message" produced a real AI-grounded
draft ("...the asking price of SAR 16,000 sits above the current market
range...") that flowed correctly into the Contact Agent modal via "Use in
Contact Agent"; Ask myMakan quick-question chips render. Repeated in
Arabic/RTL — all sections present, no new console errors (same pre-existing
404 noted in Prompts 7-8). `npx tsc --noEmit` and `npx vite build` both
clean.

### Web — Prompt 10 (Compare enhancement, layout/performance pass, sticky actions)

- **`compare.tsx` — `PropertyIntelligenceCategory`**: a new "myMakan Intelligence"
  `CategoryTable` row group (Decision Score, Match Score, price
  classification, area score, data confidence, strengths/considerations
  counts) fed by `fetchPropertyIntelligence` per compared property — bounded
  to the page's existing ≤3 selection cap, fetched once per id and cached in
  `intelMap` (same pattern as the pre-existing `areaIntelMap` fetch, not
  N+1 per render).
- **`MyMakanRecommendationCard`**: a new, separate "myMakan Recommendation"
  section — distinct from the pre-existing `AiRecommendationCard` (which
  already picks a single overall "winner" from a client-side composite of
  area/family/rental/match scores; left untouched). This one picks three
  independent category winners — Best Overall / Best Value / Best Location —
  via a small pure function (`pickIntelligenceRecommendations`, mirrors
  `home_finder_scoring.py`'s `pick_categories` style: best-of-a-real-metric,
  `null` when no candidate has data for that metric). Lives in the frontend
  since every input is already-fetched Property Intelligence data and the
  comparison is simple arithmetic — no new backend endpoint. The "why" line
  per winner is a deterministic template (e.g. "Highest myMakan Decision
  Score (69/100)"), **not** an AI call — AI never picks the winner, per the
  brief. Verified live: with 3 auto-selected short-stay listings that had no
  price-intelligence data, Best Value was correctly omitted entirely (never
  fabricated) while Best Overall/Best Location rendered from real scores.
- **Section order** (`property.$id.tsx`): confirmed already matching the
  brief's target order after Prompts 7-9 — Images → Price/Core Details →
  hero → Personalized Fit → (Decision Score) → Price Intelligence →
  Strengths & Considerations (At a Glance) → Comparable Properties (Similar
  Properties) → Area Intelligence → Smart Questions → Negotiation Insight →
  Ask myMakan → Agent/Contact. No reordering needed. Similar Properties and
  the Area Intelligence embed are still collapsed-by-default (confirmed from
  Prompt 8, not redone).
- **Mobile sticky action bar**: the pre-existing mobile-only bottom bar
  (`lg:hidden`) was updated from its old WhatsApp/Call-direct layout to the
  brief's spec — primary **Contact Agent** (opens the same lifted
  `ContactModal` state as everywhere else on the page), secondary **Save**
  and **Ask AI** (icon buttons). `handleToggleSave` was lifted from
  `ActionsCard` up to `PropertyDetail` (as a `const` function expression, not
  a hoisted `function` declaration, so TypeScript keeps `property` narrowed
  non-null) so the sticky bar and the sidebar `ActionsCard` share the exact
  same save/unsave logic instead of duplicating it.

**Manually verified live**: `/compare` with 3 real properties (auto-selected
by the page) — myMakan Intelligence category, myMakan Recommendation (Best
Overall/Best Location shown, Best Value correctly absent for these
listings), and all pre-existing categories render correctly, no console
errors beyond an unrelated Google Fonts CDN 404 (no network access in this
dev sandbox, pre-existing). `/property/63` at a 390×844 mobile viewport
confirmed the new sticky bar (Contact landlord / heart / sparkles). `npx tsc
--noEmit` and `npx vite build` both clean.

### Mobile — Prompt 11 (full port)

Ported the same backend endpoints (Prompts 5-6, no mobile-only backend
changes) into `mobile/app/property/[id].tsx` (589 → ~1,270 lines) and
`mobile/app/compare.tsx`, using this app's existing UI kit throughout —
`BottomSheet` for the Decision Sheet, `ScoreRing`/`ScoreBar` for scores,
`Badge` for classification/status pills, `Skeleton` for loading states — no
new component library introduced.

- **`IntelligenceHero`, `DecisionScoreCard`, `PriceIntelligenceCard`,
  `PersonalizedFitSection`, `AtAGlanceCard`, `SimilarPropertiesSection`** —
  direct ports of the web components from Prompts 7-8, adapted to RN
  primitives (`View`/`Text`/`Pressable` instead of `div`/`button`).
  `SimilarPropertiesSection` is expand-gated (mirrors the web app's
  collapse-by-default pattern, adapted since mobile has no existing
  accordion-for-fetch-deferral precedent to reuse beyond the `Accordion`
  component itself, which this uses conceptually via its own expand toggle).
- **`DecisionSheet`** — a `BottomSheet`, mirroring `mobile/app/home-finder.tsx`'s
  existing `WhyThisPropertyModal` pattern exactly (same "AI Home Finder
  result is a different data shape than Property Intelligence" reasoning as
  the web app's Prompt 9 — kept separate, not shared).
- **`SmartQuestionsSection`** — "Share questions" uses React Native's
  `Share.share()` (already used elsewhere in this exact file for the
  gallery's share button) instead of a clipboard API, since no
  clipboard package is a dependency of this app yet and adding one for a
  single button felt like unnecessary scope; "Send to agent" prefills
  `/lead/new`'s existing `note` param (the same prefill mechanism a
  project's "Contact" CTA already uses — see `app/lead/new.tsx`), not a new
  messaging system.
- **`NegotiationInsightCard`** — "Draft message" calls the same
  `/ai-summary?variant=negotiation_message` endpoint as web; the drafted
  text is shown in an editable `TextInput` with two sends: WhatsApp (via
  `wa.me`'s native `?text=` query param — no backend/library changes) when
  the listing has a WhatsApp number, and `/lead/new`'s `note` prefill
  otherwise — never auto-sent.
- **`AskMyMakanQuickQuestions`** — same ~7+2 questions as web, each a chip
  linking to `/advisor?q=...`. **New minimal addition**: `mobile/app/advisor.tsx`
  had no property-context deep-link at all before this prompt (no `q` param
  support, unlike the web app's `/advisor?propertyId&q`) — added a small
  `useLocalSearchParams<{ q }>()` + one-time auto-send `useEffect`. No
  separate property-context param was needed: the question text itself
  already carries any needed context (e.g. "Tell me about the Al Yasmin
  area."), same as how the web quick-questions' text is self-contained.
- **Mobile sticky action bar**: extended (not replaced) — the existing
  WhatsApp/Call row already serves as "Contact Agent" (arguably better UX on
  mobile than a form modal, which doesn't exist on this platform at all);
  added a Save heart icon and an Ask AI sparkles icon so all three of the
  brief's actions are present.
- **`compare.tsx`**: a new "myMakan Intelligence" metric-row group
  (Decision Score, Match Score, price classification, data confidence) fed
  by `fetchPropertyIntelligence` per selected property (bounded to the
  existing ≤3 cap, cached in `intelMap`), and a separate `MyMakanRecommendation`
  section (Best Overall/Value/Location via the same pure, deterministic
  `pickIntelligenceRecommendations` logic as the web app — necessarily
  duplicated per-platform since mobile and web don't share a code package,
  same as every other cross-platform helper in this codebase).

**Not changed**: `PropertyAreaInsights` (mobile already had a condensed
area-intelligence embed — schools/hospitals/mosques/malls/parks counts +
scores — pre-dating this prompt; left as-is rather than force-fitting the
web app's Prompt 8 "typical range" addition into an already-working,
differently-scoped component).

**Verification**: `npx tsc --noEmit` in `mobile/` is clean for both edited
files. No Android/iOS emulator or physical device is available in this
environment (`adb`/`xcrun` not installed) — per this prompt's own fallback
instruction, stating this explicitly rather than claiming a manual
walkthrough happened. The `expo start`/on-device walkthrough (home-finder →
property → Why this property / Smart Questions / Negotiation, and the
compare screen, for both a rent and sale property) has **not** been run.

## Personalization / narrative modules (Prompt 4)

All four deterministic, no LLM, added under `backend/app/services/`:

- **`personalized_fit.py`** — `personalized_fit(property, criteria:
  HomeFinderCriteria | None, area_intel=None) -> PersonalizedFit | None`.
  Directly calls `home_finder_scoring`'s existing per-dimension functions
  (`_budget_fit`, `_location_fit`, `_bedrooms_fit`, `_property_type_fit`,
  `_required_amenities_fit`) rather than reimplementing criteria matching —
  only adds match/moderate/miss row labeling on top. Returns `None` when no
  criteria are supplied or the supplied criteria set no scorable field
  (never fabricates personalization for an anonymous/context-free visit).
- **`property_highlights.py`** — `property_highlights(property,
  price_intelligence=None, comparables=None, area_intel=None) ->
  PropertyHighlights` (strengths / considerations / things_to_verify).
  Every line traces to a real signal: Price Intelligence classification,
  comparable value labels, `AreaIntelligence.area_score`, mediator
  verification, photo count, property age, and — for "things to verify"
  specifically — only genuinely-missing fields (no furnishing data, no
  coordinates, no area intelligence row, no deed area on a sale listing).
- **`smart_questions.py`** — `generate_smart_questions(property) ->
  list[str]`, two fixed 7-item question banks (rent / buy). A question is
  skipped only when the listing already has that field on record (furnished,
  `insurance_amount` as a deposit proxy, `property_age_years`, `deed_area`) —
  always yields 4-7 questions.
- **`negotiation_intelligence.py`** — `negotiation_insight(property,
  price_intelligence) -> NegotiationInsight | None`. Only computed when
  `price_intelligence.sufficient_data` is `True`; returns asking price,
  market midpoint, a discussion range, and a hedged approach sentence
  ("consider", "may be worth") that never claims a guaranteed outcome.

## Tests

- `backend/tests/test_property_decision_score.py` (Prompt 1): full-data case,
  missing-amenities case (renormalization), missing-area-intel case, weights
  sum to 1.0 pre-renormalization.
- `backend/tests/test_price_intelligence.py` (Prompt 2): rent classification
  across all 5 buckets, buy price/sqm + range calc, insufficient-data
  fallback (rent + buy + missing size), factors-used only lists real fields.
- `backend/tests/test_comparable_properties.py` /
  `test_data_confidence.py` (Prompt 3): district-first ordering, value
  labels, match-similarity calc, bounded to `MAX_COMPARABLES`, no N+1 on
  `listing_images`; High vs. Moderate confidence, reason string never implies
  government verification.
- `backend/tests/test_personalized_fit.py`,
  `test_property_highlights.py`, `test_smart_questions.py`,
  `test_negotiation_intelligence.py` (Prompt 4): no-criteria/no-data-omitted
  cases, full-match vs. partial-match, question skipping, negotiation
  omitted below the comparable threshold.

- `backend/tests/test_property_intelligence_api.py` (Prompt 5): full 200
  response shape for a rent and a sale fixture, `personalized_fit`
  null-without/populated-with criteria query params, feature-flag-off 503,
  unknown property 404, minimal-data property still 200 with omissions.

- `backend/tests/test_property_intelligence_ai.py` (Prompt 6): grounding
  (facts passed to the mocked model match the intelligence payload),
  fallback on no API key / AI failure, Arabic requested and returned, and
  the known AI-trust limitation documented above.

- `backend/tests/test_property_intelligence_ai.py` (Prompt 9 addition):
  negotiation-message variant grounding (facts limited to negotiation data
  only), fallback with/without an API key, and the case where
  `negotiation_intelligence` is absent (falls back to the general summary
  rather than fabricating a message).
- `backend/tests/test_property_intelligence_api.py` (Prompt 12 addition —
  closing a gap: the `/ai-summary` route itself had no HTTP-level test
  before this, only the underlying service function): 200 for the default
  `summary` variant, 200 for `negotiation_message` with enough comparables,
  **422** for `negotiation_message` when there isn't (never fabricates a
  negotiation message), 404 for an unknown property, feature-flag-off 503.

**Final full backend suite** (`pytest -q`, end of Prompt 12): **287 passed,
23 skipped, 0 failed** — nothing regressed across all 12 prompts. The
previously-known flaky test
(`test_list_properties_date_range_filter_excludes_conflicting_booking`)
passed on every run this session, including the final one.

**Frontend**: `npx tsc --noEmit` and `npm run build` in `frontend/` both
clean (final check, after Prompt 10). **Mobile**: `npx tsc --noEmit` in
`mobile/` clean (final check, after Prompt 11).

## Known data limitations

- **Sparse `AreaIntelligence` coverage.** Only a subset of districts in the
  dev DB have a seeded `AreaIntelligence` row (e.g. Al Yasmin/Riyadh does;
  Al Khalidiyya/Madinah does not). For a property in an uncovered district,
  `location_fit`/`area` Decision Score dimensions are omitted, the Area
  Intelligence embed doesn't render, and Data Confidence drops to Moderate —
  all correct, deterministic behavior, but it means a demo should
  deliberately pick a covered district (see below) rather than a random
  property id.
- **Comparable data is genuinely thin for expensive/rare listings.** High
  end or unusual-type listings (e.g. property 141, a SAR 30M tower) often
  have fewer than 3 real comparables in the dev seed data, so Price
  Intelligence correctly shows "Limited market data" instead of a fabricated
  range. This is by design (never invent a number below the 3-comparable
  floor), but it means not every property makes for a "full range" demo —
  pick a mid-market property in a well-covered district for that.
- **No rental-yield / appreciation calculation exists anywhere in this
  build.** Same principle as AI Home Finder's `best_investment` (always
  `null`) — the platform has no historical transaction or rental-yield data
  to ground such a number in, so Property Intelligence doesn't compute one
  either. The brief's own Buy walkthrough template mentions "indicative
  rental yield IF data supports it" — it currently never does, so that step
  is skipped below rather than shown with a fabricated figure.
- **AI-summary/negotiation-message output is trusted as-is** (documented in
  "AI usage" above) — no numeric-hallucination validator exists; the model
  is instructed not to invent numbers and is grounded in a facts-only
  prompt, but nothing programmatically strips a number the model might add
  anyway. Low risk in practice (verified live outputs stayed grounded in
  every manual check this session) but worth knowing before a live demo
  with an unfamiliar property.
- **Web and mobile `myMakan Recommendation` logic is duplicated**, not
  shared — mobile and web don't share a code package anywhere in this
  codebase, so `pickIntelligenceRecommendations` exists once per platform
  (same as every other cross-platform helper here). Keep both in sync if the
  category-picking logic ever changes.
- **Mobile has not been run on a device/emulator this session** — verified
  by `npx tsc --noEmit` only (no Android/iOS tooling available in this
  environment). Recommend a real on-device pass before an investor demo
  that includes the mobile app.

## Investor demo steps

Both walkthroughs use real dev-DB property ids in a district with full
`AreaIntelligence` coverage (Al Yasmin, Riyadh) so every section actually
renders — pick a different district id and some sections (Area Intelligence
embed, `location_fit`/`area` score dimensions) will correctly go quiet
instead of showing fabricated data.

### Rent walkthrough

1. **AI Home Finder** (`/home-finder`) — enter "3 bedroom apartment in Al
   Yasmin, Riyadh under 100,000 SAR/year" (or similar) → Rent toggle →
   **Find My Best Matches**.
2. Note the match % badge on the result for **property id 2** ("3-Bed Family
   Apartment — Al Yasmin, Floor 4," SAR 8,200/mo) — **Open Property**.
3. **myMakan Intelligence** hero: Decision Score ring, match % badge (now
   populated — the AI Home Finder → property handoff carries the criteria
   through), price classification badge, fair range.
4. **Property Decision Score** card — per-dimension bars.
5. **Fair Rent Intelligence** card — fair range, market midpoint,
   classification, factors compared on.
6. **How it fits your needs** — priorities matched, per-criterion match/
   partial/miss rows.
7. **At a Glance** — Strengths & Considerations, Data Confidence badge +
   "Why?".
8. **Similar Properties** — tap "Show similar properties," note the Better/
   Similar/Higher Price badges and "Compare with this property."
9. **Living in Al Yasmin** — tap "Show area intelligence": lifestyle/school/
   healthcare scores, rent trend, typical range, overview, "Explore Al
   Yasmin" link into `/areas`.
10. **Smart Questions to Ask** — copy or send to agent.
11. **Negotiation Insight** — discussion range + approach → **Draft
    message** → review the AI-drafted text → **Use in Contact Agent** (or,
    on mobile, **Send via WhatsApp**).
12. **Contact Agent** from the hero (or the sticky mobile bar) to close the
    loop.

### Buy walkthrough

1. **AI Home Finder** — "Buy" toggle, e.g. "Tower or building for sale in Al
   Yasmin, Riyadh" → **Find My Best Matches** → **Open Property** on
   **property id 141** ("Tower for Sale — Al Yasmin," SAR 30,000,000).
2. **myMakan Intelligence** hero + **Property Decision Score** — same as
   Rent, price-based dimensions may be weighted differently since this
   listing has thin comparable data (see below).
3. **Purchase Price Intelligence** card — this specific listing shows
   **"Limited market data"** rather than a fabricated range (fewer than 3
   real comparable sale listings in this district/type in the dev seed
   data) — a deliberate, honest demo point: point this out explicitly as
   proof the system never invents a number. For a full-range Buy demo
   instead, use a mid-market apartment/villa sale listing with more
   comparables in the same city.
4. **Comparable Properties** (Similar Properties section) — still populated
   (comparable *selection* only needs city/type overlap, not enough data for
   a price *range*) — price/sqm shown per comparable where available.
5. **Living in Al Yasmin** — same area intelligence embed as Rent.
6. **At a Glance** — Strengths & Considerations (verified mediator, area
   score, etc.), Data Confidence.
7. Indicative rental yield — **skipped**: no rental-yield calculation exists
   in this build (see "Known data limitations" above); do not present a
   number for this step.
8. **Smart Questions to Ask** (buy-specific bank — service charges,
   occupancy, renovations, what's included, deed area) → **Negotiation
   Insight** → **Draft message** → **Contact Agent**.
