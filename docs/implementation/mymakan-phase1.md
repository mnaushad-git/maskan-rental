# myMakan Phase-1 Implementation Tracking

Companion doc to `MYMAKAN_PHASE1_PROMPTS.md`. Created by Prompt 1 (Inspection Map).
Each later prompt should read this doc first, fill in its section(s), and leave
everything else untouched unless it discovers the existing content is wrong.

## Phase-1 scope

Phase-1 (myMakan) keeps the core rent/buy discovery experience — search, property
details, saving, comparing, leads/enquiries, agent/mediator profiles, reviews, the AI
advisor and area-intelligence tools, rent estimate, AI property requests, partner
listing/lead management, and the admin back-office for that surface. It hides
everything adjacent to off-plan projects, short-stay bookings, contracts/Ejar,
identity verification/Nafath, financing/mortgage, payments, and premium/subscription
tiers — these are out of scope for Phase-1 but preserved in code for later phases.

## Existing functionality reused

Nearly all Keep-Phase1 routes below are reused as-is from the existing Maskan
codebase with no code changes in this session — classification only. See the
per-surface tables under "Routes changed" is TODO; this section just lists what's in
scope for reuse (same tables, Keep-Phase1 rows).

## Features hidden

See the Hide-Phase1 rows in the tables below. Summary: projects/off-plan, short-stay
bookings, digital rental contracts (Ejar-equivalent), renter identity verification
(Nafath-style), mortgage/financing, external payment-transaction flows, and the
renter-facing premium/subscription tier.

### Frontend routes (`frontend/src/routes/`)

| File | Classification | Notes |
|---|---|---|
| `__root.tsx` | Keep-Phase1 | Root layout/infra |
| `admin.tsx` | Keep-Phase1 | Admin dashboard |
| `admin_.notifications.tsx` | Keep-Phase1 | Admin notification mgmt |
| `admin_.property-requests.tsx` | Keep-Phase1 | Admin property-request mgmt |
| `advisor.tsx` | Keep-Phase1 | AI advisor |
| `agent.$id.tsx` | Keep-Phase1 | Agent/mediator profile |
| `analytics.tsx` | Keep-Phase1 | Admin analytics mgmt |
| `areas.tsx` | Keep-Phase1 | Area intelligence |
| `auth.tsx` | Keep-Phase1 | Login/profile-account |
| `compare.tsx` | Keep-Phase1 | Compare |
| `contract.$leadId.tsx` | Hide-Phase1 | Digital rental contract (Ejar-equivalent) |
| `estimate.tsx` | Keep-Phase1 | Rent estimate |
| `import.tsx` | Keep-Phase1 | Admin import mgmt |
| `index.tsx` | Keep-Phase1 | Home / discovery |
| `lead.$leadId.tsx` | Keep-Phase1 | Leads/enquiries |
| `lead.new.tsx` | Keep-Phase1 | Leads/enquiries |
| `methodology.tsx` | Keep-Phase1 | Supporting page for estimate/AI advisor |
| `my-leads.tsx` | Keep-Phase1 | Leads/enquiries |
| `notification-settings.tsx` | Keep-Phase1 | Notifications |
| `notifications.tsx` | Keep-Phase1 | Notifications |
| `partner.leads.$leadId.tsx` | Keep-Phase1 | Partner leads mgmt |
| `partner.register.tsx` | Keep-Phase1 | Partner onboarding |
| `partner.requests.$id.tsx` | Keep-Phase1 | Partner property-request handling |
| `partner.requests.tsx` | Keep-Phase1 | Partner property-request handling |
| `partner.tsx` | Keep-Phase1 | Partner dashboard |
| `partners.tsx` | Keep-Phase1 | Agent/mediator directory |
| `project.$id.tsx` | Hide-Phase1 | Off-plan project details |
| `projects.tsx` | Hide-Phase1 | Off-plan projects |
| `property-requests.$id.tsx` | Keep-Phase1 | AI property request |
| `property-requests.new.tsx` | Keep-Phase1 | AI property request |
| `property-requests.tsx` | Keep-Phase1 | AI property request |
| `property.$id.tsx` | Keep-Phase1 | Property details |
| `property..tsx` | Keep-Phase1 | Property details (alias/redirect route — verify in a later prompt) |
| `saved-searches.tsx` | Keep-Phase1 | Saved searches |
| `saved.tsx` | Keep-Phase1 | Save |
| `search.tsx` | Keep-Phase1 | Map/list search + filters |

`README.md` in this directory is documentation, not a route — excluded from the table.

### Backend routers (`backend/app/api/routes/`)

