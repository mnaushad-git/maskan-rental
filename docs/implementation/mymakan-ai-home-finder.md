# myMakan AI Home Finder

Feature-first implementation of the AI Home Finder: natural language → structured
search criteria → existing property search → deterministic ranked shortlist → AI
explanation → existing Save/Compare/Contact journey. Built on top of Phase-1
(`docs/implementation/mymakan-phase1.md`), reusing the existing property database,
search filters, AI gateway, Area Intelligence, AI Advisor, Save/Compare, and design
system rather than building a parallel search stack.

## What was implemented

- **Backend**: three new AI-gateway calls (interpret / refine / explain), a
  deterministic, centrally-weighted match-scoring engine, a lightweight search-history
  model, and a new router (`/api/v1/ai/home-finder/*`) gated by a Phase-1-style
  feature flag (`FEATURE_AI_HOME_FINDER`, default on).
- **Web**: a new `/home-finder` route (free-text input → "myMakan understood" editable
  criteria → ranked match cards with map toggle → "Why this property?" sheet), plus a
  prominent AI entry point on the home page (banner + example-prompt chips) alongside
  the existing search bar and quick links.
- **Mobile**: a mirrored `home-finder.tsx` screen (same three-step flow, lighter
  editing UI suited to touch), surfaced as a fifth tab in the existing
  `MoreWaysSection` home-screen switcher.
- **Both Rent and Buy** journeys are supported by the same screens/endpoints — the
  only difference is `transaction_type` and which price field is compared.

## APIs

All under `/api/v1/ai/home-finder` (also mounted at `/api/ai/home-finder`), defined in
`backend/app/api/routes/home_finder.py` / `backend/app/schemas/home_finder.py`:

| Endpoint | Purpose | AI involved? |
|---|---|---|
| `POST /interpret` | Free text → structured `HomeFinderCriteria` | Yes (extraction), deterministic fallback |
| `POST /refine` | Current criteria + short instruction → updated criteria + diff | Yes (targeted edit), deterministic fallback (no change) |
| `POST /search` | Criteria → deterministic ranked shortlist, categories, empty-result info | No — pure scoring engine |
| `POST /explain` | Criteria + property id → natural-language paragraph on top of the deterministic score | Yes (narration only), deterministic fallback |
| `GET /history` | Signed-in user's last 10 AI Home Finder searches | No |

`HomeFinderCriteria` (shared shape across all endpoints): `transaction_type`, `city`,
`districts[]`, `property_type`, `min_price`/`max_price`, `bedrooms`,
`required_amenities[]`/`preferred_amenities[]` (constrained to a verifiable
vocabulary — see below), `unsupported_requests[]` (things the user asked for that
aren't tracked, e.g. "parking"), `preferences[]` (lifestyle vocabulary), and
`commute_destination`.

Every AI call goes through the existing gateway (`app.core.ai.gateway.run_chat`) and
prompt registry (`app.core.ai.prompts`) — new prompts: `HOME_FINDER_EXTRACTOR`,
`HOME_FINDER_REFINER`, `HOME_FINDER_EXPLAINER`. Raw model output is never trusted: a
sanitizer (`app/services/home_finder_ai.py::_sanitize_criteria`) drops unknown keys,
clamps types, and filters amenity/preference values to a fixed, backend-verifiable
vocabulary before anything reaches the scoring engine (Section 3's "AI output must
never directly execute arbitrary search parameters" — covered by
`test_sanitize_criteria_drops_unsupported_amenity_even_if_ai_misbehaves`, which
proves this holds even if the model itself misbehaves).

## Scoring logic

`backend/app/services/home_finder_scoring.py` — no LLM involved.

1. **Candidates**: pulled via the *existing* filter vocabulary
   (`app.core.search.filters.PropertyFilterCriteria` / `build_property_filters` — the
   same one saved searches and the Property Request matcher already share), hard-filtered
   only on `transaction_type` + `city` + published status. Everything else is a scored
   dimension, not an exclusion — so a close-but-imperfect property still shows up,
   ranked lower, instead of vanishing. Pool capped at 300 properties.
2. **Dimensions** (`WEIGHTS` dict, sums to 1.0 — the one place weights are defined):
   `budget_fit` (0.22), `location_fit` (0.18), `bedrooms_fit` (0.15),
   `property_type_fit` (0.08), `required_amenities_fit` (0.15),
   `preferred_amenities_fit` (0.05), `lifestyle_fit` (0.09, via Area Intelligence),
   `commute_fit` (0.08, via haversine distance to a known landmark/district/city
   center — never a fabricated distance for an unrecognized destination).
3. **Missing data**: a dimension the criteria didn't set (or has no real data for,
   e.g. no Area Intelligence row for that district) is *excluded*, and the remaining
   weights are renormalized — never defaulted to a guessed value. Covered by
   `test_missing_data_dimensions_excluded_and_weight_renormalizes`.
