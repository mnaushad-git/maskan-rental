# myMakan Property Verification & Trust Center

Companion doc to `docs/implementation/mymakan-trust-center-prompts.md`. Created by
Prompt 1 (Trust Model core service). Each later prompt should read this doc first,
append its own section(s), and leave everything else untouched unless it discovers
existing content is wrong.

No root `CLAUDE.md` exists in this repo (only `mobile/CLAUDE.md`, which is Expo
module boilerplate, not project docs) — Prompt 1 read `docs/implementation/
mymakan-phase1.md` and `docs/implementation/mymakan-property-intelligence.md`
instead, per this prompt's own fallback instruction.

## Global constraints (apply to every prompt — copied from the plan doc)

- Feature-first investor demo mode. Phase 1 (Rent + Buy) only. Do not start another feature.
- No Nafath/Ejar/REGA/payment verification/blockchain/new Redis/new queues/new microservices.
- Trust/completeness/consistency scores are 100% deterministic — never LLM-calculated.
- Verification wording: only `"✓ Verified by myMakan"` is allowed today. Never say
  "Government Verified", "REGA Verified", "Ejar Verified", "Nafath Verified". Keep the
  data model extensible for future external verification (a separate status per
  provider), but don't build the integrations.
- AI (via `core/ai/gateway.py`) may only explain/summarize/improve wording from facts
  it's given — never invent amenities, dimensions, location, verification,
  availability, price, complaints, or fraud claims.
- Reuse existing services (`data_confidence.py`, `price_intelligence.py`, etc.) rather
  than recalculating.
- Property Detail must render trust instantly from already-loaded data; AI explanation
  loads async, never blocks.

**Naming collision warning** (relevant starting Prompt 10): mobile already has
`mobile/src/components/TrustBadge.tsx` (`computeTrustScore`/`ApiTrustMetrics`) — the
renter's own identity-verification trust score (mock-Nafath flow), a completely
different concept from this feature's listing/mediator trust. Not touched by Prompt 1
(backend-only).

## Prompt 1 — Trust Model core service (deterministic)

**Scope actually touched:** `backend/app/core/trust_config.py` (new),
`backend/app/services/listing_completeness.py`,
`backend/app/services/listing_consistency.py`,
`backend/app/services/mediator_trust.py`,
`backend/app/services/listing_freshness.py`,
`backend/app/services/marketplace_confidence.py`,
`backend/app/services/trust_assessment.py` (all new), 6 new test files under
`backend/tests/`. No API routes, no DB migrations, no frontend/mobile changes — all
correctly out of scope per the prompt.

### Why these five components

The prompt's spec references ("spec section 7", "spec section 10", "spec section 16",
etc.) point at a fuller feature spec that isn't present in this repo — only the
12-prompt plan doc (`mymakan-trust-center-prompts.md`) is. Per that prompt's own
fallback instruction, the component design below was grounded in the field names/
structures actually present in `property.py`, `mediator.py`, `review.py`, and the
existing Property Intelligence services (`property_decision_score.py`,
`data_confidence.py`, `comparable_properties.py`, `price_intelligence.py`), rather
than a spec text that doesn't exist in this session. Judgment calls are documented
inline below so a later prompt (or a human) can revisit them.

## Trust Methodology

`backend/app/services/trust_assessment.py` — `assess_property_trust(prop, *,
review_count=0, avg_rating=None, mediator_listing_count=0, data_confidence=None,
now=None) -> TrustAssessment`. Deterministic, no LLM anywhere in this module or any
component it composes. Mirrors the exact pattern
`app.services.property_decision_score.score_property_decision` and
`app.services.home_finder_scoring` already established in this codebase: a central
weights dict that sums to 1.0, one calculator per component, and missing-data
components excluded with the remaining weights renormalized — never a guessed or
fabricated value standing in for missing data.