| File | Classification | Notes |
|---|---|---|
| `__init__.py` | Keep-Phase1 | Router registration/infra |
| `ai.py` | Keep-Phase1 | AI advisor |
| `analytics.py` | Keep-Phase1 | Admin analytics |
| `areas.py` | Keep-Phase1 | Area intelligence |
| `area_intelligence.py` | Keep-Phase1 | Area intelligence |
| `auth.py` | Keep-Phase1 | Auth/profile |
| `bookings.py` | Hide-Phase1 | Bookings unrelated to viewing / short-stay |
| `contracts.py` | Hide-Phase1 | Digital rental contract (Ejar-equivalent) |
| `devices.py` | Keep-Phase1 | Push notification device registration |
| `financing.py` | Hide-Phase1 | Mortgage/financing |
| `health.py` | Keep-Phase1 | Health check infra |
| `leads.py` | Keep-Phase1 | Leads/enquiries |
| `mediators.py` | Keep-Phase1 | Mediator profile mgmt |
| `notifications.py` | Keep-Phase1 | Notifications |
| `payments.py` | Hide-Phase1 | External payment-transaction journeys |
| `projects.py` | Hide-Phase1 | Off-plan projects |
| `properties.py` | Keep-Phase1 | Property details/search |
| `property_requests.py` | Keep-Phase1 | AI property request |
| `property_request_admin.py` | Keep-Phase1 | Admin property-request mgmt |
| `property_request_partner.py` | Keep-Phase1 | Partner property-request mgmt |
| `reviews.py` | Keep-Phase1 | Reviews |
| `saved_properties.py` | Keep-Phase1 | Save |
| `saved_searches.py` | Keep-Phase1 | Saved searches |
| `search.py` | Keep-Phase1 | Map/list search |
| `subscriptions.py` | Hide-Phase1 | Renter-facing premium/subscription tier |
| `users.py` | Keep-Phase1 | Profile/account |
| `verification.py` | Hide-Phase1 | Renter identity verification (Nafath-style) |

### Mobile routes (`mobile/app/`)

| File | Classification | Notes |
|---|---|---|
| `(tabs)/_layout.tsx` | Keep-Phase1 | Tab layout/infra |
| `(tabs)/advisor-shortcut.tsx` | Keep-Phase1 | AI advisor |
| `(tabs)/bookings.tsx` | Hide-Phase1 | Bookings unrelated to viewing |
| `(tabs)/index.tsx` | Keep-Phase1 | Home / discovery |
| `(tabs)/profile.tsx` | Keep-Phase1 | Profile/account |
| `(tabs)/projects.tsx` | Hide-Phase1 | Off-plan projects |
| `+not-found.tsx` | Keep-Phase1 | Infra |
| `_layout.tsx` | Keep-Phase1 | Root layout/infra |
| `advisor.tsx` | Keep-Phase1 | AI advisor |
| `agent/[id].tsx` | Keep-Phase1 | Agent/mediator profile |
| `areas/[name].tsx` | Keep-Phase1 | Area intelligence |
| `areas/index.tsx` | Keep-Phase1 | Area intelligence |
| `auth/login.tsx` | Keep-Phase1 | Profile/account |
| `auth/signup.tsx` | Keep-Phase1 | Profile/account |
| `compare.tsx` | Keep-Phase1 | Compare |
| `estimate.tsx` | Keep-Phase1 | Rent estimate |
| `lead/new.tsx` | Keep-Phase1 | Leads/enquiries |
| `lead/[id].tsx` | Keep-Phase1 | Leads/enquiries |
| `leads.tsx` | Keep-Phase1 | Leads/enquiries |
| `methodology.tsx` | Keep-Phase1 | Supporting page for estimate/AI advisor |
| `my-bookings.tsx` | Hide-Phase1 | Bookings unrelated to viewing |
| `notification-settings.tsx` | Keep-Phase1 | Notifications |
| `notifications.tsx` | Keep-Phase1 | Notifications |
| `premium.tsx` | Hide-Phase1 | Renter-facing premium/subscription tier |
| `project/[id].tsx` | Hide-Phase1 | Off-plan project details |
| `property-requests/[id].tsx` | Keep-Phase1 | AI property request |
| `property-requests/index.tsx` | Keep-Phase1 | AI property request |
| `property-requests/new.tsx` | Keep-Phase1 | AI property request |
| `property/[id].tsx` | Keep-Phase1 | Property details |
| `saved-searches.tsx` | Keep-Phase1 | Saved searches |
| `saved.tsx` | Keep-Phase1 | Save |
| `search.tsx` | Keep-Phase1 | Map/list search + filters |
| `verification.tsx` | Hide-Phase1 | Renter identity verification (Nafath-style) |

Note: `contract.$leadId.tsx` (frontend) has no obvious mobile or backend counterpart
router file beyond `contracts.py` — worth confirming in a later prompt whether the
mobile app has an equivalent screen under a different name.

## Features preserved for future

TODO — filled in by a later prompt

## Routes changed