4. **Exact match**: a property is an "exact match" only if every *hard-capable*
   dimension it was scored on (budget/location/bedrooms/property type/required
   amenities) has no trade-off. `exact_match_count` in the `/search` response drives
   the empty-result UI.
5. **Empty-result intelligence** (Section 13): when `exact_match_count == 0`, the
   service re-evaluates the *same already-fetched candidate pool* under a handful of
   real relaxations (+15%/+30% budget, −1 bedroom, add one more district actually
   present in the pool, drop one required amenity) and only surfaces the ones that
   actually raise the count — every number shown is a real recomputation over real
   data, never estimated.
6. **Categories**: `best_overall` (top score), `best_value` (best budget-fit ×
   overall), `best_location` (best location-fit, only if districts were stated),
   `best_family` (highest district family score on record). `best_investment` is
   deliberately always `null` — the platform has no rental-yield or appreciation data
   to ground it in (Section 8 explicitly forbids fabricating this).

## Screens / components

**Web** (`frontend/src/routes/home-finder.tsx`):
- Step 1 — free-text input, Rent/Buy toggle, example prompts, recent-search chips.
- Step 2 — "myMakan understood": editable criterion cards (transaction type, city,
  budget, bedrooms, districts, commute, property type, must-have/nice-to-have
  amenities, lifestyle preferences); editing here never re-triggers an AI call.
