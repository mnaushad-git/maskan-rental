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

TODO — filled in by a later prompt

## Navigation changed

TODO — filled in by a later prompt

## Feature flags

TODO — filled in by a later prompt. Note: `backend/app/core/feature_flags.py` is a
minimal env-var-backed flag registry (see `FLAGS` dict) — no per-tenant/per-brand
targeting exists yet, so myMakan Phase-1 hiding will need either new flags in this
same registry or a route/navigation-level gate, not a flag-service change.

## Branding changes

TODO — filled in by a later prompt

## Database impact

TODO — filled in by a later prompt

## Known limitations

TODO — filled in by a later prompt

## Validation results

TODO — filled in by a later prompt

## Recommended next feature

TODO — filled in by a later prompt