**Prompt 4 — Customer web navigation cleanup.** No route files added, removed,
or renamed — only the home page component (`frontend/src/routes/index.tsx`)
changed:

- `HomeSearchSection` gained a hero `<h1>` + subtitle (new `home.hero.title` /
  `home.hero.subtitle` i18n keys) communicating "Find the right property to
  rent or buy with AI-powered intelligence", plus a row of four quick-link
  pills — Rent (`/search?listingType=rent`), Buy (`/search?listingType=sale`),
  Map (`/search`, whose default view is already the map), and AI Advisor
  (`/advisor`) — using new `home.quickLinks.*` i18n keys. Search itself is
  already prominently surfaced by the existing `SearchBar` component
  immediately below the hero (unchanged).
- Reused the existing design system only: same pill styling already used
  elsewhere on this page (`rounded-full border ... shadow-card`), same
  `font-display` heading classes used site-wide — no new components, no
  layout system changes.

All Hide-Phase1 route files (`projects.tsx`, `project.$id.tsx`,
`contract.$leadId.tsx`, etc.) are untouched and still resolve normally if
navigated to directly — only their nav entry points were removed (see
"Navigation changed" below).

## Navigation changed

**Prompt 4.** `frontend/src/components/maskan/TopNav.tsx`'s `NAV_LINKS` was
trimmed to exactly the Phase-1 set requested: Home, Rent, Buy, Map, AI
Advisor, Area Intelligence, Saved (+ My Leads, appended only when signed in,
as before). Before → after:

| Before | After |
|---|---|
| Search (`/search`) | split into **Rent** (`/search?listingType=rent`), **Buy** (`/search?listingType=sale`), **Map** (`/search`) |
| Projects (`/projects`) | **removed** (Hide-Phase1) |
| Explore Areas (`/areas`) | relabeled **Area Intelligence** (same route — matches the Prompt 1 classification, which called this feature "area intelligence") |
| Partners (`/partners`) | **removed** from top nav (Keep-Phase1 route, but not one of the 9 requested nav items — still reachable via its URL and any in-page links; not deleted) |
| AI Advisor (`/advisor`) | kept |
| Saved (`/saved`) | kept |
| Compare (`/compare`) | **removed** from top nav (same rationale as Partners — Keep-Phase1, still reachable, just not top-nav) |
| My Leads (`/my-leads`, signed-in only) | kept, appended after the base list as before |
| — | **Home** (`/`) added as an explicit nav item (previously only reachable via the logo) |

**Profile** (from the requested 9-item list) was not added as a new nav
link — the existing account avatar / dropdown (`NavAuthButton.tsx`, always
rendered at the end of `TopNav`) already serves as the Profile entry point
(saved properties, my leads, property requests, saved searches, notification
settings, admin console, sign out) and a "Sign in" button when signed out.
Adding a second, redundant "Profile" link was judged unnecessary — a
judgment call, flagged here in case a later prompt disagrees.

Implementation notes:
- Rent/Buy/Map all navigate to the same `/search` route with different (or no)
  `listingType` search param — `search.tsx` already reads `listingType` from
  the query string itself (not a typed route search schema), so this needed
  no changes to `search.tsx`.
- Known limitation: the nav's active-state highlighting is `pathname`-based
  (desktop `activeProps`, mobile manual `isActive`) and doesn't distinguish
  between Rent/Buy/Map's shared `/search` pathname — all three can render as
  "active" simultaneously while on `/search`. Fixing this would mean adding
  search-param-aware active-state logic, which felt like it crossed from
  "trim the nav" into "redesign the nav", so it was left as-is per the
  prompt's "reuse the existing design system — no redesign" instruction.
- Verified end-to-end: ran `npm run typecheck` and `npm run build` (both
  clean), then started the dev server and fetched the rendered home page HTML
  — confirmed the desktop nav renders exactly `Home, Rent, Buy, Map, AI
  Advisor, Area Intelligence, Saved` (in that order) with correct hrefs
  (`/search?listingType=rent`, `/search?listingType=sale`, `/search`,
  `/advisor`, `/areas`, `/saved`), and the hero heading/quick-links render
  the new copy.

## Feature flags

Added by Prompt 2 to the existing env-var-backed registry in
`backend/app/core/feature_flags.py` / `backend/app/core/config.py` — no new flag
mechanism. Backend-only so far; frontend/mobile gating (via these same flags exposed
to clients, or a separate nav-level gate) is still TODO for a later prompt.