- Step 3 — ranked match cards (existing `PropertyCard`, wrapped with a `ScoreRing`
  overlay + deterministic reasons/trade-off chips + Why/Compare/Ask AI actions),
  category rail, empty-result banner with one-tap suggestions, a bottom refine bar
  (short instruction → `/refine` → re-run `/search`, with an "Updated your search"
  diff banner), and a map toggle (existing `PropertyMapView`, given a new opt-in
  `showMatchInfo` prop so its pin-click preview can show match score + top reason
  without changing behavior anywhere else it's used).
- "Why this property?" — a bottom-sheet/dialog (same hand-rolled modal shell as
  `compare.tsx`'s `PropertyPickerModal`) showing match %, strong points, trade-offs,
  Area Intelligence (via the existing `fetchAreaIntelligence`), a deterministic price
  insight, and a button into the existing AI Advisor with the property + question
  pre-seeded (same `sessionStorage` context handoff `property.$id.tsx` already uses).

**Mobile** (`mobile/app/home-finder.tsx`): the same three steps adapted to native
components (`SegmentedControl`, `Chip`, `BottomSheet` from `mobile/src/components/ui/`),
reusing mobile's `PropertyCard` (which already has a built-in `ScoreRing`, so the real
backend score just overrides the client-side estimate) and `PropertyMapView`. Entry
point: a fifth tab (`Wand2` icon) in the existing `MoreWaysSection` home-screen
switcher, registered as a flat Stack route (not a bottom tab), matching how AI
Advisor/Property Requests are already wired.

## AI usage

Three feature names logged through the existing `gateway.log_ai_call` /
`AICallLog` pipeline: `home_finder_interpret`, `home_finder_refine`,
`home_finder_explain`. No new AI infrastructure — same `Anthropic` client, same
prompt-registry pattern, same per-route rate limiting
(`rate_limit_dependency`, 20-30 requests/10min) as every other AI endpoint in
`app/api/routes/ai.py`.

## Existing components/systems reused

Property DB & model, `PropertyFilterCriteria`/`build_property_filters` (search),
`PropertyOut` schema, `AreaIntelligence` model + `fetchAreaIntelligence`, AI gateway +
prompt registry + rate limiter + call logging, `PropertyCard` (web & mobile),
`PropertyMapView` (web & mobile, additively extended), `ScoreRing`, Save
(`saveProperty`/`deleteSavedProperty` via `PropertyCard`), Compare (same page-local
`compareIds` + "N selected" bar pattern already used in `search.tsx` — compare
selection isn't shared anywhere in this codebase, so this matches the existing idiom
rather than inventing a new one), AI Advisor deep-link (`/advisor?propertyId&q` +
`sessionStorage` context), i18n framework (`useLanguage()`/`t()`, full `en`/`ar`
`homeFinder.*` namespace on both web and mobile), auth context, `CITY_LIST`/
`districtsByCity`.

## Tests

**Backend** (`backend/tests/test_home_finder.py`, 19 tests, all passing — full suite
230 passed / 23 skipped, 0 failed):
- Scoring dimensions: budget within/over, unset-dimension exclusion, bedrooms
  exact/one-fewer/far-fewer, missing-data weight renormalization, required-amenity
  partial match, commute known-landmark vs. unresolvable destination.
- `rank()`/`pick_categories()` ordering and category selection (isolated from the
  dev DB's real seed data via a unique per-test city, since this suite runs against
  real Postgres, not a throwaway test DB).
- Empty-result suggestions using real recomputed counts.
- AI sanitization: unsupported amenity dropped even if the model misbehaves;
  interpret/refine/explain each verified to degrade to a safe deterministic fallback
  on AI failure (mocked `gateway.run_chat`).
- HTTP surface: empty-text validation, AI-failure degrades to 200 (not 500),
  search persists history only for signed-in users, anonymous `/history` is 401,
  `/explain` 404s for an unknown property, and the feature flag actually 503s the
  router at runtime (not just at process-start registration).

**Frontend**: `npx tsc --noEmit` clean and `npx vite build` clean on web; `npx tsc
--noEmit` clean on mobile (no build script exists in `mobile/package.json` — same bar
Prompts 8/9 used). No dedicated frontend test suite exists in this repo to extend
(confirmed by Prompt 10's audit); the web flow was instead verified live end-to-end
against the real backend and a real Anthropic key (see Demo instructions) —
interpret → search → refine → explain were each called live and produced correct,
sensible output (SSR-rendered `/home-finder` and the home page banner were also
checked for absence of server errors).

## Known limitations

- Map pins are not yet color-coded by match tier (90%+/80-89%/<80%) — `PropertyMapView`
  was extended with an opt-in `showMatchInfo` prop for the pin-click preview (score +
  top reason), but per-pin color still follows listing type only, to avoid changing
  pin appearance on every other page that reuses this shared component. Documented
  here per the brief's own "where easy with existing components" qualifier.
- `required_amenities`/`preferred_amenities` only cover amenities with a real backing
  `Property` column (furnished, elevator, A/C, kitchen, water, electricity, private
  roof, villa-style, two entrances, separate meter). Anything else the user asks for
  (parking, pool, gym — none of which exist in the schema) is carried through as
  `unsupported_requests` and shown back to the user, but never scored or claimed as
  verified.
- Commute is a straight-line-distance estimate (haversine to a small hand-maintained
  landmark table, including KAFD) converted to minutes via a documented flat
  30 km/h assumption — the same approximation `property_request_matcher.py` already
  uses elsewhere in this codebase. No real routing/traffic API is integrated.
- `best_investment` is always `null` — no rental-yield or appreciation data exists on
  the platform to ground it in, per the brief's explicit instruction not to fabricate
  this.
- Compare selection is page-local (not shared with `/compare`, which loads its own
  default set) — this matches the existing behavior of every other page in the app
  that has a compare button, not a new limitation this feature introduces.
- Search-history persistence requires sign-in (matches Save/Saved Searches elsewhere);
  anonymous users can still interpret/search/explain freely, matching `ai_chat`'s own
  optional-auth pattern.

## Demo instructions

1. Ensure `ANTHROPIC_API_KEY` is set in the backend environment (confirmed present and
   working in this dev environment during implementation — real extractions,
   refinements, and explanations were generated, not fallbacks).
2. Backend: `cd backend && venv/Scripts/python.exe -m uvicorn app.main:app --reload`.
3. Web: `cd frontend && npx vite dev` → open `/` and click the "AI Home Finder" banner
   (or an example prompt chip), or go straight to `/home-finder`.
4. Rent journey: "I need a 3-bedroom family apartment in North Riyadh under SAR 75K,
   parking required, near KAFD." → review/edit the understood criteria → **Find My
   Best Matches** → open **Why this property?** on the top result → **Area
   Intelligence** → back out and **Compare**/**Save**/**Contact Agent** on a card.
5. Buy journey: same flow with "Villa to buy in North Riyadh under SAR 2M for a
   family, at least 4 bedrooms."
6. Refinement: on the results screen, type "only show below 70K" or "remove Al
   Narjis" into the bottom bar and confirm the "Updated your search" diff + refreshed
   ranking.
7. Empty-result: set an unreasonably narrow criteria combination (e.g. 6+ bedrooms in
   a district with none) and confirm the "you're close" banner with real suggested
   counts, not "No properties found."
8. Mobile: `cd mobile && npx expo start`, open the Home tab, scroll to "More ways to
   find your home," select the AI Home Finder tab, tap through the same flow.
