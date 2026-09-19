# myMakan Phase 1 Beta — 0.1.0-beta.1

**Release date:** 2026-09-19
**Purpose:** Private functional testing with a small group of trusted testers.
**Platforms:** Web (customer, partner, admin) and Android (test APK, debug-signed).

## What's in this release

- **Rent / Buy discovery** — search, map/list view, filters, property detail.
- **AI Home Finder** — natural-language search → ranked, explained results.
- **Property Intelligence** — decision score, price intelligence, comparables,
  data confidence, negotiation insight.
- **Area Intelligence** — district-level insights and nearby places.
- **Trust Center** — trust score, listing completeness, mediator trust,
  freshness/consistency signals, reviews, AI trust summary.
- **Saved properties / saved searches** with alerting.
- **Leads & messaging** between customers and mediators.
- **Viewing management** — request, schedule, checklist, feedback, AI
  viewing-prep assistance.
- **Negotiations** — offer, counter, accept, AI negotiation guidance.
- **Transaction Workspace** — post-acceptance progress tracker, documents,
  activity timeline, and an "Ask myMakan" AI panel, for both Rent and Buy.
- **Partner portal** — dashboard, properties (rent/sale), leads, messages,
  profile, reviews, area coverage, subscription, negotiations, viewings,
  transactions.
- **Admin portal** — dashboard, properties, mediators, leads, reviews, area
  intelligence, data import, analytics, users, trust moderation, read-only
  transactions oversight.
- **Arabic / RTL** support across customer, partner, and admin surfaces.

## Known limitations

Deliberately out of scope for Phase 1 (present in the codebase, hidden
behind feature flags — see `docs/implementation/mymakan-phase1.md`):

- No Ejar-equivalent digital rental contracts.
- No Nafath-equivalent identity verification.
- No live reservation/deal payment processing.
- No financing/mortgage flow.
- No off-plan projects or short-stay bookings.
- No production government integrations.

Genuine open items from end-to-end testing
(`docs/testing/mymakan-e2e-test-report.md`, §23.2):

- **Native Android/iOS device behavior was not exercised prior to this
  release** — the earlier E2E test pass validated mobile only through
  Expo's web target. This release's APK build includes a native install/
  launch/critical-journey pass to close that gap (see the deployment
  report for results).
- Saved-search alert **delivery** (the scheduled daily digest) has not been
  exercised end-to-end — no Celery Beat scheduler has been run continuously
  yet. Creating/previewing/enabling alerts all work; the actual scheduled
  send is unverified.
- A handful of P2/P3 cosmetic issues (English-only AI Home Finder quick-action
  copy in Arabic UI, one un-migrated RTL truncation edge case, verbose AI
  error text on gateway failure, stock-photo gallery padding with no "generic
  filler" indicator) — tracked in the E2E report, not blocking for this beta.

## Versions

| Component | Version |
|---|---|
| Backend API | 0.1.0-beta.1 |
| Web (customer/partner/admin) | 0.1.0-beta.1 |
| Mobile (Android APK) | 0.1.0-beta.1 (versionCode 1) |

See `docs/releases/mymakan-beta-deployment-report.md` for deployment status,
and `docs/releases/mymakan-beta-tester-guide.md` for how to install and what
to test.