| Flag | Default | Env var | Router gated in `main.py`? |
|---|---|---|---|
| `rent` | On | `FEATURE_RENT` | n/a (no dedicated router) |
| `buy` | On | `FEATURE_BUY` | n/a (no dedicated router) |
| `ai_advisor` | On | `FEATURE_AI_ADVISOR` | n/a (`ai.router` always on) |
| `area_intelligence` | On | `FEATURE_AREA_INTELLIGENCE` | n/a (`areas`/`area_intelligence` routers always on) |
| `saved_searches` | On | `FEATURE_SAVED_SEARCHES` | n/a (`saved_searches.router` always on) |
| `notifications` | On | `FEATURE_NOTIFICATIONS` | n/a (`notifications.router` always on) |
| `leads` | On | `FEATURE_LEADS` | n/a (`leads.router` always on) |
| `projects` | Off | `FEATURE_PROJECTS` | Yes — `projects.router` |
| `booking` | Off | `FEATURE_BOOKING` | Yes — `bookings.router` |
| `short_stay` | Off | `FEATURE_SHORT_STAY` | No dedicated router — TODO Prompt 5 |
| `financing` | Off | `FEATURE_FINANCING` | Yes — `financing.router` |
| `property_management` | Off | `FEATURE_PROPERTY_MANAGEMENT` | No dedicated router exists in this codebase — TODO Prompt 5 |
| `external_transaction` | Off | `FEATURE_EXTERNAL_TRANSACTION` | No dedicated router gated — `payments.router` stays registered because it also backs in-scope flows (mediator lead/subscription fees); revisit in Prompt 5 |

Not gated by a Phase-1 flag yet, left registered as-is: `contracts.router`,
`verification.router`, `subscriptions.router` (Hide-Phase1 per the classification
tables above, but no 1:1 flag was requested for them in Prompt 2 — TODO Prompt 5 to
decide whether they need their own flag or a route-level gate on the frontend only).

Verified via `python -c "from app.core.feature_flags import is_enabled; ..."`: all 13
flags read their correct default, and `app.main._ROUTERS` drops from 26 to 23 entries
with defaults in place (projects/bookings/financing excluded).

## Branding changes

TODO — filled in by a later prompt

## Database impact

**Prompt 3 — Rent/Buy terminology audit.** No destructive schema change, no
migration. Findings:

- `Property.listing_type` (`backend/app/models/property.py:18`, `String(20)`,
  default `"rent"`) is the field the property listing itself carries — values
  found in code are only `"rent"` / `"sale"` (see `properties.py`'s
  `listing_type != "sale"` / `== "sale"` branches). No legacy values like
  `"lease"`, `"purchase"`, or `"buy"` exist anywhere in models/schemas — the
  handful of "lease" hits in the codebase are prose strings in AI contract-flag
  messages (`api/routes/ai.py`), unrelated to this field.
- `PropertyRequest.transaction_type` and `SavedSearch.transaction_type`
  (`models/property_request.py:55`, `models/saved_search.py:28`) carry the same
  rent/sale concept for a user's demand/alert, and both schemas validate it
  strictly to `"rent"` / `"sale"` (`schemas/property_request.py`,
  `schemas/saved_search.py` — `field_validator` raises otherwise). Values are
  consistent with `listing_type`; only the **field name** differs.
- So the inconsistency is naming, not values: `Property` uses `listing_type`,
  while `PropertyRequest`/`SavedSearch` use `transaction_type` for the same
  `rent`/`sale` concept. Per the prompt's recommendation, **`transaction_type`
  with values `rent`/`sale` is the canonical Phase-1 name** — `PropertyRequest`
  and `SavedSearch` already use it cleanly; `Property` does not.
- Renaming the `properties.listing_type` column (or every `Property.listing_type`
  reference across models/schemas/services/routes) would be a global rename
  the prompt explicitly rules out and would break existing API consumers, so
  instead of that: added a **read-only computed field** `transaction_type` to
  `PropertyOut` (`backend/app/schemas/property.py`) that mirrors
  `listing_type` on serialization. `listing_type` is untouched (still the DB
  column, still accepted on create/update) — `transaction_type` is additive,
  appears in every property API response alongside it, and lets myMakan
  Phase-1 clients read one consistent field name (`transaction_type`) across
  properties, saved searches, and property requests without a migration.
- No input schemas (`PropertyCreate`/`PropertyUpdate`/partner variants) were
  changed — they still take `listing_type` only, to avoid two writable fields
  that could drift out of sync.

Verified: `PropertyOut` correctly serializes both `listing_type` and the new
`transaction_type` (manual check with `pydantic` `model_dump()`); backend test
suite run (`tests/test_properties.py`, `test_search_provider.py`,
`test_property_requests.py`, `test_saved_search_alerts.py` — 59 passed). One
pre-existing failure (`test_list_properties_date_range_filter_excludes_conflicting_booking`,
`bookings.guest_name` column missing in the test DB) reproduces identically on
the pre-Prompt-3 commit — confirmed unrelated to this change, a test-DB
migration-drift issue to flag separately, not fixed here.

## Known limitations

TODO — filled in by a later prompt

## Validation results

TODO — filled in by a later prompt

## Recommended next feature

TODO — filled in by a later prompt