**This module never queries the database itself.** It takes a `Property` row (which
already carries its `mediator` via the existing `lazy="joined"` relationship) plus a
handful of already-computed inputs the caller (a future API route) is expected to
fetch once per request — a review aggregate (`review_count`/`avg_rating`, the same
shape `reviews.py`'s existing `GET /mediator/{id}/summary` already returns), a
mediator listing count, and a `DataConfidence` result (from the existing
`data_confidence.py`, itself built on `comparable_properties.py`). This satisfies the
global "reuse existing services, don't recalculate" constraint literally: Marketplace
Confidence does not reimplement any signal `data_confidence.py` already computes, it
only rescales that result's `signals_present/signals_total` ratio onto the Trust
Model's 0-100 scale.

### Component weights (`backend/app/core/trust_config.py`, `TRUST_COMPONENT_WEIGHTS`)

| Component | Weight | Always computable? |
|---|---|---|
| Listing Completeness | 0.25 | Yes — every `Property` row has enough data (even if mostly empty) to score |
| Listing Consistency | 0.20 | Yes — a listing with zero issues simply scores 100 |
| Mediator Trust | 0.20 | No — omitted when `Property.mediator` is `None` |
| Listing Freshness | 0.15 | Yes — `created_at` is a NOT NULL column, always a reference point |
| Marketplace Confidence | 0.20 | No — omitted when the caller doesn't supply a `DataConfidence` |

When a component is omitted, its weight is dropped from both the numerator and
denominator of the weighted average (`weighted_sum / weight_total`, only over present
components) — the identical renormalization approach `property_decision_score.py`
uses, just applied across 5 components instead of 6 dimensions. All weight/threshold
constants live in `trust_config.py` only — no calculator hardcodes a number that
should be tunable.

### Trust level (`TRUST_LEVEL_THRESHOLDS`)

| Overall score | Level |
|---|---|
| ≥ 85 | High |
| ≥ 70 | Good |
| ≥ 50 | Moderate |
| < 50 | Limited Confidence |

### 1. Listing Completeness (`listing_completeness.py`)

Reuses the required/important/optional tiered-weighting *pattern* `property_decision_
score.py` uses for its dimensions (a per-tier weight applied across every field in
that tier), applied here to raw field presence instead of a scored dimension. Score =
weighted-present-fields / weighted-total-fields × 100.

Field tiers (`trust_config.py`, `COMPLETENESS_FIELDS`, weights `COMPLETENESS_TIER_
WEIGHTS`: required=3, important=2, optional=1):

- **Required**: title, district (`Property.area`), city, price (`monthly_rent` for
  rent / `sale_price` for sale — listing-type-aware), property type, bedrooms,
  bathrooms, size (sqm), at least one photo, description.
- **Important**: map coordinates, furnishing status, living rooms, a contact number
  (listing's own `contact_phone` or the mediator's account phone), 3+ photos.
- **Optional**: property age, deed area, WhatsApp number, license number.

**Judgment call:** `Property` has no `district` column — the codebase's existing
convention (confirmed in `comparable_properties.py`/`price_intelligence.py`, both of
which treat `Property.area` as the district for comparable-matching purposes) is that
`area` *is* the district field. Completeness/consistency both follow that convention
rather than inventing a separate district field.

Returns `CompletenessResult(score, present_fields, missing_fields, missing_required,
tier_breakdown)`. Never omitted from the overall assessment.

### 2. Listing Consistency (`listing_consistency.py`)

Flags data that contradicts itself or looks physically implausible. Each issue has a
severity (`info` / `warning` / `blocking`) and a fixed penalty subtracted from a
100-point baseline (`CONSISTENCY_SEVERITY_PENALTY`: blocking=35, warning=15, info=5),
floored at 0.

| Check | Severity |
|---|---|
| Price (`monthly_rent`/`sale_price` per listing type) ≤ 0 | blocking |
| Size (sqm) ≤ 0 | blocking |
| Bedroom count negative or > 20 (`MAX_REASONABLE_BEDROOMS`) | warning |
| Bathroom count negative or > 20 (`MAX_REASONABLE_BATHROOMS`) | warning |
| Rent listing has no `monthly_rent` but does have `sale_price` (or vice versa for sale) | warning |
| District (`Property.area`) not specified | info |

Returns `ConsistencyResult(score, issues, has_blocking_issues)`. Never omitted.

### 3. Mediator Trust (`mediator_trust.py`)

`compute_mediator_trust(mediator, *, review_count=0, avg_rating=None,
listing_count=0) -> MediatorTrustResult | None`. Returns `None` (component omitted)
when `mediator` is `None` — never a fabricated trust score for an unknown party.

Four sub-signals, weighted and summed (`MEDIATOR_TRUST_SIGNAL_WEIGHTS`, sums to 1.0
when all four apply):

- **Verified** (0.40) — `Mediator.is_verified`, 1.0 or 0.0.
- **Rating** (0.20) — `avg_rating / 5.0`, **only included when `review_count > 0`**
  (can't have a rating with zero reviews) — omitted and the other three sub-signals
  renormalize otherwise, the same missing-data rule as the top-level components.
- **Review count** (0.20) — linear ramp to 1.0 credit at `MEDIATOR_REVIEW_COUNT_
  TARGET = 10` reviews, capped beyond that.
- **Listing history** (0.20) — linear ramp to 1.0 credit at `MEDIATOR_LISTING_COUNT_
  TARGET = 5` listings, capped beyond that.

The `reason` string only ever uses the phrase **"Verified by myMakan"** for a verified
mediator (never "Government Verified"/"REGA Verified"/etc.) — the one allowed
verification phrase per the global constraint. `avg_rating`/`review_count` are the
caller's responsibility to supply (from the existing `GET /mediator/{id}/summary`
aggregate shape in `reviews.py`) — this module never queries `Review` rows itself.

### 4. Listing Freshness (`listing_freshness.py`)

`compute_listing_freshness(created_at, updated_at=None, availability_confirmed_at=
None, *, now=None) -> FreshnessResult`. Always computable — `Property.created_at` is
NOT NULL.

Four categories, checked in this order (`trust_config.py` thresholds, all in days):

1. **Recently Confirmed** (score 100) — `availability_confirmed_at` within
   `FRESHNESS_RECENTLY_CONFIRMED_DAYS = 30`.
2. **Recently Updated** (score 80) — `updated_at` (or `created_at` if never updated)
   within `FRESHNESS_RECENTLY_UPDATED_DAYS = 14`.
3. **Needs Reconfirmation** (score 50) — within `FRESHNESS_NEEDS_RECONFIRMATION_DAYS
   = 60`.
4. **Potentially Stale** (score 20) — older than that.

**Forward-compatibility note:** `Property.availability_confirmed_at` does not exist
yet as a column — it's on Prompt 2's scope (`GLOBAL CONSTRAINTS` list this as a
future prompt's migration). This module's signature already accepts it as an optional
parameter (default `None`), and `assess_property_trust` reads it via
`getattr(prop, "availability_confirmed_at", None)` so nothing breaks before the column
exists — the "Recently Confirmed" path is implemented but currently inert (always
falls through to the `updated_at` check) until Prompt 2 adds the column and a caller
starts passing a real value. This is the concrete mechanism behind the global
constraint's "keep the data model extensible for future verification" instruction, as
applied to freshness specifically.

### 5. Marketplace Confidence (`marketplace_confidence.py`)

`compute_marketplace_confidence(data_confidence: DataConfidence | None) ->
MarketplaceConfidenceResult | None`. The most literal application of "reuse, don't
recompute" in this feature: it does not touch `comparable_properties.py` or
`data_confidence.py` internals at all, it only takes an already-built `DataConfidence`
(the existing dataclass from Property Intelligence's `data_confidence.py`, itself
built from `comparable_properties.find_comparable_properties` + real listing/
mediator/area signals) and rescales its `signals_present / signals_total` ratio onto
the Trust Model's 0-100 scale, passing `level` and `reason` through unmodified.
Returns `None` (component omitted) when no `DataConfidence` is supplied.

### Deterministic narrative lists

`assess_property_trust` also builds three plain-language lists, all traceable to a
real signal from one of the five components above — no invented facts, no LLM:

- **`positive_signals`** (≤ `MAX_POSITIVE_SIGNALS = 6`): `"✓ Verified by myMakan"`
  when the mediator is verified (the one allowed verification string), "N% of listing
  details are complete" when ≥ 90%, "No data inconsistencies found" when the
  consistency score is 100, the freshness category label when it's "Recently
  Confirmed"/"Recently Updated", a rating summary when the mediator has ≥ 3 reviews,
  and a marketplace-data note when Marketplace Confidence is "High".
- **`missing_information`** (≤ `MAX_MISSING_INFORMATION = 6`): completeness's missing
  required fields first, then other missing fields.
- **`things_to_verify`** (≤ `MAX_THINGS_TO_VERIFY = 6`): every warning/blocking
  consistency issue's message, a reconfirm-availability prompt when freshness is
  "Needs Reconfirmation"/"Potentially Stale", a no-mediator-on-record or
  not-yet-verified note, and up to 3 "confirm X directly with the mediator" prompts
  for missing required fields.

### `TrustAssessment` shape

```python
@dataclass
class TrustAssessment:
    overall_score: int                              # 0-100
    trust_level: str                                 # High | Good | Moderate | Limited Confidence
    component_scores: dict[str, TrustComponentResult] # only present (non-omitted) components
    omitted_components: list[str]                    # e.g. ["mediator_trust", "marketplace_confidence"]
    positive_signals: list[str]
    missing_information: list[str]
    things_to_verify: list[str]
    data_confidence: DataConfidence | None            # passed through unmodified, for the caller's own display
```

Not yet a Pydantic schema — Prompt 1's scope is `backend/app/services/` +
`backend/app/core/` + tests only, no `backend/app/schemas/` changes, no API routes.
Prompt 2 (Trust API) will wrap this dataclass in a response schema.

## Tests

- `backend/tests/test_listing_completeness.py` — fully-complete vs. empty listing,
  required-vs-optional weighting (a missing required field costs more than a missing
  optional one), tier breakdown, sale-listing price-field awareness.
- `backend/tests/test_listing_consistency.py` — clean listing scores 100, each
  blocking/warning/info check individually, score floor at 0 with many simultaneous
  issues.
- `backend/tests/test_listing_freshness.py` — all four category thresholds including
  exact boundary days, `updated_at` fallback to `created_at`, the currently-inert
  "Recently Confirmed" path (both the case where it fires and the case where a stale
  confirmation correctly falls through to the `updated_at` check).
- `backend/tests/test_mediator_trust.py` — `None` with no mediator, verified vs.
  unverified scoring, rating omission with zero reviews, review/listing count ramp-
  and-cap behavior.
- `backend/tests/test_marketplace_confidence.py` — `None` passthrough, score mirrors
  the `DataConfidence` signal ratio exactly, reason string passed through unmodified.
- `backend/tests/test_trust_assessment.py` — weights sum to 1.0, a strong listing
  (verified mediator, high review count/rating, high data confidence, fresh) scores
  High/Good and includes the exact `"✓ Verified by myMakan"` string, a weak listing
  (empty fields, no mediator, no data confidence, 500-day-stale) scores Limited
  Confidence, missing-mediator and missing-data-confidence each independently omit
  their component and still produce a valid 0-100 overall score (the core
  renormalization contract), and a monotonicity check that a strictly-better listing
  never produces a lower trust level than a strictly-worse one.

**Test run:** `backend/venv/Scripts/python.exe -m pytest -q tests/test_listing_
completeness.py tests/test_listing_consistency.py tests/test_listing_freshness.py
tests/test_mediator_trust.py tests/test_marketplace_confidence.py tests/test_trust_
assessment.py` — **40 passed**. Full-suite collection (`pytest -q --collect-only`)
confirms no import breakage across the rest of the suite: **350 tests collected**,
consistent with this prompt only adding new files and touching nothing existing.

## Known limitations / open items for later prompts

- **No API route yet** — `assess_property_trust` isn't reachable over HTTP until
  Prompt 2 (`GET /api/v1/properties/{id}/trust`). That prompt's route handler owns
  wiring the DB-backed inputs (review aggregate query, mediator listing count query,
  `data_confidence.py`/`comparable_properties.py` calls) into this module's
  keyword arguments — this module intentionally stays DB-session-free.
- **`availability_confirmed_at` doesn't exist as a column yet** — see the Listing
  Freshness section above. Prompt 2 adds it; no code change needed in
  `listing_freshness.py`/`trust_assessment.py` when that lands, since both already
  read it via an optional parameter / `getattr` with a `None` default.
- **No persisted `quality_score`** — per Prompt 1's instruction to prefer calculating
  on read, nothing here is persisted; every call recomputes from the inputs given.
- **`Property.area` doubles as "district"** — no dedicated district column exists in
  this codebase (confirmed against `comparable_properties.py`/`price_intelligence.py`,
  which already treat it the same way). If a future prompt introduces a real district
  column, `COMPLETENESS_FIELDS`'s `"district"` check and `listing_consistency.py`'s
  `missing_district` check should be updated together.
- **Component weights/thresholds are a first-pass judgment call**, not from a
  reference spec (see "Why these five components" above) — flagged for review once
  real investor-demo data is available to sanity-check score distributions.

## Prompt 2 — Trust API + availability confirmation + reports DB + duplicate awareness

**Scope actually touched:** `backend/app/api/routes/properties.py` (extended — 3 new
endpoints, no new router file; see "Router choice" below), `backend/app/models/property.py`
(added `availability_confirmed_at` + `reports` relationship), `backend/app/models/
property_report.py` (new), `backend/app/models/__init__.py` (registered), one new Alembic
migration (`a9b0c1d2e3f4_add_availability_confirmed_at_and_.py`), `backend/app/services/
duplicate_detection.py` (new), `backend/app/core/trust_config.py` (extended with
duplicate-detection constants — kept the "one config, no hardcoded numbers in a
calculator" rule from Prompt 1), `backend/app/schemas/trust.py`, `backend/app/schemas/
property_report.py`, `backend/app/schemas/duplicate.py` (all new), 3 new test files. No
partner/admin endpoints, no frontend/mobile — all correctly out of scope per the prompt.

### New APIs

All three live on the existing `properties.router` (mounted at `/api/properties` and
`/api/v1/properties`), not a new `trust.py` router — see "Router choice" below.

- **`GET /properties/{id}/trust`** → `TrustAssessmentOut`. Public, no auth. Loads the
  property once (`_load_property_for_intelligence`, same helper `/intelligence` already
  uses — mediator via the model's `lazy="joined"`, `listing_images` via `selectinload`),
  then one review-summary aggregate query (reuses `reviews.py`'s existing
  `get_mediator_summary`, exactly like `GET /{id}` already does for `mediator_rating`/
  `mediator_review_count`), one mediator-listing-count aggregate query, one
  area-intelligence lookup, and one comparable-properties query (reuses
  `comparable_properties.find_comparable_properties` + `data_confidence_service.
  compute_data_confidence`, byte-for-byte the same calls `_assemble_property_intelligence`
  makes for `/intelligence`) — no N+1, no per-field/per-candidate query. Deliberately
  **not** gated behind the `property_intelligence` feature flag (unlike `/intelligence`
  and `/ai-summary`): the global constraint "Property Detail must render trust instantly"
  means Trust Center has to work even if Property Intelligence is toggled off.
- **`GET /properties/{id}/duplicate-check`** → `DuplicateAwarenessOut`. Public, no auth
  (same public-data reasoning as the existing `/similar` endpoint — every candidate is
  already a Published, publicly-visible listing). Runs `duplicate_detection.
  find_possible_duplicates`. Returns `is_possible_duplicate` + `confidence` (`none`/
  `low`/`medium`/`high`) + up to 5 `matches` (property_id, title, reasons, match_score) +
  a top-level `reasons` summary. Never merges/hides/deletes anything.
- **`POST /properties/{id}/reports`** → `PropertyReportOut`, 201. Authenticated
  (`get_current_user`). Body: `{reason, comment?}`. Rejects a second **active**
  (Open/Under Review) report from the same user on the same property for the **same
  reason** with 409 — a different reason, or resubmitting after the prior report on that
  reason was Resolved/Dismissed, is allowed. Audit-logged via the existing
  `app.core.audit.record_audit` helper (`action="property.reported"`, mirroring the exact
  call-site pattern already used in `saved_searches.py`/`devices.py`/`property_requests.py`
  — `db.add()`-only, same transaction as the report row, so a rollback discards both
  together). 404 for an unknown property, 422 for an unrecognized `reason`.

### DB changes

Single migration `a9b0c1d2e3f4` (revises `54726095b122`, the prior head):

- `properties.availability_confirmed_at` — nullable `TIMESTAMPTZ`. Prompt 1's
  `listing_freshness.py` already read this via `getattr(prop, "availability_confirmed_at",
  None)`, so no service-layer change was needed here — the "Recently Confirmed" freshness
  category, previously always-inert, is now live (verified in
  `test_recently_confirmed_availability_reflected_in_trust_freshness`). Nothing writes to
  it yet — that's Prompt 3's partner "Confirm Availability" action.
- **No `quality_score` column** — kept Prompt 1's "prefer calculating on read" decision;
  every `/trust` call recomputes from live data, nothing persisted/cached.
- **`property_reports` table** (new model `app.models.property_report.PropertyReport`):
  `id`, `property_id` (FK → `properties.id`, `ON DELETE CASCADE`, indexed),
  `reporter_user_id` (FK → `users.id`, `ON DELETE SET NULL`, indexed — nullable so the
  report survives the reporter's account being deleted, mirroring `AuditLog.user_id`'s
  pattern), `reason` (`VARCHAR(50)`), `comment` (`TEXT`, nullable), `status`
  (`VARCHAR(20)`, default `"Open"`, indexed), `created_at`, `resolved_at` (nullable),
  `resolved_by` (FK → `users.id`, `ON DELETE SET NULL`, nullable — Prompt 6's admin
  resolves it), `resolution_notes` (`TEXT`, nullable). `Property.reports` back-populates
  with `cascade="all, delete-orphan"`.

### Judgment calls

- **Router choice — extended `properties.py`, no new `trust.py` file.** The prompt offered
  either. All three endpoints are property-scoped (`/{property_id}/...`), already fit the
  existing router's URL namespace, and reuse private helpers already local to that file
  (`_load_property_for_intelligence`) — a separate router would have needed to import
  those or duplicate them. Matches how `/intelligence` and `/ai-summary` are already
  organized in the same file.
- **`PropertyReport.reason` enum values** (no fuller feature spec present in this repo to
  read section 24's exact list from — see Prompt 1's identical caveat): `duplicate_listing`,
  `incorrect_information`, `no_longer_available`, `fraudulent_or_scam`,
  `inappropriate_content`, `other`. Plain `String` column + a module-level tuple
  (`PROPERTY_REPORT_REASONS`) rather than a DB enum type — matches the existing convention
  in `app.models.property_request` (`PROPERTY_REQUEST_STATUSES`), so a future new reason
  is a Python-only change, no migration. Prompt 9's report modal is expected to present
  these as the reason list; revisit the wording/set then if the fuller spec surfaces.
- **"One active duplicate report per user/property/reason"** — read as: reject a *duplicate
  submission* (same user + same property + same reason) while an earlier one on that exact
  combination is still open, not "reports about reason=duplicate_listing only". A user can
  have simultaneous open reports on the same property for different reasons, and can
  resubmit the same reason once the prior one is Resolved/Dismissed.
- **Duplicate Awareness's "same building+beds+size+similar price" signal** — `Property` has
  no building/complex identifier column, so this is implemented as "same area/city + same
  bedroom count + similar size (±10%) + similar price (±10%)" instead, the closest
  equivalent from fields that actually exist. Combined with a separate, independently-
  scored "same mediator + location + characteristics" signal, a "shares an identical
  image URL" signal, and a "near-identical normalized description" signal — all additive
  (`DUPLICATE_SIGNAL_WEIGHTS` in `trust_config.py`, capped at 100), mapped to a
  none/low/medium/high confidence band by `DUPLICATE_CONFIDENCE_THRESHOLDS`. Candidates are
  pre-filtered to other *Published* listings of the same transaction type in the same city
  (same coarse filter `find_comparable_properties`/`get_similar_properties` already use),
  loaded with `selectinload(Property.listing_images)` to avoid N+1 across candidates.
- **No endpoint to *set* `availability_confirmed_at` in this prompt** — the column and the
  freshness wiring exist, but the actual "Confirm Availability" mutation is explicitly
  Prompt 3's scope (`POST /partner/properties/{id}/confirm-availability`, permission-checked
  to the owning mediator). This prompt's "availability confirmation persists" test
  therefore verifies the column at the model/DB level (set → commit → reload → still
  present) plus that `/trust` actually reads a populated value end-to-end, not a dedicated
  write endpoint.
- **`GET /duplicate-check` takes an existing property ID**, not draft/unsaved-listing
  fields. Prompt 8's partner pre-publish flow will need to check a listing that doesn't
  have an ID yet (still being drafted) — `duplicate_detection.find_possible_duplicates(db,
  prop)` takes a `Property` ORM instance so a later prompt can pass an unsaved/transient
  instance (or add a second draft-shaped entry point) without changing the underlying
  signal logic; deferred rather than guessing that shape now.

### Tests

- `backend/tests/test_trust_api.py` — response shape with/without a mediator on record,
  always-present vs. omitted components, the exact `"✓ Verified by myMakan"` string and
  that no disallowed verification phrase ever appears, 404 for an unknown property,
  `data_confidence`/`marketplace_confidence` presence with enough comparables,
  `availability_confirmed_at` persisting at the model/DB level, and a stale-by-`updated_at`
  listing correctly flipping to "Recently Confirmed" once `availability_confirmed_at` is
  set (end-to-end through the `/trust` endpoint).
- `backend/tests/test_property_reports.py` — 401 without auth, successful creation +
  audit-log-entry assertion, 409 on a same-user/same-property/same-reason active
  duplicate, a different reason allowed, resubmission allowed after the prior report is
  Resolved, 422 for an invalid `reason`, 404 for an unknown property.
- `backend/tests/test_duplicate_detection.py` — no-match / true-negative case, each of the
  four signals individually (same mediator+location+characteristics, shared image URL,
  same location+beds+size+similar price, identical normalized description), a different
  `listing_type` correctly excluded from candidates, plus `GET /duplicate-check` HTTP
  shape and 404.

**Test run:** `backend/venv/Scripts/python.exe -m pytest -q tests/test_trust_api.py
tests/test_property_reports.py tests/test_duplicate_detection.py
tests/test_trust_assessment.py tests/test_listing_completeness.py
tests/test_listing_consistency.py tests/test_listing_freshness.py
tests/test_mediator_trust.py tests/test_marketplace_confidence.py tests/test_properties.py
tests/test_property_intelligence_api.py` — **77 passed** (21 new + the 40 Prompt-1 service
tests + the pre-existing `properties`/`property_intelligence_api` route tests, confirming
no regression on the file this prompt extended). `pytest -q --collect-only` — **371 tests
collected** (350 + 21 new), no import breakage across the rest of the suite.

**Migration run:** `alembic upgrade head` applied cleanly against the local dev Postgres
DB (`54726095b122 -> a9b0c1d2e3f4`); verified via `sqlalchemy.inspect` that
`properties.availability_confirmed_at` and the full `property_reports` table + its three
indexes landed as expected.

### Known limitations / open items for later prompts

- **No write endpoint for `availability_confirmed_at` yet** — Prompt 3 owns
  `POST /partner/properties/{id}/confirm-availability`.
- **No admin resolve-report endpoint yet** — `PropertyReport.status`/`resolved_at`/
  `resolved_by`/`resolution_notes` exist and are ready, but the Open → Under Review →
  Resolved/Dismissed transition endpoint is Prompt 6's (admin moderation) scope.
- **Duplicate-check only works against a saved property today** — see the judgment-call
  note above; a draft/unsaved-listing entry point is deferred to whichever of Prompt 3/8
  actually needs it.
- **Duplicate Awareness signal weights/thresholds are a first-pass judgment call**, same
  caveat as Prompt 1's trust weights — no reference spec present in this repo, flagged for
  sanity-checking once real investor-demo listing data exists.

## Prompt 3 — Partner listing quality API + AI description assist + image signals

**Scope actually touched:** `backend/app/api/routes/partner_quality.py` (new router),
`backend/app/main.py` (router registration), `backend/app/services/image_quality.py`
(new), `backend/app/services/partner_listing_ai.py` (new), `backend/app/schemas/
partner_quality.py` (new), `backend/app/core/trust_config.py` (extended with image-
quality constants), `backend/app/core/ai/prompts.py` (extended with
`PARTNER_LISTING_IMPROVER`), 2 new test files. No admin/customer endpoints, no
frontend/mobile — all correctly out of scope per the prompt.

No existing `partner_quality.py`/partner-quality file was found before this prompt
(checked `backend/app/api/routes/` first, per the prompt's own instruction) — the only
existing partner-scoped routes are `properties.py`'s `/partner/*` endpoints (create/
update/list-mine/images, all property-CRUD-shaped) and `property_request_partner.py`
(the mediator response marketplace, unrelated to listing quality).

### New APIs

All three live on a new router, `backend/app/api/routes/partner_quality.py`, mounted at
`/partner/properties` (both `/api` and `/api/v1`) — see "Router choice" below for why
this isn't folded into `properties.py`'s existing `/partner/*` routes.

- **`GET /partner/properties/{id}/quality`** → `PartnerListingQualityOut`. Mediator-
  authenticated (`get_mediator_user`), ownership-checked (404 unknown id, 403 "Not your
  listing" for someone else's — identical pattern to `properties.py`'s
  `update_partner_property`/`add_partner_property_image`). Returns:
  - `completeness` — **the exact same `listing_completeness.compute_listing_completeness`
    call** `trust_assessment.assess_property_trust` already makes for the customer Trust
    Center (Prompt 1/2). Not a re-derivation — literally the same function, same input
    shape — so the "completeness reuse consistency" test asserts the two endpoints'
    completeness objects are byte-for-byte equal for the same property, by construction.
  - `missing_field_suggestions` — deterministic, no LLM. A plain-language, partner-facing
    action string per missing field (e.g. "Add a description explaining what makes this
    property worth viewing."), required-field gaps ordered first. Built from a new
    `_SUGGESTION_TEMPLATES` dict keyed by the same field keys `trust_config.
    COMPLETENESS_FIELDS` already defines (a label->key lookup is built once from that
    same config — `CompletenessResult` only carries display labels, not keys) — a field
    without a specific template falls back to a generic "Add {label}." rather than being
    silently dropped.
  - `image_quality` — new `image_quality.assess_image_quality()` service (see below).
  - `availability_confirmed_at` — passed straight through from the property row, so the
    partner UI (Prompt 8) can show current confirmation status without a second call.
- **`POST /partner/properties/{id}/confirm-availability`** → `PartnerAvailabilityConfirmOut`.
  Same ownership check. Sets `Property.availability_confirmed_at = now()` — the write
  endpoint Prompt 2 deferred to this prompt. Audit-logged via `record_audit`
  (`action="property.availability_confirmed"`, mirroring the exact `POST /reports`
  call-site pattern: `db.add()`-only inside the same transaction as the property update,
  so a rollback discards both together). No property-status restriction (see judgment
  calls below).
- **`POST /partner/properties/{id}/improve-with-ai`** → `PartnerImproveWithAiOut`. Same
  ownership check. Body: `{focus: "title"|"description"|"both" = "both", language:
  "en"|"ar" = "en"}`. Calls the new `partner_listing_ai.improve_listing_wording()`
  service (see below) and returns a suggestion only — **never writes to the property**.
  The partner applies it themselves via the existing `PATCH /properties/partner/{id}`
  (verified in `test_improve_with_ai_returns_suggestion_and_never_auto_saves`, which
  reloads the property after the call and asserts the title is unchanged).

### Deterministic image-quality signals (`app/services/image_quality.py`)

No computer vision anywhere — every signal is a plain presence/format check over
`Property.listing_images` (`url` + `display_order` only; see judgment calls for the
low-resolution check). New constants in `trust_config.py`:
`IMAGE_QUALITY_MIN_IMAGES = 3`, `IMAGE_QUALITY_MIN_WIDTH_PX = 800`,
`IMAGE_QUALITY_MIN_HEIGHT_PX = 600`.

| Signal | Severity | Trigger |
|---|---|---|
| `no_images` | blocking | Zero images on the listing |
| `too_few_images` | warning | 1-2 images (below `IMAGE_QUALITY_MIN_IMAGES`) |
| `duplicate_images` | info | Two or more images share the identical URL (case-insensitive) |
| `missing_primary_image` | warning | The first (`display_order` 0) image has a blank/whitespace-only URL |
| `low_resolution` | info | Any image's `width`/`height` (if present) is below the minimum — **inert today**, see below |

This is intentionally a **standalone service, not a sixth Trust Model component** —
Prompt 1's five weighted components (`TRUST_COMPONENT_WEIGHTS`) are that model's
already-shipped, documented contract; this prompt's scope is the partner-facing Listing
Quality panel only, so `image_quality` is surfaced alongside (not inside) the reused
completeness score in `PartnerListingQualityOut`, and never reaches `/properties/{id}/trust`.

### AI "Improve with AI" (`app/services/partner_listing_ai.py`, prompt
`core/ai/prompts.py::PARTNER_LISTING_IMPROVER`)

Mirrors `property_intelligence_ai.py`'s pattern exactly: gateway call + prompt registry
+ a deterministic fallback (the property's **current, unchanged** title/description)
when `ANTHROPIC_API_KEY` is unset, the gateway call raises, the reply isn't valid JSON,
or the parsed reply changes nothing — "Improve with AI" must never break the listing-
edit flow, and echoing the original wording is the only safe default (never a
fabricated rewrite standing in for a failed AI call).

Grounding is enforced structurally, not by a prompt instruction alone:
`_facts_block(prop)` builds its text from a fixed, explicit list of already-saved
property fields — title, description, transaction type, district/area, city, property
type, bedrooms/bathrooms/living rooms, size, furnishing, property age, and a fixed
9-item amenity allowlist (`_AMENITY_FIELDS`) — so a field the function doesn't
explicitly list (price, mediator verification status, `availability_confirmed_at`,
review data, anything else on the ORM row) has **no code path** into the prompt at all,
not merely an instruction not to mention it. `test_grounding_facts_only_contain_
supplied_property_fields` asserts both directions: every fact that IS present appears
in the captured prompt content, and "price"/"sar"/"verified"/"available"/an amenity
that's `False` on this particular property never do.

### Judgment calls

- **New router, not folded into `properties.py`.** Unlike Prompt 2's endpoints (public/
  customer-facing, natural fits for `properties.router`'s existing `/{property_id}/...`
  namespace), every endpoint here is partner-authenticated and partner-scoped via
  `get_mediator_user` — so it gets its own `/partner/properties` prefix + tag, registered
  in `main.py` the same way `property_request_partner.router` already is (own file, own
  prefix, alongside the other partner-scoped router). Kept `properties.py` untouched, per
  the prompt's own "Do NOT touch admin or customer-facing endpoints" instruction —
  `partner_quality.py` only reads `Property`/`Mediator` and reuses Prompt 1's completeness
  service, it never modifies `properties.py`'s existing `/partner/*` routes.
- **`/quality`'s missing-field suggestions are keyed off `trust_config.COMPLETENESS_
  FIELDS`'s field keys**, not a separate suggestion-config file — avoids a second source
  of truth for "what fields exist and what tier they're in" drifting from Prompt 1's
  config. A field added to `COMPLETENESS_FIELDS` in the future without a matching
  `_SUGGESTION_TEMPLATES` entry still produces a suggestion (the generic "Add {label}."
  fallback), so nothing silently disappears from the panel.
- **`missing_primary_image` is effectively defensive/inert today.** Every image-creation
  path (`add_partner_property_image` in `properties.py`) always assigns a non-blank URL
  and a sequential `display_order` starting at 0, so a "first image with a blank URL"
  can't currently happen through the app's own UI. Kept as an explicit check anyway
  (rather than assumed) since nothing at the DB/ORM level enforces it, and a future bulk-
  import or admin path could create a row that violates it — same "write the check even
  though today's data never triggers it" posture as Prompt 1's inert "Recently Confirmed"
  path before Prompt 2 added the column.
- **`low_resolution` is inert today** — `ListingImage` has no `width`/`height` columns
  (only `url`/`display_order`, confirmed in `app/models/listing_image.py`). Implemented
  against `getattr(img, "width"/"height", None)` so it activates automatically the moment
  a future migration adds those columns, without any change to `image_quality.py` — the
  identical forward-compatible mechanism Prompt 1 used for `availability_confirmed_at`
  before Prompt 2's column landed. No computer vision was considered or needed either
  way, per the global constraint.
- **`IMAGE_QUALITY_MIN_IMAGES = 3` intentionally duplicates the "3" already implicit in
  `COMPLETENESS_FIELDS`'s `multiple_images` tier** rather than importing it — the two are
  conceptually independent consumers (a completeness *scoring weight* vs. a standalone
  partner-facing *quality signal*) that happen to agree on the same number today; a
  future change to one threshold shouldn't silently move the other. Documented inline in
  `trust_config.py`.
- **No property-status restriction on Confirm Availability** — a mediator can confirm
  availability on a listing in any status (Pending Approval, Published, etc.), unlike
  `update_partner_property` which requires `status == "Published"` to edit. Confirm
  Availability only ever touches one timestamp column and is read solely by Listing
  Freshness as a trust signal — it isn't a content edit and doesn't need to trigger
  re-review, so gating it behind publish status would just block a harmless action
  without protecting anything.
- **Confirm Availability is audit-logged (`record_audit`) but does NOT `record_event`**
  to the outbox. `EventType.PROPERTY_AVAILABILITY_CHANGED` already exists and is
  consumed by `app.tasks.property_requests` (`register_handler`) — but that handler's
  existing semantics are "listing became published/unpublished" (`payload={"available":
  bool}`, emitted from `update_partner_property`'s publish/unpublish transition), a
  different concept from "mediator confirmed this listing is still accurate today."
  Reusing that event type here would misfire the property-request re-matching logic on
  every confirmation with a payload shape it doesn't expect. `record_audit` alone (same
  "add-only inside the caller's transaction" pattern as `POST /reports`) is sufficient
  for this prompt's "permission-checked, audit-logged" requirement without touching
  matching/notification side effects that were designed for a different event.
- **"Improve with AI" operates on the property's already-saved DB row, not a free-text
  draft the partner types into the request body.** The endpoint takes no title/
  description input at all — only `focus`/`language`. This was the simplest way to make
  the "prompt contains only supplied facts" contract mechanically enforceable (the facts
  block is built from one ORM object with a fixed field allowlist, not from
  caller-supplied text that could smuggle in an unverifiable claim), and matches Confirm
  Availability's same precondition (the property must already exist and be owned by the
  mediator). A brand-new, not-yet-saved draft listing has nothing to call this against
  yet — Prompt 8's partner form flow is expected to require at least a
  create/autosave-to-draft step before offering "Improve with AI", the same way it will
  need a real property id before offering "Confirm Availability" or the duplicate-check.
- **`focus` field added to the request** (not in the prompt's literal endpoint
  description) so the partner UI can request title-only or description-only
  improvements — both fields being independently useful, and the response schema always
  sets the non-`focus`ed field to `None` rather than a possibly-misleading unchanged
  copy, so the caller can tell "not requested" apart from "AI suggested no change."
- **A no-op AI reply (identical title/description echoed back) is treated as a fallback
  outcome (`generated_by="fallback"`), not `"ai"`.** Reporting "ai" for a suggestion
  that's byte-identical to the input would be misleading to the partner UI, which is
  expected to only show a "review suggestion" prompt when something actually changed.

### Tests

- `backend/tests/test_partner_quality_api.py` — HTTP-level: auth/ownership checks (401/
  403/404) across all three endpoints, completeness-object equality between `/quality`
  and the public `/trust` endpoint for the same property, missing-field-suggestion
  accuracy (present vs. missing fields, exact suggestion text), all five image-quality
  signals individually plus the "no issues" clean case, Confirm Availability persistence
  + audit-log-row assertion + its effect on `/trust`'s Freshness category end-to-end, and
  Improve-with-AI's "never auto-saves" contract (reloads the property after the call and
  asserts the title is unchanged in the DB).
- `backend/tests/test_partner_listing_ai.py` — service-level: grounding (mock
  `gateway.run_chat`, assert every supplied fact appears in the captured prompt and
  price/verification/availability/an unset amenity never do), `focus` field isolation
  (title-only / description-only leave the other field `None`), fallback on missing API
  key / gateway exception / unparseable JSON reply / a no-op AI reply, and Arabic
  language pass-through.

**Test run:** `backend/venv/Scripts/python.exe -m pytest -q tests/test_partner_quality_api.py
tests/test_partner_listing_ai.py tests/test_trust_api.py tests/test_property_reports.py
tests/test_duplicate_detection.py tests/test_trust_assessment.py tests/test_listing_
completeness.py tests/test_listing_consistency.py tests/test_listing_freshness.py
tests/test_mediator_trust.py tests/test_marketplace_confidence.py tests/test_properties.py
tests/test_property_intelligence_api.py tests/test_property_intelligence_ai.py
tests/test_home_finder.py` — **131 passed** (26 new + the 105 pre-existing tests across
every file this prompt's changes touch or reuse, confirming no regression). `pytest -q
--collect-only` — **397 tests collected** (371 + 26 new), no import breakage across the
rest of the suite.

### Known limitations / open items for later prompts

- **No draft/unsaved-listing entry point for "Improve with AI" or Confirm Availability**
  — both require an already-saved, mediator-owned property row. Prompt 8's partner
  create/edit form will need to decide its own autosave-before-AI-assist flow; this
  prompt doesn't guess that UX.
- **`missing_primary_image` and `low_resolution` are both currently inert** against
  real data (see judgment calls above) — ready for the moment a reorder/primary-photo
  endpoint or image dimension capture lands, no service-layer change needed then.
- **Image-quality signals are not part of the Trust Model** — they only reach the
  partner Listing Quality panel, not `/properties/{id}/trust`'s `positive_signals`/
  `things_to_verify`. If a later prompt decides customers should also see image-quality
  gaps, that's a deliberate, separate decision (a sixth Trust Model component, or folded
  into an existing one) — not assumed here.

## Prompt 4 — Mediator trust profile data + review intelligence AI summary

**Scope actually touched:** `backend/app/api/routes/mediators.py` (extended — new
helper functions + 2 endpoints changed/added, no new router file),
`backend/app/schemas/mediator.py` (extended `MediatorPublicOut` + new
`MEDIATOR_VERIFIED_LABEL` constant), `backend/app/schemas/review_summary.py` (new),
`backend/app/services/review_summary.py` (new), `backend/app/core/ai/prompts.py`
(extended with `MEDIATOR_REVIEW_SUMMARIZER`), 2 new test files. No frontend/mobile,
no property-level AI Trust Summary (that's Prompt 5) — both correctly out of scope
per the prompt.

### New APIs

- **`GET /mediators/public`** and **`GET /mediators/{id}/public`** — both extended
  (not new routes) with Trust & Activity fields (spec section 11) on
  `MediatorPublicOut`:
  - `verification_label` — `"✓ Verified by myMakan"` when `Mediator.is_verified`,
    else `null`. The **only** allowed verification phrase, exported as
    `MEDIATOR_VERIFIED_LABEL` in `schemas/mediator.py` so every caller renders the
    identical string rather than composing its own (mirrors
    `mediator_trust.py`'s identical wording constraint for the property-level Trust
    Model).
  - `avg_rating` / `review_count` — from **approved** reviews only, computed with the
    same aggregate math `reviews.py`'s existing `GET /mediator/{id}/summary` uses
    (mean of individual ratings, rounded to 1 decimal).
  - `active_listing_count` / `rental_listing_count` / `sale_listing_count` — count of
    this mediator's **Published** `Property` rows, split by `listing_type`.
  - `member_since` — `Mediator.created_at`, exposed under the spec's own term
    alongside the pre-existing `created_at` field (kept for backward compatibility —
    both web/mobile agent-profile pages already consume this shape per this prompt's
    own "do not touch frontend/mobile" instruction, so nothing existing could be
    renamed).
  - `response_rate` — fraction of this mediator's `LeadAssignment` rows with
    `status == "accepted"` out of all ever assigned; `null` when none have been
    assigned yet.
  - `avg_response_time_hours` — mean of `accepted_at - assigned_at` (hours) over
    accepted assignments only; `null` when there are none.
  - `areas` (pre-existing field) already satisfies "areas covered" — untouched.
  All five new computed groups (reviews, listings, response info) are built by one
  new helper, `_bulk_mediator_trust_activity_fields(db, mediator_ids)`, using one
  grouped query per data source across **all** requested mediator ids — the list
  endpoint (`/public`) calls it once for every mediator in the result set, never per
  row, keeping it N+1-free the same way Prompt 2's `/trust` and Prompt 3's `/quality`
  already are. The single-profile endpoint (`/{id}/public`) calls the same helper
  with a one-element list and keeps its pre-existing `CacheService` 5-minute TTL
  caching unchanged — rating/listing-count/response-info staleness within that
  window is an accepted trade-off, no different in kind from the pre-existing
  `total_leads_accepted` field already being subject to the same cache TTL.
- **`GET /mediators/{id}/review-summary`** → `ReviewSummaryOut` (new endpoint, new
  file `schemas/review_summary.py`). Public, no auth (same visibility as `/public`).
  Deliberately **not** embedded in `/public`'s response — the AI call is slower than
  a deterministic lookup, so `/public`'s Trust & Activity fields stay instant while
  this loads async from its own endpoint, mirroring the existing `/intelligence` vs
  `/ai-summary` split for Property Intelligence (Prompt 5's property-level AI Trust
  Summary is expected to follow the same split). Loads the mediator's approved-review
  aggregate via the existing `get_mediator_summary` (reused, not recomputed) plus up
  to `MAX_REVIEWS_FOR_AI_SUMMARY` (30) most-recent **approved** reviews, then calls
  the new `review_summary.summarize_reviews()` service. 404 for an unknown or
  inactive mediator (same rule `/public` already applies).

### Review Summary service (`app/services/review_summary.py`)

`summarize_reviews(reviews, *, avg_rating, review_count, language="en", user_id=None)
-> ReviewSummaryResult`. Mirrors `partner_listing_ai.py`'s pattern exactly: gateway
call + prompt registry (`core/ai/prompts.py::MEDIATOR_REVIEW_SUMMARIZER`) + a
deterministic fallback. This is pure text summarization (allowed under the global "AI
may explain/summarize, never invent facts" constraint), **not** a scoring
calculation — `avg_rating`/`review_count` are always the plain deterministic
aggregate the caller passes in, regardless of whether the AI call ran.

Falls back to `{avg_rating, review_count}` only (empty `positive_themes`/
`considerations`, `generated_by="fallback"`, a plain-language `note`) when **any** of:
approved review count is below `MIN_REVIEW_COUNT_FOR_AI_SUMMARY` (5, module-level
constant — see "Judgment calls" below for why it isn't in `trust_config.py`); none of
the supplied reviews carry actual comment text; `ANTHROPIC_API_KEY` is unset; the
gateway call raises; the reply doesn't parse into a usable JSON shape; or the parsed
reply has both `positive_themes` and `considerations` empty. Never a fabricated theme
standing in for a real one — the same "echo/omit, never invent" fallback discipline
`partner_listing_ai.py` established.

Grounding is enforced structurally, not by a prompt instruction alone:
`_reviews_facts_block(reviews)` builds the prompt content from **only** each
`Review.rating` + `Review.comment` in the list the caller passes — no other
`Review`/`Mediator`/`User` field (reviewer name, mediator verification status, listing
data, etc.) has any code path into the prompt. The route handler is responsible for
pre-filtering to `status == "approved"` before calling this module (the same
visibility rule `reviews.py`'s public endpoints already enforce) — a pending/rejected
review's text never reaches this service in the first place.
`test_grounding_prompt_only_contains_supplied_review_text` asserts every supplied
comment appears in the captured prompt and that no unsupported topic (verification,
government) does. This module never writes to `Review` rows — it only reads —
verified by `test_never_modifies_original_review_rows` (rating/comment/status
unchanged after the call).

### Judgment calls

- **`MIN_REVIEW_COUNT_FOR_AI_SUMMARY` (= 5) lives in `review_summary.py`, not
  `trust_config.py`.** Every other feature threshold in this codebase's Trust Center
  centralizes in `trust_config.py`, but that file's own docstring scopes it to "every
  weight/threshold the Trust Model... uses" — i.e. `trust_assessment.py`'s five
  weighted deterministic components. This constant gates a different kind of
  decision (whether an *AI text summary* is attempted at all), not a Trust Model
  score input, so it stays local to the service that owns it — the same reasoning
  Prompt 3 already used to keep `IMAGE_QUALITY_MIN_IMAGES` a `trust_config.py`
  constant but conceptually independent of `COMPLETENESS_FIELDS`'s "3" (image quality
  isn't a Trust Model component either).
- **Review Summary is a separate endpoint, not a field on `/public`.** The prompt's
  own text doesn't mandate a shape here, but every other AI-explanation feature in
  this codebase (Property Intelligence's `/ai-summary`, Prompt 3's
  `/improve-with-ai`) is already split from its deterministic sibling endpoint for
  the same reason: deterministic data must render instantly, AI-derived text loads
  async. Applying that same pattern here keeps `/public` (used by both existing
  agent-profile pages, which this prompt must not touch) exactly as fast as before,
  while giving Prompt 9's mediator profile page a natural place to fetch the AI
  summary independently with its own loading/fallback state.
- **`member_since` is a new field alongside the pre-existing `created_at`, not a
  rename.** `created_at` already ships in `MediatorPublicOut` and is presumably
  already consumed by the existing (untouched-by-this-prompt) web `agent.$id.tsx` /
  mobile `agent/[id].tsx` profile pages — renaming or removing it would risk breaking
  a page this prompt is explicitly forbidden from touching. Both fields carry the
  identical `Mediator.created_at` value.
- **"Response info if available" (spec section 11) is derived from
  `LeadAssignment.assigned_at`/`accepted_at`/`status`** — the only existing
  timestamps in the codebase that capture how a mediator responds to inbound
  business (`Lead` → `LeadAssignment`, the mediator marketplace's existing
  accept/reject flow in `leads.py`), rather than inventing a new response-tracking
  column. `response_rate` = accepted / total-ever-assigned;
  `avg_response_time_hours` = mean `accepted_at - assigned_at` over accepted
  assignments only. Both computed in Python from a plain per-mediator row fetch
  (not a DB-side date-diff SQL expression) — simplest cross-environment-safe
  approach at this data volume, avoiding a Postgres-specific `EXTRACT(EPOCH FROM
  ...)` expression that would need separate handling if this suite ever runs against
  a different DB in CI.
- **Listing-count "active" = `Property.status == "Published"`** — the same status
  value Prompt 1's `COMPLETENESS_FIELDS`/Prompt 2's duplicate-detection candidate
  filter already treat as the public-facing "live" state, no new status concept
  introduced.
- **`GET /review-summary` reuses `get_mediator_summary` (imported directly from
  `reviews.py`)** for the deterministic `avg_rating`/`review_count`, rather than
  recomputing — identical "reuse, don't recompute" pattern `properties.py`'s
  `/trust` endpoint already established for the exact same function. No circular
  import: `reviews.py` does not import `mediators.py`.
- **`MAX_REVIEWS_FOR_AI_SUMMARY` (= 30) bounds how many review comments are sent to
  the AI per call** — a popular mediator could accumulate hundreds of approved
  reviews; the summary only needs a representative, recent sample (most-recent-first,
  via the route's `ORDER BY created_at DESC LIMIT 30`), not the full history on every
  request. `review_count` in the response is always the *full* approved count from
  `get_mediator_summary`, never capped to the sample size.

### Tests

- `backend/tests/test_mediator_public_trust.py` — HTTP-level: the exact
  `"✓ Verified by myMakan"` string for a verified mediator and `null` for an
  unverified one, no disallowed verification phrase ever appears in the response
  text, listing counts split correctly by rent/sale and excluding non-Published
  status, rating/review-count computed from approved reviews only (pending/rejected
  excluded), `null` rating/count with zero reviews, `member_since` matching
  `created_at`, `response_rate`/`avg_response_time_hours` both `null` with no
  assignments and correctly computed from a mix of accepted/rejected assignments,
  list-endpoint (`/public`) and single-profile (`/{id}/public`) trust fields agreeing
  for the same mediator (parity, proving the bulk helper and single-element call
  produce identical results), and 404 for an unknown mediator.
- `backend/tests/test_review_summary.py` — service-level: minimum-count gating
  (below threshold never calls the gateway; at-threshold-with-comments does),
  enough-reviews-but-no-comment-text still falls back, grounding (every supplied
  review comment appears in the captured prompt, no invented topic), a
  never-modifies-original-rows check, fallback on gateway exception / unparseable
  reply / no-usable-themes reply / missing API key, Arabic language pass-through;
  plus 3 HTTP-level tests on `GET /{id}/review-summary` (fallback below minimum,
  pending/rejected reviews excluded end-to-end, 404 for an unknown mediator).

**Test run:** `backend/venv/Scripts/python.exe -m pytest -q tests/test_mediator_public_trust.py
tests/test_review_summary.py tests/test_redis_wired_endpoints.py tests/test_trust_api.py
tests/test_property_reports.py tests/test_duplicate_detection.py tests/test_trust_assessment.py
tests/test_listing_completeness.py tests/test_listing_consistency.py tests/test_listing_freshness.py
tests/test_mediator_trust.py tests/test_marketplace_confidence.py tests/test_properties.py
tests/test_property_intelligence_api.py tests/test_property_intelligence_ai.py
tests/test_partner_quality_api.py tests/test_partner_listing_ai.py tests/test_home_finder.py` —
**162 passed** (25 new + the 137 pre-existing tests across every file this prompt's changes
touch or reuse — including `test_redis_wired_endpoints.py`'s pre-existing mediator-cache test,
confirming the `/public` schema extension didn't break its existing assertions — confirming no
regression). `pytest -q --collect-only` — **422 tests collected** (397 + 25 new), no import
breakage across the rest of the suite.

### Known limitations / open items for later prompts

- **No AI Trust Summary (property-level) yet** — that's Prompt 5's scope, taking the
  Prompt 1 `TrustAssessment` + property facts + mediator trust facts + this prompt's
  review summary as its four permitted inputs.
- **`/public`'s new Trust & Activity fields inherit the endpoint's existing 5-minute
  cache TTL** — a rating/listing-count/response-info change can be up to 5 minutes
  stale on the single-profile endpoint (the list endpoint is never cached, always
  fresh). Not a new limitation introduced by this prompt — `total_leads_accepted`
  was already subject to the identical staleness window.
- **`response_rate`/`avg_response_time_hours` only reflect platform-assigned lead
  responsiveness** (`LeadAssignment`), not response time to direct customer
  inquiries/messages on a listing (`LeadMessage` exists but isn't a mediator
  responding to a *specific customer's* first contact in a way that maps cleanly to
  a single "time to first response" metric without a larger design decision) — flagged
  as a "if available" signal per the spec's own wording, not assumed to cover every
  possible interpretation of "response info."
- **Review Summary AI themes are not persisted** — every call to
  `GET /review-summary` recomputes from live review data (or, more precisely, calls
  the AI fresh each time above the threshold — no caching layer was added here,
  unlike `/public`). A later prompt could add a short TTL cache the same way `/public`
  already has one, if AI-call volume becomes a concern; not needed for this prompt's
  scope.

## Prompt 5 — AI Trust Summary (property-level)

**Scope actually touched:** `backend/app/services/trust_ai_summary.py` (new),
`backend/app/schemas/trust_summary.py` (new), `backend/app/core/ai/prompts.py`
(extended with `TRUST_SUMMARY_EXPLAINER`), `backend/app/api/routes/properties.py`
(extended — one new endpoint + a refactor of `GET /trust` to extract its shared
assembly logic into `_build_trust_assessment`, no behavior change to `/trust`
itself), 1 new test file. No frontend/mobile, no scoring changes — both correctly
out of scope per the prompt.

### New API

- **`GET /properties/{id}/trust-summary`** → `TrustSummaryOut`. Public, no auth
  (`current_user` is optional, only used for AI-call-log attribution — same pattern
  `POST /ai-summary` already uses via `get_optional_current_user`). Query param
  `language: "en"|"ar" = "en"`, mirroring `GET /mediators/{id}/review-summary`.
  Deliberately a **separate endpoint from `GET /trust`**, not a field embedded in its
  response — see "Router/exposure choice" below. 404 for an unknown property (same
  rule `/trust` already applies).

### AI Trust Summary service (`app/services/trust_ai_summary.py`, prompt
`core/ai/prompts.py::TRUST_SUMMARY_EXPLAINER`)

`summarize_trust_assessment(assessment, prop, mediator_trust, review_summary, *,
language="en", user_id=None) -> TrustSummaryResult`. Mirrors `review_summary.py`'s
and `partner_listing_ai.py`'s pattern exactly: gateway call + prompt registry + a
deterministic fallback — never an error state, never a blocked render.

This module **never scores or recalculates trust** — `overall_score`/`trust_level`/
every component always come from Prompt 1's `assess_property_trust`, regardless of
whether the AI call below succeeds. It is pure natural-language explanation of an
already-computed score, per the global "Trust/completeness/consistency scores are
100% deterministic — never LLM-calculated" constraint.

**Grounding is enforced structurally, not by a prompt instruction alone.** The
function signature takes exactly the four sources the prompt specifies as separate,
named parameters — `assessment: TrustAssessment` (Prompt 1), `prop: Property` (read
through a fixed allowlist, not the whole ORM row), `mediator_trust:
MediatorTrustResult | None` (Prompt 1's own dataclass — the caller passes
`assessment.component_scores.get("mediator_trust")`, so this is literally the same
object the assessment already computed, not a second independent lookup),
`review_summary: ReviewSummaryResult | None` (Prompt 4). Four private `_*_facts_block`
functions build the prompt content, one per source, each reading only that source's
own already-computed fields:

- `_trust_assessment_facts_block` — `overall_score`, `trust_level`,
  `positive_signals`/`missing_information`/`things_to_verify` (each capped at 4).
- `_property_facts_block` — **title, transaction type, district/area, city, property
  type only.** Deliberately excludes price, amenities, and mediator identity — this
  summary explains *trust*, not value or features, so nothing beyond "what/where"
  belongs in its grounding (verified by
  `test_grounding_prompt_only_contains_the_four_permitted_sources`, which asserts a
  planted price value never reaches the prompt).
- `_mediator_trust_facts_block` — verification status (using only the phrase
  "Verified by myMakan"/"Not yet verified by myMakan"), listing count, rating (or "no
  reviews yet").
- `_review_summary_facts_block` — review count, average rating, positive
  themes/considerations (or "No customer reviews yet").

No other `Property`/`Mediator`/`Review` field, and nothing from the database, has any
code path into the prompt — the route handler assembles exactly these four objects
and passes them in; the service itself never queries the DB. The prompt template
itself (`TRUST_SUMMARY_EXPLAINER`) additionally instructs the model to never accuse
anyone of fraud/illegal activity, never invent or imply verification beyond the exact
"Verified by myMakan" phrase (explicitly bans "Government Verified"/"REGA
Verified"/"Ejar Verified"/"Nafath Verified"), never invent a complaint not in the
given facts, and never make an unsupported safety claim — both layers (structural
grounding + explicit prompt rules) are tested.

**Fallback** (`generated_by="fallback"`, `_deterministic_fallback_summary`): assembled
entirely from the assessment's own already-computed text — trust level + score as a
sentence, then up to 3 `positive_signals`, then up to 3 `things_to_verify` (or, if
none, up to 3 `missing_information`). No AI call, no invented content, always a real
non-empty explanation. Triggered by: missing `ANTHROPIC_API_KEY`, the gateway call
raising, or an empty AI reply — the same "degrade, never 500, never a fabricated
explanation" discipline as Prompts 3 and 4's AI services.

### Judgment calls

- **Router/exposure choice — new endpoint on the existing `properties.router`, not a
  field on `GET /trust`.** The prompt explicitly asked to decide this "based on what
  keeps Property Detail non-blocking." Every other AI-explanation feature already
  shipped in this codebase (`/intelligence` vs `/ai-summary`, and this feature's own
  Prompt 4 `/public` vs `/review-summary`) already uses the identical split for the
  identical reason — deterministic data renders instantly, AI-derived text loads async
  from its own endpoint with its own loading/fallback state. Embedding the AI summary
  as a field on `/trust` would force every Property Detail page load to wait on (or at
  least kick off) an LLM call before the trust badge could render, which directly
  violates the "Property Detail must render trust instantly" global constraint. Kept
  on `properties.router` (not a new file) for the same reasoning Prompt 2 used for
  `/trust`/`/duplicate-check`: property-scoped, public, reuses private helpers already
  local to that file.
- **Refactored `GET /trust`'s body into `_build_trust_assessment(db, prop)`,
  reused by both endpoints — not a copy-paste duplication.** `/ai-summary` and
  `/intelligence` independently re-call `_assemble_property_intelligence` (accepted
  duplication in this codebase, since Property Intelligence's assembly is read-only
  and side-effect-free); the same "recompute independently" approach would work here
  too, but a *literal* second copy of `/trust`'s ~20-line assembly block risked the two
  endpoints' TrustAssessment silently drifting apart if one were edited later and not
  the other — a correctness concern specific to a *trust score*, not just a
  presentation detail. Extracting the shared function costs nothing (same query
  pattern, same call sites, verified behavior-unchanged by `test_trust_api.py`'s
  full pre-existing suite still passing byte-for-byte) and removes that drift risk
  entirely, so it was worth the small deviation from the `/ai-summary`-style pattern.
- **`mediator_trust` is sourced from `assessment.component_scores.get("mediator_trust")`,
  not a second query/computation.** Since Prompt 1's `MediatorTrustResult` already *is*
  "the mediator's deterministic trust facts" and is already inside the
  `TrustAssessment` the endpoint just built, passing it as an explicitly separate
  parameter (rather than having `trust_ai_summary.py` reach into `assessment.
  component_scores` itself) exists purely to make the grounding contract mechanically
  obvious at the function signature: four named inputs in, and the module body never
  touches anything but those four. No extra DB work either way.
- **The route also calls `review_summary_service.summarize_reviews()` inline** (same
  approved-reviews query + call Prompt 4's `GET /mediators/{id}/review-summary` route
  makes) rather than requiring the frontend to fetch `/review-summary` separately and
  pass its result in. This means a single `GET /trust-summary` call can involve two AI
  calls (mediator review summary, then trust explanation) when the mediator has enough
  reviews — accepted because this endpoint is *already* the async, non-blocking one
  (Property Detail's initial render never touches it), so extra latency here doesn't
  regress the "render trust instantly" constraint, and it means the frontend needs only
  one network call to get the fully-grounded AI trust explanation rather than
  orchestrating two requests and passing one result into the other itself. Below
  `review_summary.MIN_REVIEW_COUNT_FOR_AI_SUMMARY`, `summarize_reviews` returns
  immediately without an AI call, so the common case (few reviews) is cheap.
- **No mediator on record → `mediator_trust=None`, `review_summary=None`, not a 404 or
  an omitted call.** The service and the fallback text handle both as valid inputs
  ("No mediator is on record for this listing" / "No customer reviews yet") — same
  "omit, never fabricate" discipline as Prompt 1's `compute_mediator_trust` returning
  `None` rather than a guessed score.
- **No new "no-blocking" plumbing needed beyond endpoint separation** — the prompt's
  "no-blocking contract (function is separately callable/awaitable from the trust
  endpoint)" test requirement is satisfied structurally: `get_property_trust` (the
  `/trust` handler) has zero references to `trust_ai_summary` anywhere in its body,
  verified by `test_trust_endpoint_never_calls_the_ai_gateway` (mocks `gateway.
  run_chat` to raise if ever called, then asserts `GET /trust` still returns 200
  without tripping it), and `summarize_trust_assessment` is verified callable directly
  with plain Python objects, no request/DB/route dependency, by
  `test_summarize_trust_assessment_independently_callable_without_http_layer`.

### Tests

`backend/tests/test_trust_ai_summary.py` — service-level: fallback on missing API key
(without ever calling `run_chat`), fallback on gateway exception, fallback on an empty
AI reply, fallback text for a weak/Limited-Confidence listing never contains
fraud/scam/illegal language, AI path used on a successful call, grounding (every one
of the four sources' facts appears in the captured prompt — score/level/signals from
the assessment, title/district/city from the property while a planted price value
never appears, rating/review-count from mediator trust, themes/considerations from the
review summary — and no disallowed verification phrase or unsupported topic ever
appears), grounding with no mediator/no reviews still produces valid "no mediator on
record"/"no reviews yet" facts, Arabic language pass-through; plus HTTP-level:
`GET /trust-summary` fallback shape with no mediator (no disallowed verification
phrase in the response text either), 404 for an unknown property, the AI path
end-to-end with a mediator + enough approved reviews; plus the no-blocking contract:
`GET /trust` never invokes the AI gateway, and `summarize_trust_assessment` is
independently callable with no HTTP/DB dependency.

**Test run:** `backend/venv/Scripts/python.exe -m pytest -q tests/test_trust_ai_summary.py
tests/test_trust_api.py tests/test_property_reports.py tests/test_duplicate_detection.py
tests/test_trust_assessment.py tests/test_listing_completeness.py tests/test_listing_
consistency.py tests/test_listing_freshness.py tests/test_mediator_trust.py tests/
test_marketplace_confidence.py tests/test_properties.py tests/test_property_intelligence_api.py
tests/test_property_intelligence_ai.py tests/test_partner_quality_api.py tests/
test_partner_listing_ai.py tests/test_home_finder.py tests/test_mediator_public_trust.py
tests/test_review_summary.py tests/test_redis_wired_endpoints.py` — **175 passed** (13
new + the 162 pre-existing tests across every file this prompt's changes touch or
reuse, confirming no regression — including `/trust`'s own pre-existing test file
passing unchanged after the `_build_trust_assessment` extraction). `pytest -q
--collect-only` — **435 tests collected** (422 + 13 new), no import breakage across
the rest of the suite.

### Known limitations / open items for later prompts

- **AI Trust Summary is not persisted/cached** — every call recomputes fresh
  (including re-running Prompt 4's review summary inline). Same trade-off Prompt 4
  already accepted for `/review-summary`; a later prompt could add a short TTL cache
  if AI-call volume becomes a concern.
- **Frontend not wired yet** — Prompt 7 (Web Customer Trust Center UI) is expected to
  fetch `GET /trust` synchronously for the instant badge/section, then fetch
  `GET /trust-summary` asynchronously underneath it, exactly mirroring how Property
  Intelligence's existing `/intelligence` + `/ai-summary` pair is already consumed on
  the frontend (not yet checked against this prompt's scope, but the shape now exists
  to do so). Prompt 10 (mobile) mirrors the same pattern.
- **`_property_facts_block` intentionally omits price** — if a future prompt decides
  the trust explanation should also reference price fairness, that must be a deliberate
  addition (likely reusing Property Intelligence's already-computed price
  classification, not a raw price number) — not assumed here, since this summary's
  scope is trust/verification, not value.

## Prompt 6 — Admin moderation extensions

**Scope actually touched:** `backend/app/api/routes/admin_trust.py` (new router),
`backend/app/schemas/admin_trust.py` (new), `backend/app/main.py` (router
registration), 1 new test file. No new models, no migration — every score/field this
prompt surfaces is computed live from Prompts 1-5's existing services/models. No
frontend/mobile — correctly out of scope per the prompt (Prompt 11 is the admin UI).

Mirrors `property_request_admin.py`'s pattern exactly: `get_admin_user` for every
endpoint, `record_audit` for every mutating action, plain query-param filters +
`X-Total-Count` response header for the list endpoint (not a paginated envelope
object) — same conventions, no new admin-auth or pagination pattern invented.

### New APIs

All six live on a new router, `backend/app/api/routes/admin_trust.py`, mounted at
`/admin/trust` (both `/api` and `/api/v1`) — same "own prefix, own file" shape
`property_request_admin.router` already uses at `/admin/property-requests`.

- **`GET /admin/trust/dashboard`** → `AdminTrustDashboardOut`. Six counts (spec
  section 14): `listings_requiring_review` (`Property.status == "Pending Approval"`),
  `low_completeness_listings` / `stale_listings` (one pass over all Published
  properties calling Prompt 1's `compute_listing_completeness` /
  `compute_listing_freshness` per row — reused, not reimplemented as a second SQL-side
  scoring rule), `open_reports` (`PropertyReport.status` in the active set),
  `mediators_pending_verification` (`Mediator.is_verified == False`),
  `recently_reported_properties` (distinct properties with any report in the last
  `ADMIN_RECENTLY_REPORTED_DAYS` days).
- **`GET /admin/trust/properties`** → `list[ModerationListItemOut]`, with
  `X-Total-Count`. Property moderation list (spec section 15): property, transaction
  type, city, mediator (name + verified flag), trust score/level, completeness score,
  freshness category, open report count, status. Filters: `transaction_type`
  (rent/sale), `city`, `status`, `trust_level`, `low_completeness`, `reported`,
  `stale`, `mediator_verified`, plus `skip`/`limit`. See "Judgment calls" below for
  how filtering stays N+1-free.
- **`GET /admin/trust/properties/{id}`** → `PropertyReviewDetailOut`. Full review
  detail (spec section 15): the exact `TrustAssessment` `/trust` returns
  (`_build_trust_assessment`, imported directly from `properties.py` — not
  recomputed), a `data_quality` block reusing Prompt 3's own
  `compute_listing_completeness` + `assess_image_quality` + missing-field-suggestion
  logic (`partner_quality._missing_field_suggestions`, imported directly), the
  mediator's full public trust profile (Prompt 4's `_bulk_mediator_trust_activity_
  fields` / `_mediator_public_out`, imported directly, plus the admin-only
  `mediator_approval_status` field `MediatorPublicOut` doesn't expose publicly), every
  `PropertyReport` ever filed against this listing, the same `PropertyIntelligenceOut`
  `/intelligence` assembles (`_assemble_property_intelligence`, skipped — not
  error'd — when the `property_intelligence` flag is off), and `moderation_history`
  (audit-log entries scoped to this property + its reports). 404 for an unknown
  property.
- **`POST /admin/trust/properties/{id}/hide`** → `PropertyModerationActionOut`. Body
  `{reason?: string}`. Sets `Property.status = "Hidden"` (see "Judgment calls" for why
  this needed no migration/enum change), audit-logged (`property.admin_hidden`,
  metadata `{previous_status, reason}`), and — only when the listing was actually
  `Published` — emits the same `PROPERTY_UNPUBLISHED` + `PROPERTY_AVAILABILITY_
  CHANGED` outbox events the existing generic `PATCH /properties/{id}` already emits
  on an equivalent transition, so downstream consumers (matching, etc.) behave
  identically no matter which admin surface unpublished the listing. 409 if already
  Hidden.
- **`POST /admin/trust/properties/{id}/restore`** → `PropertyModerationActionOut`.
  Only valid from `status == "Hidden"` (409 otherwise) — reverses `hide` specifically,
  not a generic status-setter (the pre-existing generic admin `PATCH
  /properties/{id}` already covers arbitrary status changes). Sets `status =
  "Published"`, audit-logged (`property.admin_restored`), emits `PROPERTY_PUBLISHED`
  + increments the existing `properties_published_total` metric, mirroring
  `update_property`'s own re-publish transition.
- **`POST /admin/trust/reports/{report_id}/resolve`** → `ReportResolveOut`. Body
  `{status: "Under Review"|"Resolved"|"Dismissed", resolution_notes?: string}`. Only
  valid from an active report status (`Open`/`Under Review` — 409 otherwise, no
  un-resolving a terminal report). Sets `resolved_at`/`resolved_by` only for the two
  terminal targets (`Resolved`/`Dismissed`), not `Under Review`. Audit-logged as
  `property_report.under_review` / `property_report.resolved` /
  `property_report.dismissed` with `{property_id, previous_status, new_status}`. 404
  for an unknown report, 422 for an invalid target status (Pydantic `Literal`).

### Judgment calls

- **`Property.status = "Hidden"` is a new plain-string value, not a migration.**
  Checked `property.py` first per the prompt's own instruction: `Property.status` has
  never been a DB-level enum (plain `String`, default `"Published"`) and every
  existing `Property.status == "Published"` filter across search/matching/
  comparables/duplicate-detection already excludes anything else — so a `"Hidden"`
  row is automatically invisible everywhere a `"Pending Approval"` row already is,
  with zero code changes anywhere else in the codebase. This is the literal reading
  of "reuse existing property status mechanism."
- **`hide`/`restore` are a dedicated paired lifecycle, not folded into the existing
  generic admin `PATCH /properties/{id}`.** That endpoint already lets an admin set
  `status` to anything (and already emits the same publish/unpublish events on a
  transition) — this prompt's `hide`/`restore` deliberately narrow that down to one
  unambiguous, audit-labeled action pair (`property.admin_hidden` /
  `property.admin_restored`, distinct from a raw `PATCH`'s generic `property.updated`
  event) with idempotency guards (409 hiding an already-hidden listing, 409 restoring
  a non-hidden one) — the audit trail a moderation queue needs, without inventing a
  second status-mutation code path that could drift from the first. Restore always
  targets `"Published"` specifically (not "whatever status preceded hide"), since
  `"Published"` is the only status the rest of the app treats as "live" — restoring a
  `Pending Approval` listing back to `Pending Approval` would leave it invisible
  again, defeating the point of "restore."
- **List endpoint's trust score deliberately omits Marketplace Confidence.**
  `_item_trust_fields` calls Prompt 1's `assess_property_trust` per candidate
  property with `data_confidence=None` — computing Marketplace Confidence needs a
  per-property comparables query (`comparable_properties.find_comparable_properties`),
  which would make the list endpoint N+1 across every row. Completeness/Consistency/
  Freshness (no extra query — computed straight off the loaded `Property` row) and
  Mediator Trust (review/listing aggregates bulk-loaded once via `mediators.py`'s own
  `_bulk_mediator_trust_activity_fields`, reused not reimplemented) are all included,
  so the list's `trust_score`/`trust_level` can differ slightly from the single-
  property `/trust` and this prompt's own review-detail endpoint (both of which use
  `_build_trust_assessment`, the full five-component version, unchanged). Documented
  in `_item_trust_fields`'s docstring — a deliberate list-view performance trade-off,
  never a second scoring algorithm, since every included component is the exact same
  function call either way.
- **Moderation list filtering is DB-pushable-filters-first, then Python.**
  `transaction_type`/`city`/`status` filter at the SQL level; `trust_level`/
  `low_completeness`/`reported`/`stale`/`mediator_verified` are applied in Python over
  that already-narrowed candidate set (pagination/`X-Total-Count` computed after all
  filters). At this feature's demo-scale data volume (see the global "feature-first
  investor demo mode" constraint) this is simple and correct without a second,
  SQL-duplicated implementation of the same deterministic rules Prompt 1 already
  encodes in Python; a future prompt could push more of this into SQL if the listing
  count ever grew large enough to matter — not needed for this prompt's scope, and
  explicitly "do NOT build a separate moderation platform" argues against
  over-engineering it now.
- **Dashboard's `low_completeness_listings`/`stale_listings` iterate every Published
  property in Python**, same reasoning/trade-off as the list endpoint's filtering —
  reuses the exact calculators, doesn't re-encode their thresholds in SQL.
- **`ADMIN_LOW_COMPLETENESS_THRESHOLD` (60), `ADMIN_STALE_FRESHNESS_CATEGORIES`
  (`{"Needs Reconfirmation", "Potentially Stale"}`), `ADMIN_RECENTLY_REPORTED_DAYS`
  (14) live in `admin_trust.py`, not `trust_config.py`** — same reasoning Prompt 4
  used for `MIN_REVIEW_COUNT_FOR_AI_SUMMARY`: these gate an *admin moderation view*,
  not a Trust Model score input, so they stay local to the router that owns them. No
  fuller feature spec is present in this repo to read section 14-15's exact numbers
  from (same caveat as every earlier prompt) — flagged for revisit once real
  investor-demo data exists to sanity-check the thresholds against.
- **"Mediators pending verification" = `Mediator.is_verified == False`, independent
  of `approval_status`.** `approval_status` ("pending"/"approved"/"rejected") gates
  portal *access* (can this mediator log into the partner portal at all); `is_verified`
  is the separate myMakan-verification trust signal this whole feature is about. An
  approved, actively-listing mediator who simply hasn't been trust-verified yet is
  exactly the moderation queue's intended audience, so the count doesn't additionally
  filter on `approval_status`.
- **"Moderation history" unions two `AuditLog` queries** (`entity_type="property"` +
  `entity_id==str(property_id)`, and `entity_type="property_report"` +
  `entity_id IN (this property's report ids)`) rather than one equality filter —
  `PropertyReport`'s own audit entries (`property.reported` from Prompt 2, and this
  prompt's own resolve actions) don't carry `property_id` directly on the `AuditLog`
  row, only the report's own id, so both entity types have to be gathered and
  unioned. Capped at `ADMIN_MODERATION_HISTORY_LIMIT` (50), newest first.
- **Review detail's Property Intelligence is *skipped*, not error'd, when the
  `property_intelligence` feature flag is off** — unlike the customer-facing
  `/intelligence` endpoint (which 503s via `_require_property_intelligence_enabled`
  when the flag is off), this admin view returns `property_intelligence: null` in
  that case rather than failing the whole review-detail assembly over an unrelated
  flag. The Trust Assessment, data quality, mediator info, reports, and moderation
  history sections are the review page's core content either way.
- **No new feature flag added for this router** — consistent with Prompts 2-5, which
  deliberately did not gate their new endpoints behind a new Trust Center flag (only
  `get_admin_user` gates them, same as `property_request_admin.py`'s own
  `_feature_gate()` is a *pre-existing*, unrelated flag for that other dashboard, not
  a precedent to copy here).

### Tests

`backend/tests/test_admin_trust.py` — 27 tests: permission checks (401/403 across
dashboard/list/detail/hide/resolve for a non-admin or anonymous caller), dashboard
count correctness (one fixture per counted category), moderation-list response shape
+ `X-Total-Count` header, filter-by-transaction-type / filter-by-reported /
filter-by-mediator-verified / filter-by-stale individually, a filter-combination test
(transaction type + reported together, proving filters compose as AND rather than
each independently matching), review-detail assembly (trust/data-quality/mediator/
reports/moderation-history all present and correct) both with and without a mediator
on record, 404 for an unknown property, moderation-history reflecting a hide action
end-to-end, hide-then-restore roundtrip with audit-log-row assertions for both
actions, 409 hiding an already-hidden property, 409 restoring a non-hidden one, 404
hiding an unknown property, report resolution to each of the three target statuses
(with the Under-Review case asserting `resolved_at`/`resolved_by` stay `null`) with
an audit-log-row assertion, 409 re-resolving an already-terminal report, 422 for an
invalid target status, and 404 for an unknown report.

**Test run:** `backend/venv/Scripts/python.exe -m pytest -q tests/test_admin_trust.py
tests/test_trust_ai_summary.py tests/test_trust_api.py tests/test_property_reports.py
tests/test_duplicate_detection.py tests/test_trust_assessment.py tests/test_listing_
completeness.py tests/test_listing_consistency.py tests/test_listing_freshness.py
tests/test_mediator_trust.py tests/test_marketplace_confidence.py tests/test_properties.py
tests/test_property_intelligence_api.py tests/test_property_intelligence_ai.py
tests/test_partner_quality_api.py tests/test_partner_listing_ai.py tests/test_home_finder.py
tests/test_mediator_public_trust.py tests/test_review_summary.py
tests/test_redis_wired_endpoints.py` — **202 passed** (27 new + the 175 pre-existing
tests across every file this prompt's changes touch or reuse, confirming no
regression). `pytest -q --collect-only` — **462 tests collected** (435 + 27 new), no
import breakage across the rest of the suite.

### Known limitations / open items for later prompts

- **List/dashboard computation is Python-side over the full candidate set**, not
  SQL-pushed — fine at this feature's demo-scale data volume (explicit global
  constraint), would need revisiting if the property count ever grew large enough for
  per-request full-table iteration to matter.
- **Marketplace Confidence is not part of the moderation list's trust score** (see
  judgment calls above) — only the single-property review-detail endpoint (and the
  customer-facing `/trust`) include all five components. If a future prompt decides
  the list view needs the identical overall score, that requires either accepting the
  N+1 comparables cost or a bulk/batched comparables lookup that doesn't exist yet —
  not built here since it wasn't needed for filtering/triage.
- **No bulk moderation actions** (e.g. hide multiple listings at once) — spec
  sections 14-15 describe per-property actions only; each of `hide`/`restore`/
  `resolve` operates on one property/report at a time, matching every other action in
  this codebase's existing admin surfaces (`property_request_admin.py`'s
  pause/close/retry-matching are all single-entity too).
- **"Listings requiring review" is exactly `status == "Pending Approval"`** — the
  partner-submission review queue that already existed before this feature. A
  broader "listings requiring review" definition (e.g. also surfacing high-trust-risk
  Published listings) was considered but not built: `low_completeness_listings` /
  `stale_listings` / `open_reports` already separately surface those cases as their
  own dashboard counts, so folding them into this one too would double-count without
  adding information — no fuller spec is present in this repo to confirm intent
  either way.

## Full API surface (Prompts 2-6) — reference for Prompts 7-11 (frontend/mobile)

Every Trust Center backend endpoint that exists after Prompt 6, grouped by consumer.
All are mounted at both `/api/...` and `/api/v1/...` (same router registered twice,
per this codebase's existing convention — see `main.py`). None of these are gated
behind a new Trust Center feature flag; `property_intelligence`-dependent fields
degrade gracefully (never a hard 503) rather than being globally flag-gated.

**Customer-facing (public, no auth unless noted) — Prompt 7 (web) / Prompt 10 (mobile):**

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /properties/{id}/trust` | `TrustAssessmentOut` | Deterministic, renders instantly. |
| `GET /properties/{id}/trust-summary?language=en\|ar` | `TrustSummaryOut` | AI explanation, loads async — never blocks `/trust`. |
| `GET /properties/{id}/duplicate-check` | `DuplicateAwarenessOut` | Possible-duplicate + confidence + reasons. |
| `POST /properties/{id}/reports` (auth required) | `PropertyReportOut`, 201 | Body `{reason, comment?}`. 409 on active duplicate submission. |
| `GET /mediators/public` / `GET /mediators/{id}/public` | `MediatorPublicOut` | Trust & Activity fields (`verification_label`, ratings, listing counts, `member_since`, response info). |
| `GET /mediators/{id}/review-summary?language=en\|ar` | `ReviewSummaryOut` | AI-summarized reviews, deterministic fallback below the minimum review count. |

**Partner-facing (mediator-authenticated) — Prompt 8 (web):**

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /partner/properties/{id}/quality` | `PartnerListingQualityOut` | Completeness + missing-field suggestions + image quality, own listing only. |
| `POST /partner/properties/{id}/confirm-availability` | `PartnerAvailabilityConfirmOut` | Sets `availability_confirmed_at`. |
| `POST /partner/properties/{id}/improve-with-ai` | `PartnerImproveWithAiOut` | Body `{focus, language}`. Suggestion only — never auto-saves. |

**Admin-facing (admin-authenticated) — Prompt 11 (web):**

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /admin/trust/dashboard` | `AdminTrustDashboardOut` | Six moderation-queue counts. |
| `GET /admin/trust/properties?...filters` | `list[ModerationListItemOut]` (+ `X-Total-Count` header) | Filters: `transaction_type`, `city`, `status`, `trust_level`, `low_completeness`, `reported`, `stale`, `mediator_verified`, `skip`, `limit`. |
| `GET /admin/trust/properties/{id}` | `PropertyReviewDetailOut` | Trust + data quality + mediator + reports + property intelligence + moderation history. |
| `POST /admin/trust/properties/{id}/hide` | `PropertyModerationActionOut` | Body `{reason?}`. 409 if already hidden. |
| `POST /admin/trust/properties/{id}/restore` | `PropertyModerationActionOut` | 409 if not currently hidden. |
| `POST /admin/trust/reports/{report_id}/resolve` | `ReportResolveOut` | Body `{status: "Under Review"\|"Resolved"\|"Dismissed", resolution_notes?}`. 409 if already terminal. |

**Verification wording reminder for every frontend prompt:** the only string ever
allowed to render as a verification claim is exactly `"✓ Verified by myMakan"`
(`MediatorPublicOut.verification_label`, or `MediatorTrustOut`/`TrustAssessmentOut`'s
`positive_signals` on the property side). Never render "Government Verified" / "REGA
Verified" / "Ejar Verified" / "Nafath Verified" anywhere, even as a placeholder or a
"coming soon" label beyond the generic "Not connected" wording spec section 21
describes for future providers.

This was the last backend prompt in the plan (Prompts 7-11 are frontend/mobile,
Prompt 12 is the final test/demo pass) — no further backend endpoints are expected
before Prompt 12.

## Prompt 7 — Web: Customer Property Trust Center UI

**Scope actually touched:** `frontend/src/components/maskan/PropertyTrustCenter.tsx`
(new — `PropertyTrustSection` + `PropertyTrustSheet`), `frontend/src/components/maskan/
VerificationBlock.tsx` (new — generic reusable component), `frontend/src/lib/api/
maskan.ts` (extended — 4 new API functions + types for Prompts 2/5's trust endpoints),
`frontend/src/lib/i18n/en.ts` + `ar.ts` (extended — new top-level `verification`
namespace, `propertyCard.trust.*`, `property.trust.*`), `frontend/src/routes/
property.$id.tsx` (extended — one new import + one new component insertion, no
existing code changed), `frontend/src/components/maskan/PropertyCard.tsx` (extended —
small trust-signal row + two pure helper functions). No mobile/partner/admin files
touched — correctly out of scope per the prompt.

### New components

- **`PropertyTrustSection`** (`PropertyTrustCenter.tsx`) — the instant trust badge/
  entry, inserted into `property.$id.tsx` right after `<Summary>` and before
  `<IntelligenceHero>`. Owns two independent effects: one fetches
  `GET /properties/{id}/trust` (deterministic, renders the score ring, trust-level
  badge, and up to 4 top signals — positive signals first, `things_to_verify` filling
  any remaining slots — plus the "View Trust Details" button) and a second,
  *separately* fetches `GET /properties/{id}/trust-summary?language=` (Prompt 5's AI
  explanation) and renders it underneath in its own loading state — mirrors the exact
  `fetchPropertyIntelligence` / `fetchPropertyAiSummary` split already established on
  this same page for myMakan Intelligence, so the AI text can never delay or block the
  deterministic score above it. A failed `/trust` call renders nothing (`return null`,
  same "never block the rest of the page" contract `IntelligenceHero` already uses);
  a failed `/trust-summary` call simply omits the AI paragraph, no error state shown.
  The `"AI Summary"` label only renders when `generated_by === "ai"` — a deterministic
  fallback summary (already itself derived from the assessment's own real signals, per
  Prompt 5) is shown plainly, matching Prompt 4's "visible AI Summary label" contract
  applied to this AI summary too.
- **`PropertyTrustSheet`** (same file, not exported) — the full detail sheet, opened by
  "View Trust Details". Built as a hand-rolled fixed-overlay component (not the
  shadcn `Sheet` primitive in `components/ui/sheet.tsx`), matching this file's
  pre-existing `DecisionSheet` pattern exactly (same overlay/backdrop classes, same
  Escape-key handler, same `stopPropagation` on the inner panel) rather than
  introducing a second modal pattern into a page that already has one. Sections, in
  the prompt's own order:
  - **Listing Confidence** — `trust.component_scores.completeness`'s `score` (via the
    existing `ScoreBar`), then every `present_fields`/`missing_fields` label rendered
    with a ✓ (`CheckCircle2`, success) or a hollow circle (`Circle`, muted) respectively
    — the ✓/△-style presence list the prompt asks for, using an outline circle instead
    of a literal △ glyph to stay visually consistent with the ✓ `CheckCircle2` used
    everywhere else on this page for "present" states.
  - **Mediator** — `mediatorName`/`mediatorId` passed down from the page's own already-
    loaded `property.agent`/`property.mediatorId` (no new mediator fetch), plus
    `trust.component_scores.mediator_trust` (rating, review count, listing count) —
    literally "reuse data already on the page" for the rating/name/id half, and the
    already-fetched Trust Assessment for the verification/listing-count half. Renders
    the new generic `VerificationBlock` with exactly one provider row (myMakan).
  - **Listing Freshness** — `trust.component_scores.freshness`'s category (mapped to a
    localized label) and `reason` (backend free text, rendered as-is — see "Free-text
    localization" below).
  - **Price Confidence** — reuses the `intelligence` prop (the *same*
    `ApiPropertyIntelligence` object `property.$id.tsx`'s own effect already fetched
    for myMakan Intelligence, passed straight through as a prop) — renders
    `intelligence.price_intelligence.classification` and
    `intelligence.data_confidence.level` with the exact same badge-tone/i18n-key
    helpers `property.$id.tsx` already uses for those same values elsewhere on the
    page (small local duplicates of `classificationTone`/`CLASSIFICATION_KEYS`, since
    those are module-private to the route file — see "Local duplication" below). No
    second price/data-confidence calculation anywhere in this component.
  - **Things to Verify** — `trust.things_to_verify` rendered as a plain bullet list
    (already-computed, already-capped-at-6 deterministic strings from Prompt 1).
  - **Report a Concern** — a `disabled` `Button` with a `title` tooltip reading
    "Reporting a concern will be available soon." per the prompt's own "stub the
    trigger now" instruction — not wired to any handler; Prompt 9 owns building the
    actual modal and is expected to wire it into this same button.
- **`VerificationBlock`** (`VerificationBlock.tsx`) — generic, reusable per spec
  section 21: takes a `providers: {key, name, status, label}[]` prop and renders one
  row per provider (`status === "verified"` → success-toned label,
  `"not_connected"` → muted). Built generically (any number of providers, any labels)
  but today only ever called with a single-element array (`{key: "mymakan", ...}`) —
  no other provider is named or rendered anywhere in this codebase, per the global
  wording constraint. Reused as-is by `PropertyTrustSheet`'s Mediator section;
  Prompt 9's mediator profile page is expected to reuse this same component rather
  than building its own verification row.

### `maskan.ts` additions

Four new functions + their response types, placed right after the existing
`fetchPropertyAiSummary` (mirroring its exact `requestJson<T>(...)` pattern, no new
fetch helper introduced):

- `fetchPropertyTrust(propertyId)` → `GET /properties/{id}/trust` → `ApiTrustAssessment`
  (mirrors `schemas/trust.py::TrustAssessmentOut` field-for-field, including the
  per-component `null`-when-omitted shape).
- `fetchPropertyTrustSummary(propertyId, language)` → `GET /properties/{id}/trust-
  summary?language=` → `ApiTrustSummary` (mirrors `schemas/trust_summary.py`).
- `fetchDuplicateCheck(propertyId)` → `GET /properties/{id}/duplicate-check` →
  `ApiDuplicateCheck` (mirrors `schemas/duplicate.py`). Exported for Prompt 8's
  partner pre-publish flow — **not called anywhere in this prompt's UI**; customer
  Property Detail has no duplicate-awareness surface per the prompt's own Build list.
- `submitPropertyReport(propertyId, {reason, comment?})` → `POST /properties/{id}/
  reports` → `ApiPropertyReport`, plus the `PROPERTY_REPORT_REASONS` const (mirrors
  `models/property_report.py`'s tuple exactly). Exported for Prompt 9's report modal —
  **not called anywhere in this prompt's UI** either, since the "Report a Concern"
  button is a stub per the prompt's own instruction. Judgment call: added both
  functions now (rather than waiting for Prompt 8/9 to add them) so those prompts can
  wire straight into an already-typed, already-tested client function instead of
  touching `maskan.ts` again for a shape this prompt already had to define anyway to
  type `ApiTrustAssessment`'s sibling schemas correctly.

`ApiPropertyIntelligence`/`ApiDataConfidence` (already existing types) are reused
as-is for the Price Confidence section — no new intelligence-shaped type was added.

### i18n additions

- **New top-level `verification` namespace** (`en.ts`/`ar.ts`, inserted after
  `propertyCard`) — generic copy for `VerificationBlock`: `title`, `mymakan`,
  `verifiedLabel`, `notVerifiedLabel`, `notConnected`, `explainer`. Kept top-level
  (not nested under `property.*`) specifically so Prompt 9's mediator profile page
  (a different route) can reuse the same keys without importing anything
  property-page-scoped.
- **`propertyCard.trust.*`** — `verified`, `complete` (`{{percent}}%`),
  `recentlyUpdated` — the PropertyCard chip row's copy.
- **`property.trust.*`** (inserted after the existing `property.landlord` block) —
  everything the badge/entry and sheet need: `badge`, `loading`, `unavailable`,
  `scoreLabel`, `level.*` (4 trust levels), `viewDetails`, `aiSummary.{label,
  loading}`, `sheet.title`, `sheet.sections.*` (5 section headers),
  `sheet.completeness.{subtitle, present, missing, fields.*}` (19 field-label keys —
  one per `trust_config.py::COMPLETENESS_FIELDS` entry), `sheet.mediator.{listings,
  noReviewsYet, noMediator}`, `sheet.freshness.category.*` (4 freshness categories),
  `sheet.priceConfidence.{subtitle, unavailable}`, `sheet.thingsToVerify.empty`,
  `sheet.reportConcern.{cta, comingSoon}`.
- Both `en.ts` and `ar.ts` were extended with the identical key structure (`ar.ts`
  satisfies `TranslationDict = DeepStringify<typeof en>`, so a missing key would be a
  type error) — verified via `npm run typecheck` passing clean after both files were
  edited.

### Judgment calls

- **The exact phrase `"✓ Verified by myMakan"` is never run through per-language
  translation — it's the identical literal string in both `en.ts` and `ar.ts`.** The
  backend itself never localizes this string either (`MEDIATOR_VERIFIED_LABEL` in
  `app/models/mediator.py` is a single hardcoded constant; `GET /mediators/{id}/
  public` takes no `language` param at all), so treating it as a fixed brand/legal
  string rather than translatable UI copy matches the backend's own contract. Still
  routed through `t()` (not a bare string literal in the component) so it stays a
  single source of truth per file, consistent with this codebase's "always go through
  `t()`" convention, while both locale files carry the same value on purpose.
- **Free-text localization gap (documented, not introduced by this prompt).**
  `positive_signals`/`missing_information`/`things_to_verify` (Prompt 1) and a
  `MediatorTrustResult`/`FreshnessResult`'s `reason` string are all deterministic
  English sentences generated server-side, with no `language` parameter on `/trust`
  to request a translated version. This prompt renders them as-is in both locales —
  the *exact* precedent `AtAGlanceCard`'s `strengths`/`considerations`/
  `things_to_verify` (Property Intelligence, pre-existing on this same page) already
  set for the identical situation. Only `GET /trust-summary`'s AI-generated
  `summary` field is actually localized (it takes `language` and Prompt 5's AI/
  fallback text respects it) — the deterministic strings are not. Flagged as a
  known limitation below, not a regression this prompt introduced.
- **Completeness field labels and consistency-issue codes are mapped to i18n keys via
  a local `Record<string, string>` lookup** (`COMPLETENESS_FIELD_KEYS` in
  `PropertyTrustCenter.tsx`), keyed by the exact backend display-label string from
  `trust_config.py::COMPLETENESS_FIELDS` — the identical "raw backend string → local
  i18n key, with the raw string itself as an unrecognized-value fallback" pattern
  `property.$id.tsx` already uses for `CLASSIFICATION_KEYS`/`VALUE_LABEL_KEYS`. A
  `consistency.*` i18n block was drafted for the same purpose but removed before
  landing — `things_to_verify` already carries backend-composed consistency-issue
  *sentences* (Prompt 1's `assess_property_trust`), not raw issue codes, so there was
  never a call site that needed a code→label map; keeping unused i18n keys around
  would just be dead weight.
- **`classificationTone`/`CLASSIFICATION_KEYS` are small local duplicates inside
  `PropertyTrustCenter.tsx`, not imports from `property.$id.tsx`.** Those helpers are
  module-private (not exported) in the route file, and components conventionally
  shouldn't import from a route file in this codebase's layering (routes import
  components, not the reverse) — a ~10-line duplicate was judged cheaper and more
  correct than changing that direction, or than exporting route-file internals purely
  for one new component's benefit.
- **PropertyCard's trust signals are a client-side approximation, not a per-card
  `/trust` fetch.** A search-results grid can render dozens of cards; calling
  `GET /properties/{id}/trust` once per card would mean dozens of extra requests just
  to decorate a list, which the prompt's own "keep minimal" instruction argues
  against. `estimateCompletenessPercent()` (in `PropertyCard.tsx`) is a documented,
  clearly-commented **approximation** — base 60% (the fields every saved listing
  already has: title/district/city/price/bedrooms/bathrooms) plus up to 40% scaled by
  how many of six already-available "extra detail" fields (`description`, `furnished`,
  `livingRooms`, `propertyAgeYears`, `deedArea`, `licenseNumber`) are present on the
  already-mapped `Property` object — never a network call, never LLM-based, and
  explicitly NOT the authoritative score (that's `PropertyTrustSheet`'s real
  `/trust`-backed Listing Confidence section). `isRecentlyUpdated()` mirrors
  `trust_config.py`'s `FRESHNESS_RECENTLY_UPDATED_DAYS = 14` threshold client-side
  against the already-loaded `updatedAt` field, same "no extra fetch" reasoning.
- **PropertyCard shows at most 2 trust chips, chosen contextually rather than always
  showing all 3 example signals from the prompt.** Verified listings show
  `"✓ Verified by myMakan"` (leading) + `"Recently Updated"` (if applicable);
  unverified listings show the completeness estimate instead of the verified chip
  (so the row is never empty) + `"Recently Updated"` (if applicable). The pre-existing
  `RecommendationBadge` "Verified" pill already shown in the card's image overlay
  (computed from the same underlying `mediator_is_verified` flag, added before this
  feature) was left untouched — this prompt's new bottom-row chip uses the legally
  exact phrase the global constraint requires, which the pre-existing generic
  "Verified" pill does not, so the two are deliberately not treated as fully
  redundant.
- **`PropertyTrustSection` is inserted directly after `<Summary>` and before
  `<IntelligenceHero>`** on Property Detail — trust/verification is judged the more
  foundational "can I trust this listing at all" question, positioned ahead of
  myMakan Intelligence's "is this a good deal" scoring, both immediately below the
  property's core facts.
- **No duplicate-check or report-submission UI wired up in this prompt** — both
  client functions exist in `maskan.ts` (see above) but are intentionally unused by
  any component here, per the prompt's own scope (`GET /duplicate-check` is Prompt
  8's partner-flow concern; `POST /reports` needs Prompt 9's actual modal before it
  has anywhere to submit from).

### Verification

- `npm run typecheck` (`tsc --noEmit`) — clean, no errors.
- `npx eslint` on every new/changed file (`PropertyTrustCenter.tsx`,
  `VerificationBlock.tsx`, `PropertyCard.tsx`, `property.$id.tsx`, `maskan.ts`,
  `en.ts`, `ar.ts`) — zero errors on the first three (new files); `property.$id.tsx`
  and `maskan.ts` show pre-existing CRLF/prettier line-ending violations across
  thousands of unrelated lines — confirmed via `git stash` (reverting to HEAD and
  re-running eslint against the pre-existing committed content) that this line-ending
  mismatch **predates this prompt's changes** across the whole repo on this Windows
  checkout, not something introduced here.
- `npm run build` (full TanStack Start production build, SSR + client bundles) —
  succeeded with no errors, including a `property._id-*.mjs` server bundle that
  contains the new Trust Center code, confirming the new components bundle/tree-shake
  correctly end-to-end, not just typecheck-clean in isolation.
- **Not verified:** a live dev-server render against a running backend (no backend/DB
  was started in this session) — so the Trust Center's actual on-screen appearance
  in both English and Arabic (RTL layout, real API responses) was not visually
  inspected. RTL correctness relies on this file reusing only the same Tailwind
  utility classes (`flex`, `gap-*`, `text-*`, no hardcoded `left`/`right`/`ms/me`
  misuse beyond patterns already proven elsewhere on this page) already exercised by
  `DecisionSheet`/`IntelligenceHero`/`LandlordCard`, which do render correctly in
  Arabic today.

### Known limitations / open items for later prompts

- **Deterministic free-text (`positive_signals`, `missing_information`,
  `things_to_verify`, component `reason` strings) is English-only** even in the
  Arabic locale — no `language` parameter exists on `GET /trust` to request
  localized sentences (only `GET /trust-summary`'s AI text is localized). Matches the
  pre-existing behavior of Property Intelligence's `strengths`/`considerations`/
  `things_to_verify` on this same page; would need a backend change (Prompt 12 or a
  future prompt) to fully localize.
- **PropertyCard's completeness percentage is an approximation**, not the real Trust
  Model score — see "Judgment calls" above. If a future prompt decides list cards
  need the authoritative score, that requires either accepting a per-card `/trust`
  fetch cost or a new bulk/batched trust-summary endpoint that doesn't exist today —
  not built here since it wasn't required by this prompt's "keep minimal" instruction.
- **"Report a Concern" is a non-functional stub** (disabled button) — Prompt 9 owns
  building the actual modal, and is expected to wire it into `PropertyTrustSheet`'s
  existing button rather than adding a second trigger.
- **Not visually verified against a running dev server / real backend** in this
  session — see "Verification" above. A future prompt (Prompt 12's demo-verification
  pass) should click through both locales against live data before the investor demo.

## Prompt 8 — Web: Partner listing quality assistant + duplicate warning UI

**Scope actually touched:** `frontend/src/routes/partner.tsx` (extended — no new
route file; see "Locating the create/edit form" below), `frontend/src/lib/api/
maskan.ts` (extended — 3 new API functions + types for Prompt 3's partner-quality
endpoints), `frontend/src/lib/i18n/en.ts` + `ar.ts` (extended — new
`partnerDashboard.listingForm.quality.*` and `partnerDashboard.listingForm.
duplicateWarning.*` keys). No customer/admin/mobile files touched — correctly out
of scope per the prompt.

### Locating the create/edit form

The prompt flagged that the partner property create/edit form "wasn't found by
name in the initial scan" and asked to identify it before editing. It isn't a
separate route — `PartnerListingForm` is a component defined directly inside
`frontend/src/routes/partner.tsx` (around what was line 1047 before this prompt),
rendered by `PartnerDashboard`'s `view === "properties"` branch when
`listingFormOpen || editingListing` is true (toggled by "Add listing" / the
per-row edit pencil in `PartnerListingsView`). `git log` for `partner.tsx`
confirms the file's own recent history (`cef12ff "Add Rent/Sale selector to
admin create/edit listing form"`) already refers to this exact component as
"the partner portal's PartnerListingForm" when describing the *admin* form that
mirrors it — confirming there's no separate, more-specific "partner listing
form" file anywhere else in the repo. `partner.register.tsx` (mediator
onboarding) and `partner.requests*.tsx` (the property-request marketplace,
unrelated to listing CRUD) are both different features entirely.

`partner.tsx` is already a large, monolithic route file that defines many
view-level sub-components directly in itself (`PartnerListingsView`,
`PartnerOverviewView`, `PartnerMessagesView`, `PartnerProfileView`,
`PartnerReviewsView`, `PartnerProjectForm`, etc.) rather than splitting them into
`components/maskan/*.tsx` files — unlike `property.$id.tsx`, which is why Prompt
7 introduced new files (`PropertyTrustCenter.tsx`, `VerificationBlock.tsx`) for
its UI. This prompt's three new components (`PartnerListingQualityPanel`,
`ImageQualityNotes`, `DuplicateWarningModal`) follow `partner.tsx`'s own existing
convention instead — defined directly in the route file, right after
`PartnerListingForm` — for consistency with the file they're extending, not
Prompt 7's file-splitting choice for a differently-structured route.

### What was built

- **Listing Quality panel** (`PartnerListingQualityPanel`, rendered full-width
  between the form's header and its two-column field grid): a completeness
  `ScoreBar`, missing-field suggestions, a Confirm Availability control, and an
  "Improve with AI" flow — all backed by Prompt 3's
  `GET /partner/properties/{id}/quality` once the listing has been saved at
  least once (`editing` truthy). Fetched once on mount (`useEffect` keyed on
  `editing`) and re-fetched after every successful save, so the score reflects
  the just-persisted state.
  - **"Improve with AI"** calls `POST /partner/properties/{id}/improve-with-ai`
    for `focus: "title"` or `"description"` (two separate buttons, matching the
    backend's per-focus response shape where the non-requested field is
    `null`), shows the returned suggestion in a card with **Apply** / **Dismiss**
    — `applyAiSuggestion()` only writes into local `form` state (`setForm`),
    never calls any save/patch endpoint itself. The suggestion is discarded
    until the partner presses the form's own, pre-existing Save button, which
    is the only code path that ever persists it — this satisfies the global
    "AI suggestions must never be auto-saved" constraint by construction: there
    is no function in this prompt's code that both receives an AI suggestion
    and calls a network-writing endpoint in the same path.
  - **Confirm Availability** calls `POST /partner/properties/{id}/confirm-
    availability` and merges the returned `availability_confirmed_at` straight
    into local `quality` state (no full refetch needed for this one field).
- **Duplicate warning** (`DuplicateWarningModal`): after a successful save
  (create or edit), calls Prompt 2's `GET /properties/{id}/duplicate-check`
  (already exported by Prompt 7 as `fetchDuplicateCheck`, unused until now) with
  the just-saved property's id. If `is_possible_duplicate`, shows a modal — "This
  listing may already exist", up to 3 matched listings with their match
  reasons, a **Compare listing** link (opens the top match's public
  `/property/{id}` page in a new tab) and a **Continue anyway** button — before
  closing the form. See "Post-save duplicate check" below for why this runs
  after save rather than before.
- **Image quality suggestions** (`ImageQualityNotes`, rendered directly under
  the photo thumbnails/URL-input area): in edit mode, renders Prompt 3's real
  `image_quality.issues` messages from the already-fetched `quality`; for a
  not-yet-saved draft, mirrors the same no-computer-vision "no photos yet" /
  "add at least 3 photos" checks client-side against the in-progress `media`
  array (duplicate-URL / missing-primary-image / low-resolution checks are
  skipped client-side — the latter two are inert server-side today too, per
  Prompt 3's own known limitations).

### `maskan.ts` additions

Three new functions + their types, inserted right after `patchPartnerListing`
(the existing partner-listing CRUD calls) rather than in the "Trust Center"
block further down the file — these are partner-scoped, not the public/customer
Trust Center endpoints Prompt 7 already grouped together:

- `fetchPartnerListingQuality(propertyId)` → `GET /partner/properties/{id}/
  quality` → `ApiPartnerListingQuality`. Its `completeness` field reuses the
  exact same `ApiTrustCompleteness` type Prompt 7 already defined for the
  customer Trust Center — both wrap the identical backend
  `compute_listing_completeness` result, so reusing the type (rather than
  redefining an identical shape) keeps that agreement visible in the frontend
  types too, not just on the backend.
- `confirmPartnerListingAvailability(propertyId)` → `POST .../confirm-
  availability` → `ApiPartnerAvailabilityConfirm`.
- `improvePartnerListingWithAi(propertyId, {focus, language})` → `POST .../
  improve-with-ai` → `ApiPartnerImproveWithAi`. Mirrors
  `schemas/partner_quality.py::PartnerImproveWithAiOut` field-for-field,
  including the `note` field (a fixed reassurance string the backend always
  sends: "This is a suggestion only... nothing has been changed yet") — not
  currently rendered by the panel (the Apply/Dismiss buttons already make that
  explicit), kept in the type for parity with the backend response rather than
  silently dropped.

### Judgment calls

- **Client-side completeness estimate for a not-yet-saved listing**
  (`estimateFormCompleteness`, module-level in `partner.tsx`). Prompt 3's
  `/quality` endpoint reads a persisted `Property` row — there is no
  draft/unsaved-listing entry point (documented as a known limitation in that
  prompt), and this prompt's own form saves via a single "Submit for approval"
  action rather than an autosave-per-field flow. Rather than hiding the
  Listing Quality panel entirely until the first save (which would mean the
  prompt's own "live completeness % that updates as fields are filled"
  requirement literally cannot be satisfied for a brand-new listing), this
  mirrors `PropertyCard.tsx`'s already-established precedent from Prompt 7
  (`estimateCompletenessPercent`): a clearly-labeled, clearly-commented client
  approximation using the same required/important/optional tier weights as
  `trust_config.py::COMPLETENESS_TIER_WEIGHTS` (3/2/1), limited to only the
  fields this form actually collects (map coordinates, living rooms, property
  age, deed area, and license number aren't editable in this form, so they're
  excluded rather than counted as permanently missing). It updates on every
  keystroke (pure function of local `form`/`media` state, recomputed each
  render) and is visually labeled "Estimated — save to see full details" so
  it's never confused with the authoritative backend score, which replaces it
  the moment `quality` loads in edit mode.
- **Post-save duplicate check, not pre-save.** Prompt 2's own known
  limitations already flagged that `GET /duplicate-check` "only works against
  an existing property ID, not draft/unsaved-listing fields" and explicitly
  deferred the UX decision to whichever of Prompt 3/8 needed it. Since this
  form's publish action always creates/patches the row first (there's no
  separate "check, then create" step in the existing save flow, and adding one
  would mean either a second draft-shaped backend entry point that doesn't
  exist or creating-then-possibly-deleting a row, neither of which this prompt
  invents), the check runs immediately after `onSave()` resolves, using the
  now-real property id, and before the form closes. Nothing is ever blocked by
  it — the property is already saved (still subject to admin approval like
  every other new/edited listing) regardless of the check's outcome; a flagged
  result only adds an extra "here's what we found, compare or continue" step
  before the form closes, and a failed duplicate-check call (network error,
  etc.) is swallowed silently so it can never prevent the already-successful
  save from completing.
- **`onSave` now returns the saved `ApiProperty` instead of `void`.** Both the
  duplicate check and the post-save quality refresh need the saved property's
  id, which the old `void`-returning contract didn't expose to the form. Its
  single call site (`PartnerDashboard`'s `handleSaveListing`, itself changed to
  `return saved` instead of closing the form itself) was simplified to `onSave={
  (payload, imageUrls) => handleSaveListing(payload, imageUrls,
  editingListing?.id)}` — closing the form (`setListingFormOpen(false)` /
  `setEditingListing(null)`) is now solely `PartnerListingForm`'s own
  responsibility via the existing `onClose` prop, called either immediately
  (no duplicate flagged) or after the partner dismisses the duplicate warning
  modal, rather than unconditionally right after save as it was before.
- **Confirm Availability and Improve with AI are hidden behind an explanatory
  note, not disabled buttons, for a new listing.** Since there's no id to call
  either endpoint against yet, showing greyed-out buttons with a tooltip (the
  pattern the pre-existing edit-lock icon in `PartnerListingsView` uses) would
  invite a click that can't do anything; a single sentence
  ("Save this listing to confirm availability and get AI wording suggestions.")
  in the same panel location the real controls occupy in edit mode was judged
  clearer than a disabled control users could still try to click.
- **`ApiPartnerImproveWithAi`'s `focus` request always sends one of
  `"title"`/`"description"`**, never `"both"` (the backend's default), because
  the panel offers two separate buttons rather than one combined action — this
  matches Prompt 3's own reasoning for adding `focus` to the request in the
  first place ("both fields being independently useful... so the caller can
  tell 'not requested' apart from 'AI suggested no change'"), applied at the UI
  layer: a partner who only wants a better title shouldn't have to review (and
  risk accidentally discarding) an unrequested description rewrite in the same
  suggestion card.
- **The duplicate-warning modal is a small hand-rolled overlay local to
  `partner.tsx`** (fixed-position backdrop, `stopPropagation` on the inner
  panel, an `Escape`-key handler), not a new shared modal primitive — mirrors
  the same lightweight pattern Prompt 7's `PropertyTrustSheet` already used in
  `PropertyTrustCenter.tsx` for the identical reason (this codebase's `Sheet`
  primitive in `components/ui/sheet.tsx` wasn't reused there either), rather
  than introducing a third modal pattern.
- **"Compare listing" links to the public `/property/{id}` detail page** (the
  same route Prompt 7 built), opened in a new tab, rather than a partner-portal-
  internal comparison view — no such internal view exists, and the public page
  already shows everything relevant (title, price, area) for the partner to
  visually judge whether it's really the same listing, without this prompt
  needing to build a second property-preview component.

### Verification

- `npm run typecheck` (`tsc --noEmit`) — clean, no errors.
- `npx eslint` on the changed files (`partner.tsx`, `maskan.ts`, `en.ts`,
  `ar.ts`) — zero non-`prettier/prettier` errors; the `prettier/prettier`
  (CRLF line-ending) errors reported are the same pre-existing, repo-wide
  Windows-checkout issue Prompt 7 already documented and confirmed (via
  `git stash`) predates that prompt's changes — reconfirmed here the same way:
  stashing this prompt's changes and re-running eslint against the prior
  committed content still reports thousands of the identical `prettier/prettier`
  errors across unrelated lines in the same files.
- `npm run build` (full TanStack Start production build, SSR + client bundles)
  — succeeded with no errors, including a `partner-*.mjs` server bundle
  (116.85 kB) that contains this prompt's new components, confirming they
  bundle/tree-shake correctly end-to-end.
- **Not verified:** a live dev-server render against a running backend (no
  backend/DB was started in this session), so the panel's actual on-screen
  appearance, the live Improve-with-AI/Confirm-Availability round trip, and the
  duplicate-warning modal's real-data appearance were not visually inspected in
  either locale. Same limitation Prompt 7 already flagged for its own UI.

### Known limitations / open items for later prompts

- **Not visually verified against a running dev server / real backend** — see
  "Verification" above.
- **The client-side completeness estimate can disagree with the real score**
  once the listing is saved (e.g. a saved listing might have map coordinates
  or living-room count set from a prior admin edit that this form doesn't
  collect, which the estimate can never account for either way) — documented,
  intentional, and disclosed in the UI copy itself ("Estimated — save to see
  full details"), same trade-off Prompt 7 already accepted for
  `PropertyCard.tsx`'s estimate.
- **Duplicate check only ever runs after save**, never as a live "as you type"
  warning before the partner submits — a consequence of Prompt 2's endpoint
  requiring a saved property id (see "Judgment calls" above). If a future
  prompt adds a draft-shaped duplicate-check entry point, this form could move
  the check earlier.
- **No draft/autosave step introduced** — this prompt did not change the
  form's existing single-action "Submit for approval" / "Save & resubmit" save
  model into a multi-step create-then-refine flow, so a partner filling out a
  brand-new listing only gets the authoritative Listing Quality panel, real
  image-quality signals, Confirm Availability, and Improve with AI after their
  first save — consistent with Prompt 3's own documented expectation that "a
  later prompt's UX will need to decide its own autosave-before-AI-assist
  flow," resolved here by not requiring one.

## Prompt 9 — Web: Mediator trust profile + review summary + report listing modal

**Scope actually touched:** `frontend/src/routes/agent.$id.tsx` (extended — two
new sections, `MediatorTrustSection` + `ReviewSummarySection`, plus their
imports — no existing code removed), `frontend/src/components/maskan/
PropertyTrustCenter.tsx` (extended — the Prompt 7 stub "Report a Concern"
button now opens the new modal; `propertyId` threaded down to
`PropertyTrustSheet`), `frontend/src/components/maskan/VerificationBlock.tsx`
(extended — new opt-in `showExplainer` prop), `frontend/src/components/
maskan/ReportListingModal.tsx` (new), `frontend/src/lib/api/maskan.ts`
(extended — `ApiPartnerPublic` gained Prompt 4's Trust & Activity fields, plus
a new `ApiMediatorAiReviewSummary` type + `fetchMediatorAiReviewSummary()`),
`frontend/src/lib/i18n/en.ts` + `ar.ts` (extended — `verification.
explainerTitle`, `agent.trust.*`, `agent.reviewSummary.*`, and
`property.trust.sheet.reportConcern.*` filled in beyond Prompt 7's stub
`cta`/`comingSoon` pair). No admin/mobile files touched — correctly out of
scope per the prompt.

### What was built

- **Mediator "Trust & Activity" section** (`MediatorTrustSection`, new sidebar
  card in `agent.$id.tsx`, inserted between the existing profile card and the
  Contact card) — sourced entirely from `GET /mediators/{id}/public`'s Prompt
  4 extension (`ApiPartnerPublic`'s new fields), not re-derived or
  re-fetched from anywhere else on the page:
  - **Verification badge** — `VerificationBlock` (Prompt 7's component,
    reused as-is) with a single `"mymakan"` provider row driven by
    `partner.verification_label` (the exact `"✓ Verified by myMakan"` string
    or `null` — never composed/guessed here).
  - **Rating + review count** — `partner.avg_rating`/`review_count` (the
    Prompt-4-extended `/public` values, computed from approved reviews only),
    shown with the same `StarDisplay` component the page's pre-existing
    profile-card hero already uses, or a "No rating yet" line when null.
  - **Listing counts** — `partner.rental_listing_count`/`sale_listing_count`
    (`"{{rental}} for rent · {{sale}} for sale"`) — the rent/sale split Prompt
    4 added; the pre-existing hero only ever showed a single combined
    `listings.length` count with no split.
  - **Areas covered** — `partner.areas.length` (already-loaded data, no new
    fetch).
  - **Member since** — `partner.member_since ?? partner.created_at` (falls
    back to the pre-existing field for safety, though both carry the
    identical value per Prompt 4's backend doc) through the file's existing
    `memberSince()` date-formatting helper.
  - **Response info** (bonus, beyond the prompt's literal field list, but
    already available on `ApiPartnerPublic` and directly relevant to trust) —
    `partner.response_rate`/`avg_response_time_hours`, rendered as one
    combined sentence when both are present, rate-only when only that is,
    or "No response data yet" when the mediator has no lead assignments —
    mirrors the backend's own null-handling exactly, no client-side guessing.
  - **"What does myMakan Verified mean?" explainer** — see `VerificationBlock`
    judgment call below; explicit that this is **not** a government/REGA/
    Ejar/Nafath verification, satisfying the global constraint's requirement
    that this exact page carry that disclaimer.
- **Review Summary block** (`ReviewSummarySection`, new card in the main
  column, inserted between the Listings grid and the pre-existing
  `ReviewsSection`) — fetches Prompt 4's `GET /mediators/{id}/review-summary`
  independently on mount/language change (own loading state, `return null` on
  a failed call or zero reviews — never blocks or errors the rest of the
  page, the same contract `PropertyTrustSection` established in Prompt 7).
  Always shows the deterministic `avg_rating`/`review_count` header first
  (via the same `StarDisplay` helper), then either:
  - `generated_by === "ai"` — a visible `Badge tone="ai"` reading **"AI
    Summary"** (never rendered without the label, satisfying the global "AI
    content must be visibly labeled" constraint) plus a two-column
    positive-themes / considerations list (✓ green / ⚠ amber icons, mirroring
    `PropertyTrustSheet`'s existing icon language for the same
    positive-vs-needs-attention distinction).
  - `generated_by === "fallback"` — the backend's own free-text `note`
    (e.g. "Not enough reviews yet for an AI summary…") rendered as-is,
    following the exact "un-localized deterministic backend text, rendered
    raw in both locales" precedent Prompt 7 already documented and accepted
    for `/trust`'s `positive_signals`/`things_to_verify` — this endpoint's
    `note` field has the identical shape (server-composed English sentence,
    no `language`-aware variant), so the same known limitation applies here,
    not a new one.
- **Report Listing modal** (`ReportListingModal.tsx`, new file) — wired into
  the Prompt 7 stub: `PropertyTrustSheet`'s "Report a Concern" button is no
  longer `disabled`; it opens this modal, which is rendered as a **sibling**
  of the sheet's backdrop `<div>` (not nested inside it — see judgment calls)
  so the two overlays don't interfere with each other's click-outside-to-close
  handling.
  - **Sign-in gate** — if `useAuth()`'s `user` is null, the modal shows a
    "Sign in … to report a concern about this listing" prompt instead of the
    form, mirroring `agent.$id.tsx`'s own `ReviewsSection` sign-in-prompt
    pattern for the identical "must be authenticated to submit user-generated
    content" situation (same `agent.reviews.signInPrefix` key reused for the
    "Sign in" link text).
  - **Reason list** — radio-button list built directly from `maskan.ts`'s
    `PROPERTY_REPORT_REASONS` (Prompt 7 already exported this, matching
    `app/models/property_report.py`'s exact six values), each row labeled via
    a new `property.trust.sheet.reportConcern.reasons.*` i18n key.
  - **Optional comment** — plain textarea, trimmed to `undefined` (not an
    empty string) before submission, matching `ReviewsSection.handleSubmit`'s
    same `comment.trim() || undefined` pattern for an optional field.
  - **Submit** — calls Prompt 7's already-exported `submitPropertyReport()`.
    On success, replaces the form with a "Report submitted — thanks" state
    (no auto-close, so the confirmation is actually readable; the user closes
    via the header's `X` or `Escape`, same as `PropertyTrustSheet`).
  - **"Already reported" (409) handled gracefully** — every submit failure,
    including the backend's 409 "You already have an open report for this
    reason on this listing." (Prompt 2), is caught and shown as a plain
    amber-toned notice using the backend's own already-user-readable `detail`
    message (`requestJson` already extracts `detail` into `Error.message`) —
    never a raw/technical error box, never a silent failure. The modal
    doesn't attempt to distinguish 409 from other failure statuses by status
    code (the shared `requestJson` helper doesn't surface the HTTP status to
    callers, only the message) — every backend `detail` string already reads
    as a complete, presentable sentence (404/422/409 alike), so rendering it
    verbatim in a non-alarming notice satisfies "handles the already-reported
    case gracefully" without needing a special-cased branch.

### `maskan.ts` additions

- **`ApiPartnerPublic` extended** with Prompt 4's nine new `MediatorPublicOut`
  fields (`verification_label`, `avg_rating`, `review_count`,
  `active_listing_count`, `rental_listing_count`, `sale_listing_count`,
  `member_since`, `response_rate`, `avg_response_time_hours`) — field-for-field
  match, including nullability. `active_listing_count` is fetched but not
  displayed anywhere in this prompt's UI (the sidebar already shows
  `listings.length`, the real Published count for *this* profile fetch; the
  backend's `active_listing_count` is redundant with it for the single-profile
  page, so showing the rent/sale *split* instead — new information the old
  hero didn't have — was judged more useful than a third redundant total).
- **`ApiMediatorAiReviewSummary` + `fetchMediatorAiReviewSummary()`** (new) —
  deliberately a different type/function name from the pre-existing
  `ApiReviewSummary`/`fetchMediatorReviewSummary()` (Prompt 4's rating-
  distribution aggregate from `GET /reviews/mediator/{id}/summary`, already
  consumed by the page's pre-existing hero + `DistributionBars`) to avoid a
  naming collision with a same-shaped-sounding but functionally different
  endpoint (`GET /mediators/{id}/review-summary`, this prompt's AI text
  summary). Mirrors `schemas/review_summary.py::ReviewSummaryOut` field-for-
  field.

### i18n additions

- **`verification.explainerTitle`** (new, top-level `verification` namespace)
  — "What does myMakan Verified mean?" — paired with the pre-existing
  `verification.explainer` body text Prompt 7 already wrote (and left unused
  until now) for exactly this purpose.
- **`agent.trust.*`** (new, inside the existing `agent` namespace) — `heading`,
  `ratingNone`, `listingsBreakdown`, `areasCovered`, `memberSince`,
  `responseRateOnly`, `responseRateAndTime`, `noResponseData`.
- **`agent.reviewSummary.*`** (new) — `heading`, `aiLabel`, `loading`,
  `positiveThemes`, `considerations`.
- **`property.trust.sheet.reportConcern.*`** — Prompt 7 had only stubbed `cta`
  + `comingSoon`; this prompt removes the now-dead `comingSoon` key (the
  button is no longer disabled, so its tooltip text has no call site left)
  and adds `title`, `subtitle`, `reasonLabel`, `reasons.*` (six keys, one per
  `PROPERTY_REPORT_REASONS` value), `commentLabel`, `commentPlaceholder`,
  `submit`, `submitting`, `signInRequired`, `successTitle`, `successDesc`,
  `genericError`.
- Both `en.ts`/`ar.ts` extended with the identical key structure — verified
  via `npm run typecheck` (which type-checks `ar.ts` against `TranslationDict
  = DeepStringify<typeof en>`, so a missing/extra key is a compile error).

### Judgment calls

- **`VerificationBlock` gained an opt-in `showExplainer` prop rather than a
  second, mediator-profile-specific explainer component.** The prompt's own
  scope note (Prompt 7's doc) already flagged "Prompt 9's mediator profile
  page is expected to reuse this same component" — extending it with one
  optional prop (default `false`, so Prompt 7's existing call site in
  `PropertyTrustSheet` renders byte-identical to before) keeps the "What does
  myMakan Verified mean?" copy in exactly one place rather than duplicating a
  verification-status row plus a separate explainer block. Built with the
  existing `Popover`/`PopoverTrigger`/`PopoverContent` primitives
  (`components/ui/popover.tsx`) already used elsewhere on `property.$id.tsx`
  for an unrelated date-range picker — no new dialog/tooltip primitive
  introduced for this one explainer.
- **Report modal rendered as a JSX sibling of the trust sheet's backdrop
  `<div>`, not nested inside it.** An early draft nested
  `{showReportModal && <ReportListingModal .../>}` as the last child inside
  `PropertyTrustSheet`'s outer `fixed inset-0 ... onClick={onClose}` backdrop
  div. That would have meant a click on the *report modal's own* backdrop
  (itself a full-screen overlay) bubbles up through the DOM to the trust
  sheet's outer div, firing the trust sheet's `onClose` too — closing both
  modals from what should be a "close only the top one" click. Restructured
  `PropertyTrustSheet` to return a fragment (`<>...</>`) with the backdrop
  div and the conditionally-rendered `ReportListingModal` as two separate
  top-level children, and gave the report modal a higher `z-[60]` than the
  sheet's `z-50` — a click on the report modal's backdrop now only reaches
  its own `onClose`, leaving the trust sheet open underneath exactly as
  before.
- **The report modal is a new hand-rolled fixed-overlay component, matching
  `PropertyTrustSheet`'s/`DecisionSheet`'s established pattern** (same
  backdrop/blur classes, same `Escape`-key `useEffect`, same
  `stopPropagation` on the inner panel) rather than a third modal
  implementation or the unused shadcn `Sheet`/`Dialog` primitives — same
  reasoning Prompt 7 and Prompt 8 each already gave for their own modals in
  this codebase.
- **409 "already reported" is not specially detected by status code** — see
  "What was built" above. `requestJson` (in `maskan.ts`) already discards the
  HTTP status once it extracts `detail` into a thrown `Error`'s `message`, so
  distinguishing 409 from 404/422 client-side would require either changing
  `requestJson`'s shared error contract (used by every other API call in the
  file) or a fragile string-match against the exact backend sentence. Since
  every `detail` this endpoint can return (`"Property not found"`, a 422
  validation message, or the 409 duplicate-report sentence) already reads as
  a complete, non-technical sentence, rendering whichever one comes back
  verbatim in the same neutral notice satisfies "handle the already-reported
  case gracefully" without adding that coupling.
- **`MediatorTrustSection` is an additional dedicated card, not a rewrite of
  the pre-existing profile-card hero.** The two visually overlap in places
  (both show a rating; the hero's `listings.length` and this card's rental/
  sale split both describe "how many listings") — accepted deliberately: the
  prompt's own scope says "extend it, do not create a new one" for the page
  as a whole, but doesn't ask to redesign the pre-existing hero the page
  already had before this feature, and the hero predates Prompt 9 by design
  (it's the page's core identity header, unrelated to the Trust Center
  feature). This card's job is specifically to surface Prompt 4's *new*
  backend fields (`verification_label`'s exact phrase, the rent/sale listing
  split, response info, the explainer) as one Trust-Center-branded unit,
  which the hero doesn't and shouldn't need to absorb.
- **Response rate/time shown even though the prompt's literal field list for
  this section was "verification badge, rating, review count, listing
  counts, areas covered, member-since."** `response_rate`/
  `avg_response_time_hours` are already on `ApiPartnerPublic` (Prompt 4 added
  them as part of the same "Trust & Activity" field group, spec section 11's
  "response info if available") and directly support the same
  trust-building purpose as the other fields — omitting data the backend
  already computes and exposes for exactly this section would be a stranger
  reading of "extend the page" than including it, so it was added as a
  secondary/muted line rather than treated as out of scope.
- **`ReviewSummarySection` returns `null` when `review_count === 0`**, even
  though the endpoint still returns a valid fallback result at zero reviews
  (`note: "Not enough reviews yet..."`). The page's pre-existing hero already
  shows "No reviews yet" in that exact case; rendering a second, near-empty
  "Review Summary" card immediately below the Listings grid for a
  brand-new mediator with no reviews at all was judged redundant noise
  rather than useful content — the card only appears once there's at least
  one review to summarize (even below the AI threshold, where it then shows
  the deterministic rating + fallback note).

### Verification

- `npm run typecheck` (`tsc --noEmit`) — clean, no errors.
- `npx eslint` on every new/changed file (`agent.$id.tsx`,
  `PropertyTrustCenter.tsx`, `VerificationBlock.tsx`, `ReportListingModal.tsx`,
  `maskan.ts`, `en.ts`, `ar.ts`) — zero non-`prettier/prettier` errors (one
  pre-existing `react-hooks/exhaustive-deps` warning on `agent.$id.tsx` line
  409, inside the untouched pre-existing `ReviewsSection.loadReviews` effect —
  predates this prompt). Two genuine (non-CRLF) prettier formatting issues in
  this prompt's own new code (`ReportListingModal.tsx`'s import block,
  `VerificationBlock.tsx`'s new popover JSX) were caught and fixed via
  `eslint --fix`; a full re-run after the fix confirms zero errors on both
  files. Every other `prettier/prettier` (CRLF line-ending) error reported
  across `agent.$id.tsx`/`maskan.ts`/`en.ts`/`ar.ts` is the same pre-existing,
  repo-wide Windows-checkout issue Prompts 7-8 already documented and
  confirmed predates their changes.
- `npm run build` (full TanStack Start production build, SSR + client
  bundles) — succeeded (exit 0), producing `agent._id-*.mjs` (37.27 kB) and
  `VerificationBlock-*.mjs` (3.53 kB) server bundles that include this
  prompt's new code, confirming it bundles/tree-shakes correctly end-to-end.
  The build log's `"use client" directive ... was ignored` warnings are
  pre-existing third-party-package noise (React Router/React Query/Radix ESM
  builds), unrelated to this prompt's changes.
- **Not verified:** a live dev-server render against a running backend (no
  backend/DB was started in this session) — so the Trust & Activity card,
  Review Summary card, and Report Listing modal's actual on-screen appearance
  in both English and Arabic (RTL layout, real API responses, the Popover's
  actual positioning) was not visually inspected. Same limitation Prompts 7-8
  already flagged for their own UI, for the same reason.

### Known limitations / open items for later prompts

- **Not visually verified against a running dev server / real backend** in
  this session — see "Verification" above. A future prompt (Prompt 12's demo-
  verification pass) should click through `/agent/{id}` in both locales
  against live data, including triggering the report modal's sign-in prompt,
  success state, and a real 409 (submit the same reason twice) before the
  investor demo.
- **Deterministic free text is still English-only in the Arabic locale** —
  `ReviewSummaryResult.note` (this prompt) has the identical un-localized-
  backend-string limitation Prompt 7 already documented for `/trust`'s
  `positive_signals`/`things_to_verify`; not a new gap, just a second
  instance of the same one.
- **`MediatorTrustSection`'s rating/review-count and the pre-existing hero's
  rating/review-count are two independent fetches** (`/public` vs.
  `/reviews/mediator/{id}/summary`) that should always agree (both aggregate
  from approved reviews the same way) but aren't literally the same network
  response — a future consolidation could have the hero read from the single
  `/public` call this prompt already makes instead of its own separate
  `fetchMediatorReviewSummary` call, saving one request per profile page
  load; not done here since the prompt's scope was additive ("extend the
  page"), not a refactor of code Prompt 9 didn't touch.
- **Report Listing modal has no rate-limiting/spam guard beyond the backend's
  one-active-report-per-reason rule** — a signed-in user can still file one
  report per reason (six total) against the same listing; no client-side
  throttling was added beyond what Prompt 2's backend already enforces, since
  building additional abuse protection wasn't in this prompt's scope.

## Prompt 10 — Mobile: Customer Trust Center + report + mediator trust parity

**Scope actually touched:** `mobile/src/components/PropertyTrustBadge.tsx`
(new — `PropertyTrustSection` + `TrustDetailsSheet`),
`mobile/src/components/ListingVerificationBlock.tsx` (new — generic reusable
component), `mobile/src/components/ReportListingSheet.tsx` (new),
`mobile/src/lib/api/maskan.ts` (extended — Trust Center types/functions
mirroring Prompts 2/5, `ApiPartnerPublic` gained Prompt 4's Trust & Activity
fields, plus `ApiMediatorAiReviewSummary`/`fetchMediatorAiReviewSummary`),
`mobile/src/lib/i18n/en.ts` + `ar.ts` (extended — new `listingVerification.*`
top-level namespace, `propertyCard.trust.*`, `property.trust.*`,
`agent.trust.*`, `agent.reviewSummary.*`), `mobile/app/property/[id].tsx`
(extended — one new import + one new component insertion, no existing code
changed), `mobile/src/components/PropertyCard.tsx` (extended — small
trust-signal row + two pure helper functions), `mobile/app/agent/[id].tsx`
(extended — new Trust & Activity card + Review Summary section + their
imports/fetch effect, no existing code removed). No web/partner/admin files
touched, no new mobile partner-portal surface added — correctly out of scope
per the prompt.

Treated `frontend/src/components/maskan/PropertyTrustCenter.tsx`,
`VerificationBlock.tsx`, `ReportListingModal.tsx`, and
`frontend/src/routes/agent.$id.tsx`'s Prompt 9 sections as the reference
implementation throughout — this prompt mirrors their behavior and copy
(async/non-blocking loading order, exact verification wording, the same
i18n key *shapes* where mobile has no pre-existing collision) rather than
their pixel layout, which is expected to differ given web's fixed-overlay
sheets vs. mobile's native `BottomSheet`.

### The TrustBadge naming collision — how it was avoided

Per the "Naming collision warning" in `mymakan-trust-center-prompts.md`,
`mobile/src/components/TrustBadge.tsx` (`TrustBadgeChip`/`TrustBadgeCard`,
`computeTrustScore`/`ApiTrustMetrics`) already existed before this prompt and
is a **completely different concept**: the renter's own identity-verification
trust score (mock-Nafath flow via `mobile/app/verification.tsx`), shown on
the renter's own profile. This prompt's listing/mediator trust is unrelated.
`TrustBadge.tsx` was **not opened, imported, or modified** by this prompt.
Distinct names were chosen at every layer that could otherwise have
collided:

- **Component name:** `PropertyTrustBadge.tsx` (exporting
  `PropertyTrustSection`), not `TrustBadge.tsx` — matches the prompt's own
  suggested name.
- **Verification block name:** `ListingVerificationBlock.tsx`, not
  `VerificationBlock.tsx` (kept distinct even though there's no existing
  mobile file by that name, for symmetry with the i18n choice below and to
  make "this is about a listing, not a person" explicit in the filename).
- **i18n namespace:** mobile already had a top-level `verification.*` key
  namespace (identity verification: `heading`, `intro`, `documentLabel`,
  `status.*`, etc. — all renter-identity copy) and a `trustBadge.*` namespace
  (the renter's trust-score tiers/breakdown labels) **before this prompt**.
  Reusing either for the Trust Center's generic verification-row copy
  (`title`, `mymakan`, `verifiedLabel`, `notConnected`, the "What does
  myMakan Verified mean?" explainer) would have mixed two different
  "verification"/"trust" concepts under one key space. This prompt instead
  added a **new** top-level `listingVerification.*` namespace, with an
  explanatory comment directly above it in both `en.ts`/`ar.ts` pointing back
  at this section. `property.trust.*` (nested under the pre-existing
  `property` namespace) and `agent.trust.*`/`agent.reviewSummary.*` (nested
  under the pre-existing `agent` namespace) had no pre-existing keys at those
  paths, so no renaming was needed there — they mirror web's
  `property.trust.*`/`agent.trust.*`/`agent.reviewSummary.*` key structure
  directly.
- **API client types:** `ApiTrustAssessment`/`ApiTrustCompleteness`/etc.
  (new, Prompt 10) sit alongside the pre-existing `ApiTrustMetrics` (the
  renter identity-verification score's input shape, unrelated, untouched) in
  the same file — the two type families never share a name, mirroring the
  component-name separation above.

### New components

- **`PropertyTrustSection`** (`PropertyTrustBadge.tsx`) — the instant trust
  badge/entry, inserted into `property/[id].tsx` directly before
  `<IntelligenceHero>` (mirrors web's placement right after the property's
  core facts and before myMakan Intelligence's deal-scoring — trust is judged
  the more foundational "can I trust this listing at all" question). Owns two
  independent effects: one fetches `GET /properties/{id}/trust`
  (deterministic — renders the score ring, trust-level badge, and up to 4 top
  signals — positive signals first, `things_to_verify` filling any remaining
  slots — plus a "View Trust Details" pill) and a second, *separately*
  fetches `GET /properties/{id}/trust-summary?language=` (the AI Trust
  Summary) and renders it underneath in its own loading state, so the AI text
  can never delay or block the deterministic score above it — the same
  `fetchPropertyIntelligence`/`fetchPropertyAiSummary` split this same screen
  already uses for Property Intelligence. A failed `/trust` call renders
  nothing (`return null`); a failed `/trust-summary` call simply omits the AI
  paragraph. The "AI Summary" badge only renders when `generated_by ===
  "ai"`.
- **`TrustDetailsSheet`** (same file, not exported) — the full detail sheet,
  opened by "View Trust Details", built on `mobile/src/components/ui/
  BottomSheet.tsx` (this codebase's one dismissible-sheet primitive — same
  choice `DecisionSheet`/`FinancingSheet` already made on this screen) with a
  `ScrollView` inside for the sections, in the same order as the web
  reference: Listing Confidence (completeness `present_fields`/
  `missing_fields` as ✓/hollow-circle rows), Mediator (name + rating/review
  count/listing count from `mediator_trust`, plus `ListingVerificationBlock`
  with exactly one `mymakan` provider row), Listing Freshness (category +
  reason), Price Confidence (reuses the `intelligence` prop already fetched
  by the screen — no second calculation), Things to Verify (plain bullet
  list), and a "Report a Concern" button that opens `ReportListingSheet`.
  Unlike web's Prompt 7/9 split (stub button in 7, wired in 9), mobile builds
  this as one prompt, so Report a Concern is wired directly — no stub state
  needed.
- **`ListingVerificationBlock`** (`ListingVerificationBlock.tsx`) — generic,
  reusable per spec section 21: takes a `providers: {key, name, status,
  label}[]` prop, renders one row per provider, and an opt-in
  `showExplainer` prop that reveals a "What does myMakan Verified mean?"
  panel. Mobile has no Popover primitive (unlike web's
  `components/ui/popover.tsx`), so the explainer is a simple
  toggle-open `Pressable` + conditional `View` instead of a floating
  popover — the native-appropriate equivalent, same information, different
  interaction affordance. Reused as-is by both `TrustDetailsSheet`'s Mediator
  section (no explainer) and `agent/[id].tsx`'s new Trust & Activity card
  (`showExplainer` on).
- **`ReportListingSheet`** (`ReportListingSheet.tsx`) — mirrors
  `ReportListingModal.tsx`'s behavior as a native `BottomSheet`: a sign-in
  gate (reuses the existing `agent.reviews.signInPrefix` "Sign in" link text
  + a new locale-specific suffix, the same two-part pattern
  `agent/[id].tsx`'s own `ReviewsSection` already uses for the identical
  "must be signed in to submit user-generated content" situation), a
  radio-style reason list built from `maskan.ts`'s `PROPERTY_REPORT_REASONS`,
  an optional comment field, and a submit flow that calls
  `submitPropertyReport()`. Every submit failure — including the backend's
  409 "already reported" case — is caught and shown as a plain, non-alarming
  notice using the backend's own `detail` message, exactly mirroring web's
  reasoning for not special-casing 409 by status code (`requestJson` doesn't
  surface the HTTP status to callers, and every `detail` string already
  reads as a complete, presentable sentence).

### `maskan.ts` additions

- **Trust Center types/functions** (`ApiTrustCompleteness`,
  `ApiTrustConsistency(Issue)`, `ApiTrustMediatorTrust`, `ApiTrustFreshness`,
  `ApiTrustMarketplaceConfidence`, `ApiTrustComponentScores`,
  `ApiTrustAssessment`, `fetchPropertyTrust`, `ApiTrustSummary`,
  `fetchPropertyTrustSummary`, `ApiDuplicateMatch`, `ApiDuplicateCheck`,
  `fetchDuplicateCheck`, `PROPERTY_REPORT_REASONS`, `PropertyReportReason`,
  `ApiPropertyReport`, `submitPropertyReport`) — inserted right after
  `fetchPropertyAiSummary`, field-for-field identical to
  `frontend/src/lib/api/maskan.ts`'s Prompt 7 shapes (which themselves mirror
  the backend schemas exactly). `fetchDuplicateCheck` is exported for
  API-surface parity with the web client but is **not called anywhere in
  mobile's UI** — mobile has no partner-portal surface (the prompt's own
  "do not add one" instruction), so there's no draft-listing pre-publish flow
  to wire it into on this platform, same as web Prompt 7's identical
  "exported now, consumed later" note for the same function.
- **`ApiPartnerPublic` extended** with Prompt 4's nine new
  `MediatorPublicOut` fields (`verification_label`, `avg_rating`,
  `review_count`, `active_listing_count`, `rental_listing_count`,
  `sale_listing_count`, `member_since`, `response_rate`,
  `avg_response_time_hours`) — field-for-field match with web's identical
  extension.
- **`ApiMediatorAiReviewSummary` + `fetchMediatorAiReviewSummary()`** (new,
  inserted after `fetchMediatorReviewSummary`) — deliberately a distinct
  name from the pre-existing `ApiReviewSummary`/`fetchMediatorReviewSummary`
  (the deterministic rating-distribution aggregate from `GET
  /reviews/mediator/{id}/summary`, already consumed by this screen's header
  stats), same reasoning web's Prompt 9 already documented for the identical
  naming decision.

### i18n additions

See "The TrustBadge naming collision" above for the namespace-placement
reasoning. Summary of new keys, added to both `en.ts` and `ar.ts` with the
identical structure (mobile's `t()` has no compile-time dictionary check
like web's `DeepStringify<typeof en>`, but both files were kept in lockstep
by hand anyway, per this codebase's existing convention):

- `propertyCard.trust.*` — `verified`, `complete` (`{{percent}}%`),
  `recentlyUpdated`.
- `property.trust.*` — `badge`, `scoreLabel`, `level.*` (4 trust levels),
  `viewDetails`, `aiSummary.{label,loading}`, `sheet.title`,
  `sheet.sections.*` (5 headers), `sheet.completeness.{subtitle,fields.*}`
  (19 field-label keys, one per `trust_config.py::COMPLETENESS_FIELDS`
  entry — identical set to web's `sheet.completeness.fields.*`),
  `sheet.mediator.{listings,noReviewsYet,noMediator}`,
  `sheet.freshness.category.*` (4 categories),
  `sheet.priceConfidence.{subtitle,unavailable}`,
  `sheet.thingsToVerify.empty`, `sheet.reportConcern.*` (`cta`, `title`,
  `subtitle`, `reasonLabel`, `reasons.*` six keys, `commentLabel`,
  `commentPlaceholder`, `submit`, `submitting`, `signInRequired`,
  `successTitle`, `successDesc`, `genericError`) — mobile builds the report
  flow directly (no stub/wire split across two prompts like web), so this
  landed complete in one pass, unlike web's Prompt 7 stub → Prompt 9 fill-in.
- `listingVerification.*` (new top-level namespace) — `title`, `mymakan`,
  `verifiedLabel`, `notVerifiedLabel`, `notConnected`, `explainerTitle`,
  `explainer`.
- `agent.trust.*` (nested under the pre-existing `agent` namespace) —
  `heading`, `ratingNone`, `listingsBreakdown`, `areasCovered`,
  `memberSince`, `responseRateOnly`, `responseRateAndTime`,
  `noResponseData`.
- `agent.reviewSummary.*` — `heading`, `aiLabel`, `loading`,
  `positiveThemes`, `considerations`.

### Judgment calls

- **The exact phrase `"✓ Verified by myMakan"` is never run through
  per-language translation** — identical literal string in both `en.ts` and
  `ar.ts` for both `listingVerification.verifiedLabel` and
  `propertyCard.trust.verified`. Matches web Prompt 7's identical reasoning:
  the backend's own `MEDIATOR_VERIFIED_LABEL` constant is a single hardcoded
  string with no `language` parameter, so this is a fixed brand/legal string,
  not translatable UI copy — still routed through `t()` (not a bare literal
  in the component) to keep a single source of truth per file.
- **Deterministic free-text is English-only even in the Arabic locale** —
  `positive_signals`/`missing_information`/`things_to_verify` and each
  component's `reason` string are deterministic English sentences generated
  server-side with no `language` parameter on `GET /trust`. Rendered as-is in
  both locales, matching the exact precedent this screen's pre-existing
  `AtAGlanceCard` (Property Intelligence) already set for the identical
  situation, and the same known limitation web's Prompt 7 already documented.
  Only `GET /trust-summary`'s AI-generated `summary` and `GET
  /mediators/{id}/review-summary`'s AI text are actually localized.
- **`TrustDetailsSheet`'s Price Confidence section duplicates a small local
  `CLASSIFICATION_KEYS`/`classificationTone`** rather than importing from
  `property/[id].tsx` — that file's own identical helpers are module-private
  (not exported), and components shouldn't import from a route file in this
  codebase's layering. Same "~10-line duplicate is cheaper and more correct"
  judgment call web's Prompt 7 already documented for the identical
  situation, and the same "worst bucket maps to `warning`, no `destructive`
  tone" mapping `property/[id].tsx`'s own `classificationTone()` already
  uses (mobile's `Badge` component has no `destructive` tone).
- **PropertyCard's trust signals are a client-side approximation, not a
  per-card `/trust` fetch** — `estimateCompletenessPercent()`/
  `isRecentlyUpdated()` in `PropertyCard.tsx` mirror web's identical
  approximation formula exactly (base 60% + up to 40% scaled by 6
  already-available "extra detail" fields; a 14-day `updatedAt` freshness
  window matching `trust_config.py`'s `FRESHNESS_RECENTLY_UPDATED_DAYS`), for
  the identical reason: a search-results list can render dozens of cards, and
  a real `/trust` call per card would mean dozens of extra requests just to
  decorate a list. Verified listings show the exact `"✓ Verified by
  myMakan"` chip; unverified listings show the completeness estimate
  instead, so the row is never empty — same as web.
- **`TrustDetailsSheet`'s "Report a Concern" opens `ReportListingSheet` as a
  second, independently-toggled `BottomSheet`, not nested inside the first
  one.** React Native `Modal`s (which `BottomSheet` wraps) stack
  independently by default — unlike web's fixed-`<div>` overlay pattern,
  where a report modal nested inside the trust sheet's backdrop div would
  have needed the sibling-JSX restructuring web's Prompt 9 documented to stop
  a backdrop click from closing both. Mobile's two `BottomSheet`s are simply
  two sibling components each with their own `visible` state, matching this
  same screen's pre-existing `DecisionSheet` + `FinancingSheet` pattern
  (already two independently-toggled `BottomSheet`s coexisting on
  `property/[id].tsx` before this prompt) — no special stacking logic needed.
- **`MediatorTrustSection`-equivalent card in `agent/[id].tsx` is an
  additional dedicated card, not a rewrite of the pre-existing header
  hero.** Same reasoning as web's Prompt 9: the hero predates this feature
  (core identity header, with its own rating/listing-count display,
  unrelated to the Trust Center), and this new card's job is specifically to
  surface Prompt 4's *new* fields (`verification_label`'s exact phrase, the
  rent/sale split, response info, the explainer) as one
  Trust-Center-branded unit — inserted directly after the header card and
  before the Bio, i.e. as early as possible in the profile without touching
  the pre-existing hero.
- **Review Summary section returns `null` when `review_count === 0`,
  even though the endpoint still returns a valid fallback result at zero
  reviews** — same reasoning as web's Prompt 9: this screen's pre-existing
  header stats already show "No reviews yet" in that exact case, so a
  second, near-empty Review Summary card would be redundant noise. The card
  only appears once there's at least one review to summarize (even below
  the AI threshold, where it shows the deterministic fallback `note`
  instead).
- **`response_rate` is a fraction (0–1) on the wire** — `agent/[id].tsx`
  multiplies by 100 (`Math.round(partner.response_rate * 100)`) before
  interpolating into `agent.trust.responseRateOnly`/`responseRateAndTime`,
  matching the backend's documented Prompt 4 shape
  (`response_rate = accepted / total-ever-assigned`).
- **The AI Review Summary fetch (`fetchMediatorAiReviewSummary`) is a
  separate `useEffect`, independent of the screen's existing `Promise.all`**
  — the existing `Promise.all` already gates the whole screen's loading
  spinner on `fetchPublicPartner`/`fetchMediatorReviewSummary`/
  `fetchMediatorReviews`/`fetchPropertiesByMediator`; adding the AI summary
  call to that same `Promise.all` would have made a slow/failed AI call
  delay the entire profile screen's first render. Kept it as its own
  effect + loading state instead, rendered via a small `ActivityIndicator`
  inside the `ListFooterComponent` while it's in flight — never blocking the
  header, listings, or reviews above it.

### Verification

- `npm run typecheck` (`tsc --noEmit`, from `mobile/`) — clean, exit 0, no
  errors, after all component/screen/`maskan.ts`/i18n changes above.
- Mobile has no `lint` script/ESLint config in this repo (checked
  `package.json` and for `.eslintrc*`/`eslint.config*` — none exist), so no
  lint pass was run; TypeScript's structural checking (via `tsc --noEmit`)
  was the available automated check.
- **Not visually verified against a running Expo dev server / simulator /
  real backend** in this session — no Metro bundler, iOS Simulator, Android
  emulator, or backend/DB was started. So the Trust badge/sheet, PropertyCard
  chips, Report Listing sheet, and the agent screen's Trust & Activity/Review
  Summary cards' actual on-screen appearance in both English and Arabic (RTL
  layout via `I18nManager`, real API responses, `BottomSheet` drag-to-dismiss
  interaction) was not visually inspected. Same limitation web's Prompts 7-9
  each documented for their own UI, for the same reason (no dev server/DB
  available in this session). RTL correctness relies on this code using only
  the same NativeWind utility classes (`flex-row`, `gap-*`, `text-*`, no
  hardcoded `left`/`right`) already exercised by `property/[id].tsx`'s
  pre-existing `IntelligenceHero`/`DecisionSheet`/`AtAGlanceCard`, which are
  expected to render correctly in Arabic today (mobile flips `flex-row` via
  `I18nManager.forceRTL`, not per-component logic).

### Known limitations / open items for later prompts

- **Not visually verified against a running Expo dev server / simulator** in
  this session — see "Verification" above. A future demo-verification pass
  (mirroring Prompt 12's web equivalent) should click/tap through
  `/property/[id]` and `/agent/[id]` in both locales against live data,
  including triggering the report sheet's sign-in prompt, success state, and
  a real 409 (submit the same reason twice), before the investor demo.
- **Deterministic free text is still English-only in the Arabic locale** —
  see "Judgment calls" above; not a new gap, the same one web's Prompt 7/9
  already documented, now also present on mobile.
- **PropertyCard's completeness percentage is an approximation**, not the
  real Trust Model score — see "Judgment calls" above. Same known limitation
  web's Prompt 7 documented; unchanged reasoning applies to mobile.
- **`fetchDuplicateCheck` is exported but unused** — mobile has no
  partner-portal surface (by this prompt's own explicit instruction not to
  add one), so there is no draft-listing pre-publish flow on this platform to
  wire it into, unlike web where Prompt 8 eventually consumes the identical
  function.
- **Mobile has no Popover primitive**, so `ListingVerificationBlock`'s
  explainer is a toggle-open panel rather than a floating popover like web's
  `VerificationBlock` — a deliberate, documented platform adaptation (see
  "New components" above), not a missing feature.

## Prompt 11 — Web: Admin Trust & Moderation dashboard + property review page

**Scope actually touched:** `frontend/src/routes/admin_.trust-moderation.tsx`
(new), `frontend/src/lib/api/maskan.ts` (extended — 6 new admin API
functions + types for Prompt 6's six admin endpoints). No changes to
`frontend/src/routes/admin.tsx` itself (see "Judgment calls" below for why),
no i18n files touched (see the same section), no customer/partner/mobile
files touched — correctly out of scope per the prompt.

### New route

- **`/admin/trust-moderation`** (`admin_.trust-moderation.tsx`, file id
  `/admin_/trust-moderation`) — a new flat-file admin route, mirroring
  `admin_.property-requests.tsx`'s established convention exactly: its own
  `createFileRoute`, its own local admin-login gate (duplicated, not
  imported, for the same "stays independently code-splittable" reason that
  file's header comment already gives), its own local `KpiCard`/`Panel`/
  `ConfirmButton` primitives (extended here with an optional `extra` slot on
  `ConfirmButton` for the Hide action's reason input — kept backward
  compatible, unused by the reference file's own call sites), gated purely
  by the existing `user.is_admin` check from `useAuth()` — no new permission
  system, identical to every other `admin_.*.tsx` route and to `admin.tsx`
  itself.
- Not added as a nav item inside `admin.tsx`'s sidebar/mobile-nav — the
  prompt's scope line lists `admin.tsx` as in-scope but the actual
  instruction ("Build... dashboard cards... moderation table... review
  page") only describes the new page's content, and `admin_.notifications.tsx`
  (an existing, already-shipped flat-file admin route) is *also* not in
  `admin.tsx`'s nav — it's reached today only via the "Settings" nav item's
  `to="/admin/notifications"` link. `admin_.property-requests.tsx` is
  likewise not in the nav at all. Given that precedent, and to honor the
  literal instruction "Do NOT touch customer, partner, or mobile" as
  narrowly as possible (a nav-item edit to `admin.tsx` is a real but
  avoidable touch to a large, already-conflicted file — see the untouched
  `M` diffs already present on `admin.tsx` before this prompt in the
  session's starting `git status`), this prompt leaves `admin.tsx` fully
  untouched and the page is reachable by its URL
  (`/admin/trust-moderation`) directly, exactly how `/admin/property-requests`
  already is. Flagged below as a known limitation, not silently decided.

### Page structure

Two in-page views toggled by local `selectedPropertyId` state (no nested
routing) — a queue view and a detail view:

- **Queue view** — `DashboardCards` (the six `GET /admin/trust/dashboard`
  counts as `KpiCard`s, warning/danger tone when non-zero) above
  `ModerationTable` (`GET /admin/trust/properties`): a filter bar
  (transaction type, city, status, trust level, mediator verification,
  low-completeness/reported/stale checkboxes — every filter the endpoint
  supports) with an explicit "Apply filters" button (draft vs. applied
  filter state, identical two-state pattern to
  `admin_.property-requests.tsx`'s `RequestsTable` — avoids a request per
  keystroke while typing the city filter), a table (property/type/mediator/
  trust/completeness/freshness/reports/status/Review-button columns), and
  Previous/Next pagination reading `X-Total-Count`.
- **Detail view** — `PropertyReviewDetail` (`GET
  /admin/trust/properties/{id}`): an action bar (View reports anchor link,
  Review mediator, Request correction, Hide/Restore) above six `Panel`
  sections — Trust assessment (all five component scores with "Not
  available" for omitted ones, positive signals / missing information /
  things to verify), Data quality (completeness tier breakdown + missing-
  field suggestions + image-quality issues — the identical partner-facing
  data), Mediator (verification badge, rating, listing counts, member-since,
  portal approval status), Reports (`id="reports"`, every report with an
  inline resolve control for Open/Under Review ones), Property intelligence
  (decision score + strengths/considerations, or a plain "not available"
  note when the flag is off/data insufficient — never an error), and
  Moderation history (the audit-log timeline).

### Judgment calls

- **"Review mediator" links to the existing public `/agent/$id` profile
  page** (Prompts 4/9's Trust & Activity + Review Summary work), opened as a
  normal in-app navigation, rather than building a second, admin-only
  mediator detail page. `admin.tsx` already has a separate "Mediators" list
  view (verify/approve/reject actions) for portal-access administration —
  duplicating a mediator profile view here would be exactly the "separate
  moderation platform" the prompt says not to build. The public profile
  page already shows everything spec section 11 asks an admin to be able to
  review (verification badge, rating, review count, listing counts, areas,
  member-since, AI review summary) since Prompts 4/9 built it for that
  purpose.
- **"Request correction" is a UI-only affordance, not a new backend
  endpoint** — confirmed against this doc's own Prompt 6 section, which
  explicitly lists "no admin resolve-report... / no draft endpoint" style
  caveats but never a correction-request endpoint; Prompt 6's actual scope
  (dashboard, list, detail, hide, restore, resolve-report) has no such
  route. Per the prompt's own instruction ("implement it as a lightweight
  UI-only affordance... without inventing new backend state"), the button
  opens a small panel that composes a plain-text message from
  `data_quality.missing_field_suggestions` (the same deterministic
  suggestions Prompt 3's partner Listing Quality panel already shows the
  mediator) and copies it to the clipboard via `navigator.clipboard`, with
  an explicit on-page note that nothing is sent or persisted — the admin
  pastes it into whatever channel (email/WhatsApp) the team already uses to
  reach mediators. No new model, no new audit action, no new endpoint.
- **No i18n keys added.** Checked before writing any code: neither
  `admin.tsx` nor `admin_.property-requests.tsx` (nor `admin_.notifications.tsx`)
  imports `useI18n` or any key from `lib/i18n/en.ts`/`ar.ts` — grepped for
  `useI18n` across both files, zero matches. This codebase's admin console
  has never been localized; it's an internal English-only tool, distinct
  from the customer-facing site and the Arabic-first customer/partner/
  mobile surfaces every other Trust Center prompt correctly added i18n keys
  for. Adding a first-ever i18n integration to the admin console was out of
  scope for a moderation-page prompt and would be a much larger, unrelated
  change — this page follows the established (unlocalized) admin
  convention instead, exactly like `admin_.property-requests.tsx` does.
- **`admin.tsx` left untouched** — see "New route" above for the full
  reasoning; the new page is reachable directly by URL, matching how
  `/admin/property-requests` already works without its own nav entry.
- **Marketplace Confidence in the moderation list vs. detail view** — no
  frontend decision was made here; the frontend just renders whatever
  `trust_score`/`trust_level` the list endpoint returns (Prompt 6's own
  documented list-view trade-off, Marketplace Confidence omitted for N+1
  reasons) vs. the full five-component assessment the detail endpoint
  returns. Not hidden from the admin: the detail view's "Not available" per-
  component rendering makes an omitted component visible whenever it
  occurs, rather than presenting a silently-incomplete score as if it were
  complete.
- **Hide's `reason` field** is a plain optional text input revealed inside
  the existing `ConfirmButton`'s confirm step (a small `extra` slot added to
  that shared primitive) rather than a separate modal — keeps the single-
  entity, no-bulk-action shape Prompt 6's backend already committed to.

### Verification

- `npx tsc --noEmit` (frontend typecheck) — **clean, exit code 0** — after
  fixing one bug caught only by typecheck: an initial draft referenced a
  non-existent `mediator_id_for_link` field (the mediator's id is actually
  `PropertyReviewDetailOut.mediator.id`, i.e. `MediatorPublicOut.id`, since
  the backend schema doesn't expose a separate top-level mediator-id field)
  — fixed to use `mediator.id` directly.
- `npx eslint` on both changed files — 3276 problems, but **100% of them are
  pre-existing `prettier/prettier` CRLF line-ending complaints** present
  identically on files this prompt never touched (confirmed by running the
  same lint against the untouched `admin_.property-requests.tsx`, which
  reports the same one-error-per-line CRLF pattern across all 610 of its
  lines) — a Windows checkout artifact of this repo's `core.autocrlf=true`
  setting, not something introduced by this prompt. Filtering out
  `prettier/prettier` leaves **zero** remaining lint errors (no unused
  imports, no undefined names, no React-hooks-rule violations) in either
  file.
- `routeTree.gen.ts` regenerated correctly: started `vite dev` in the
  background after creating the route file, confirmed
  `/admin_/trust-moderation` → `/admin/trust-moderation` appeared in the
  regenerated file, then stopped the dev server (killed the process bound
  to its port) rather than leaving it running.
- **Visual verification**: partial. No seeded demo data / running backend
  was available in this session to click through the page with real trust/
  moderation data (same limitation every prior web/mobile prompt in this
  doc has documented for the same reason). What *was* verified: started
  `vite dev` again and issued a direct HTTP request to
  `/admin/trust-moderation` — got HTTP 200, the page's route matched
  server-side (`s:"success"` in the streamed router state), and the
  `<title>Trust &amp; Moderation — myMakan Admin</title>` tag rendered
  correctly, confirming the route compiles, resolves, and server-renders
  without a build or runtime error (the body shows the same "Loading…" auth-
  gate shell every other admin page shows during SSR before the client-side
  `useAuth()` context resolves — expected, not a bug). This does not confirm
  the authenticated dashboard/table/detail rendering, filter interactions,
  or the hide/restore/resolve actions actually work end-to-end against a
  live backend.

### Known limitations / open items for later prompts

- **No nav entry in `admin.tsx`** — reachable only by direct URL
  (`/admin/trust-moderation`), matching `/admin/property-requests`'s
  existing precedent. A future prompt could add a "Trust & Moderation" item
  to `admin.tsx`'s `navItems` array (and possibly surface `open_reports` as
  a badge count, the same pattern already used for `pendingReviewCount` on
  the "Reviews" nav item) if a persistent nav entry becomes wanted — not
  built here to avoid an unnecessary edit to a large, already-modified file
  for a prompt whose actual content requirement was the new page itself.
- **No i18n** — see "Judgment calls" above; consistent with, not a
  regression from, the existing admin console.
- **"Request correction" sends nothing** — it is exactly what its on-page
  copy says: a clipboard-copy convenience, not a tracked correction-request
  workflow. If a future prompt wants persisted correction requests (with
  their own status/audit trail), that requires new backend state Prompt 6
  deliberately didn't build and this prompt was told not to invent.
- **Not end-to-end tested against a live backend/DB** in this session — see
  "Verification" above. A future demo-verification pass (Prompt 12's
  "Admin: Trust & Moderation → reported/stale listing → review data quality
  → review mediator → resolve" demo storyline) should click through this
  page against seeded data before the investor demo: dashboard counts,
  every filter combination, the review-detail assembly for a listing with
  reports/a mediator/property intelligence and one without, hide → restore
  roundtrip, and report resolution to each of the three target statuses.

## Prompt 12 — Tests pass, demo verification, and progress doc finalization

### Backend test suite

Ran the full Trust Center regression list (19 files spanning trust,
completeness, consistency, freshness, mediator trust, review summary,
AI trust-summary, reports, duplicate detection, partner quality, admin
moderation) plus a `pytest --collect-only` sanity pass and the full
project suite. Result: **no regressions across any of the 11 prior
prompts** — every shared file touched by more than one session
(`mediators.py`, `properties.py`, `property.py`, `config.py`,
`feature_flags.py`, `main.py`, `models/__init__.py`) is consistent across
all its callers. (Test counts below include the Prompt-12-adjacent
grace-period fix described further down; see that section for the delta.)

### Frontend / mobile typecheck & build

- **`frontend/`**: `tsc --noEmit` — clean. `npm run build` — clean
  production build (one routine Vite chunk-size advisory, not an error, not
  new). The five independent prompt sessions that touched shared files
  (Prompts 7-9, 11 — `maskan.ts`, `en.ts`/`ar.ts`, `PropertyTrustCenter.tsx`,
  `VerificationBlock.tsx`) integrated without type or naming conflicts.
- **`mobile/`**: `tsc --noEmit` — clean. Confirms Prompt 10's parity work
  didn't drift from the web reference implementation's shared type shapes.

### Live verification (real DB, real backend, current code)

A stale backend process (started before the Trust Center files existed on
disk) was found running on the dev port and was missing the entire new
route surface despite `--reload`; it was restarted from current code before
verifying anything, otherwise the check would have been meaningless.

Verified live against the real dev DB (149 published properties, 2
mediators, 0 reviews, 0 reports — no data was written during this pass):

- `GET /properties/{id}/trust` — real component scores, e.g. property #1552
  → `overall_score: 84`, `trust_level: "Good"`.
- `GET /properties/{id}/trust-summary` — real AI-generated explanation
  (`generated_by: "ai"`), grounded in the actual assessment.
- `GET /mediators/{id}/public` — real Trust & Activity fields for mediator
  "Yasmin Real Estate" (`is_verified: true`, `active_listing_count: 75`).
- `GET /mediators/{id}/review-summary` — correctly falls back
  (`generated_by: "fallback"`) since the DB has 0 reviews anywhere —
  expected, not a bug.
- `GET /admin/trust/dashboard` (real admin login) — real counts
  (`low_completeness_listings: 64`, others 0, consistent with an
  all-Published, no-reports/no-reviews seed).
- Browser click-through (headless Chromium): `/property/1552` renders the
  Trust & Verification panel exactly matching the API (84 / Good
  Confidence, "✓ Verified by myMakan", zero console errors);
  `/admin/trust-moderation` renders the login gate, then — after a real
  login with seeded admin credentials — the live dashboard and moderation
  table with real properties and correct columns, zero console errors.

**Not verified live** (out of scope for this pass, none of these are new
risk — each is the same "not visually verified" limitation already flagged
by its own prompt section above): mediator review-summary AI path with
actual review text (DB has 0 reviews to exercise it with); report-filing,
report-resolve, hide/restore, and partner quality/publish flows (mutating
actions intentionally not exercised against the shared dev DB); the full
AI Home Finder → Partner 72%→91%→Publish storyline; mobile app parity
(an Expo dev server was already running but not driven through a screen).

**Pre-existing findings noticed during the live pass (not Trust Center bugs,
not fixed — out of scope, flagged for visibility):**
1. A bookable (nightly-rate) listing's price block renders "SAR 0" instead
   of its nightly rate — a pre-existing pricing-display gap unrelated to
   Trust Center, confirmed absent on a normal rental listing.
2. The admin login page's email placeholder still reads `admin@maskan.sa`
   (old brand), a leftover from the myMakan brand-rename work.
3. One district (`Al Khalidiyya`, Madinah) has no seeded area-intelligence
   data — a data-coverage gap, not a code bug; the property's own trust
   payload already correctly reports this as missing information.
4. Confirmed, not a bug: the admin **moderation list**'s trust score for a
   property can differ from that same property's own `/trust` score (Prompt
   6 already documents this — the list view omits Marketplace Confidence to
   stay N+1-free; the single-property review-detail endpoint carries the
   full five-component score).

### Post-launch fix: Mediator Trust new-partner grace period

Raised during demo prep: if a brand-new mediator's very first listing shows
a mediocre or low trust score purely because they haven't accumulated
reviews/listing history yet, that's a strong disincentive for exactly the
partners the platform most needs at launch. Checking the actual scoring
(`mediator_trust.py`), this was a real gap — a brand-new, unverified
mediator with 0 reviews and 0 other listings scored a flat **0** on the
Mediator Trust component (20% of the overall weight), capping even a
perfect listing around 80/100 and pushing anything less-than-perfect into
"Moderate" territory.

**Fix:** `MEDIATOR_TRUST_GRACE_PERIOD_DAYS` (`trust_config.py`, default 30
days). While a mediator is not yet verified, has 0 reviews, and has no more
than their first listing, and is within this many days of their account's
`created_at`, the Mediator Trust component is **omitted from the overall
weighted score** (renormalized, using the exact same missing-component
mechanism every other component already uses for "can't be calculated")
instead of being scored against signals they haven't had time to earn. The
raw score is still computed and still returned in `component_scores`
(`MediatorTrustResult.in_grace_period: bool` — visible to admin/internal
consumers; not yet exposed through the public `MediatorTrustOut` schema,
since no UI need for it was requested), so nothing about the mediator's
real numbers is hidden, only what counts toward the customer-facing overall
score. The "not yet verified by myMakan" caution still appears in `Things
to Verify` regardless of grace-period status — the fix protects the score,
not the honesty of the verification-status disclosure.

The grace period ends immediately — even within the 30-day window — the
moment any one of: the mediator becomes myMakan-verified, picks up their
first approved review, or publishes a second listing. Implemented in
`_is_new_partner_grace_period` (`mediator_trust.py`); fails safe (grace
period never applies) if `Mediator.created_at` is unset. Threaded through
`trust_assessment.py`'s `assess_property_trust(..., now=...)` the same way
`listing_freshness.py` already threads `now` for testability.

New tests: `test_mediator_trust.py` (6 new — grace-active, grace-expired,
and each of the three "ends the grace period" triggers, plus the
fail-safe-when-unset case) and `test_trust_assessment.py` (2 new — the
overall-score delta between a graced and an otherwise-identical ungraced
new mediator, and all three grace-ending triggers exercised through the
full orchestrator). Full suite after this fix: **447 passed, 23 skipped**
(up from 439/23 before the fix; the 23 skips are pre-existing flag-gated
tests, unrelated). Verified live against the running dev backend —
`/properties/1552/trust` still returns its expected real payload after the
reload picked up the change.

### Summary — what shipped across all 12 prompts

**Backend (Prompts 1-6):** a deterministic, no-LLM Trust Model
(`trust_assessment.py` + five component calculators — Listing Completeness,
Listing Consistency, Mediator Trust, Listing Freshness, Marketplace
Confidence — weights centralized in `trust_config.py`, missing components
omitted and renormalized rather than fabricated); `GET
/properties/{id}/trust` and async `GET /properties/{id}/trust-summary`
(AI explanation, grounded strictly in the assessment + property + mediator
+ review-summary facts, deterministic fallback on any AI failure);
`property_reports` table + `POST /properties/{id}/reports` +
`GET /properties/{id}/duplicate-check`; `availability_confirmed_at` column;
partner-facing `GET/POST /partner/properties/{id}/quality`,
`/confirm-availability`, `/improve-with-ai` (AI suggestions never
auto-saved); mediator Trust & Activity fields on `/mediators/{id}/public`
+ `GET /mediators/{id}/review-summary` (AI-labeled, minimum-count-gated,
deterministic fallback); admin `/admin/trust/dashboard`, `/properties`,
`/properties/{id}`, hide/restore, resolve-report — all audit-logged via the
existing `audit_log.py` pattern, all reusing Prompts 1-5's services rather
than recomputing. See "Full API surface" above for the complete endpoint
list.

**Web (Prompts 7, 8, 9, 11):** customer Trust Center (instant deterministic
badge + sheet, async AI summary, generic `VerificationBlock`, minimal
`PropertyCard` signals, Report a Concern modal); partner Listing Quality
panel + Confirm Availability + Improve-with-AI (approve-before-apply) +
duplicate-warning modal + image-quality notes on the existing
`PartnerListingForm`; mediator profile Trust & Activity card + AI-labeled
Review Summary + the "What does myMakan Verified mean?" explainer; admin
`/admin/trust-moderation` dashboard + moderation table + review-detail page
with hide/restore/resolve actions, gated by the existing admin permission
check.

**Mobile (Prompt 10):** parity with the web customer/mediator experience —
`PropertyTrustBadge`/`TrustDetailsSheet`, `ListingVerificationBlock`,
`ReportListingSheet`, PropertyCard trust chips, and the same Trust &
Activity + Review Summary additions to `agent/[id].tsx` — all named
distinctly from the pre-existing, unrelated `TrustBadge.tsx` (renter
identity-verification badge) per the naming-collision warning at the top of
this doc. No partner-portal surface added to mobile, matching scope.

**Verification terminology (enforced throughout):** only the exact phrase
"✓ Verified by myMakan" is ever produced by any component, prompt, or UI
string in this feature — "Government Verified" / "REGA Verified" / "Ejar
Verified" / "Nafath Verified" never appear. The data model (`MediatorTrustResult`,
`VerificationBlock`'s `providers` list) is deliberately shaped to add a
status per external provider later without a redesign — no such integration
is built today.

**DB changes:** `properties.availability_confirmed_at` (nullable timestamp,
migration `a9b0c1d2e3f4`), `property_reports` table (same migration). No
other schema changes — trust/completeness/consistency scores are computed
on read, never persisted, per Prompt 1's explicit instruction.

**Known limitations (consolidated):** no persistent nav entry for
`/admin/trust-moderation`; "Request correction" is a clipboard-copy
affordance, not a tracked workflow; the admin moderation *list*'s score
omits Marketplace Confidence for N+1 reasons while the *detail* view's
score is the full five-component figure (by design, documented in Prompt
6); Mediator Trust's grace period (this section) is a first-pass judgment
call on duration/thresholds, not from a reference spec — worth revisiting
once real onboarding data exists; none of the web/mobile UI in Prompts
7-11 was visually driven through a live browser/simulator session by its
own authoring prompt (Prompt 12's live pass above covers two of those pages
directly; the rest remain typecheck/build-verified only).

**Future external-verification extension points:** `MediatorTrustResult`
and `VerificationBlock`'s generic `providers: [{key, name, status, label}]`
shape are ready to carry a second row (e.g. Ejar) the day that integration
is built — no schema or component redesign needed, only a new provider
entry and its own status source.

**Investor demo (spec section 20):** the Property Detail → Trust &
Verification → mediator → completeness → freshness → AI Summary → Things
to Verify leg and the Admin → Trust & Moderation → dashboard → moderation
table leg were both driven live against real seeded data in this prompt's
verification pass, matching the spec's storyline. The Partner
(72%→add details→91%→Confirm Availability→Publish) leg and the full
end-to-end click-through of every admin action (hide/restore/resolve) were
not exercised live — recommended as a pre-demo dry run once reports/reviews
exist in the seed data.
