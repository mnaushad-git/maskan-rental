# myMakan Phase-1 — Copy-Paste Session Prompts

Companion to the original "Create myMakan Phase-1 Codebase from Existing Maskan Platform"
brief. Run these **in order, one per fresh Claude Code window/session**, the same way
`SESSION_PROMPTS.md` is used for the Aqar roadmap. Each prompt is self-contained: it tells
the session exactly which files to read (so it doesn't re-explore the whole repo) and
exactly when to stop. Do not paste two prompts into the same session.

Working directory for all prompts: `d:\Naushad\Projects\Maskan-Rental\maskan-rental`

All progress is tracked in `docs/implementation/mymakan-phase1.md` (created in Prompt 1).
If a session runs out before finishing its prompt, the next session should read that doc
first to see what's already done before re-running the same prompt.

---

## Prompt 1 — Inspection Map + Branch Setup

```
Read only: frontend/src/routes/ (list the directory, don't open every file),
backend/app/api/routes/ (list the directory), mobile/app/ (list the directory),
backend/app/core/feature_flags.py, ROADMAP_AQAR_AI.md (skim headings only).

Task: Set up the myMakan Phase-1 workspace without changing any functional code.
1. Create git branch `feature/mymakan-phase1` from the current branch. Do not delete or
   modify the original branch/history.
2. Classify each frontend route file and each backend router file into one of:
   Keep-Phase1 (rent/buy discovery, map/list search, filters, property details, save,
   compare, saved searches, notifications, leads/enquiries, agent/mediator profile,
   reviews, AI advisor, area intelligence, rent estimate, property value intelligence,
   AI property request, profile/account, partner rental/sale listing+leads mgmt,
   admin rental/sale/mediator/user/lead/review/area/import/analytics mgmt)
   vs. Hide-Phase1 (projects, off-plan, bookings unrelated to viewing, hotels/short-stay,
   auctions, property management/maintenance, mortgage/financing, insurance, developer
   sales tools, unrelated commercial/moving/interior/utilities services, Nafath/Ejar,
   external payment-transaction journeys, experimental modules).
3. Create `docs/implementation/mymakan-phase1.md` with these section headers (fill in what
   you now know, leave the rest as `TODO — filled in by a later prompt`):
   Phase-1 scope / Existing functionality reused / Features hidden / Features preserved
   for future / Routes changed / Navigation changed / Feature flags / Branding changes /
   Database impact / Known limitations / Validation results / Recommended next feature.
   Fill "Phase-1 scope", "Existing functionality reused", and "Features hidden" now using
   your classification tables from step 2 (one table for frontend routes, one for backend
   routers, one for mobile routes).

Acceptance: branch exists, doc exists with three populated classification tables.
Do not touch any route, component, model, or config file's actual code in this session.
Commit the new doc. Stop there.
```

---

## Prompt 2 — Feature Flags (backend)

*(Prereq: Prompt 1 done)*

```
Read only: backend/app/core/feature_flags.py, backend/app/core/config.py,
backend/app/main.py (router registration section only),
docs/implementation/mymakan-phase1.md.

Task: Add Phase-1 feature flags using the EXISTING feature-flag mechanism in
feature_flags.py — do not build a new flag system.
Off by default: FEATURE_PROJECTS, FEATURE_BOOKING, FEATURE_SHORT_STAY,
FEATURE_FINANCING, FEATURE_PROPERTY_MANAGEMENT, FEATURE_EXTERNAL_TRANSACTION.
On by default: FEATURE_RENT, FEATURE_BUY, FEATURE_AI_ADVISOR,
FEATURE_AREA_INTELLIGENCE, FEATURE_SAVED_SEARCHES, FEATURE_NOTIFICATIONS,
FEATURE_LEADS.
Add these to backend/.env.example with comments. If gating the obviously off-scope
routers (projects, bookings, financing) behind their flag in main.py is a small,
low-risk change, do it; if it looks risky, leave the routers registered and just note
it as a TODO for Prompt 5 — don't force it.

Acceptance: backend still starts, flags are readable via the existing mechanism.
Update the "Feature flags" section of docs/implementation/mymakan-phase1.md with the
final list and defaults. Commit. Stop there — do not touch frontend or mobile.
```

---

## Prompt 3 — Backend Rent/Buy terminology audit

*(Prereq: Prompt 2 done)*

```
Read only: docs/implementation/mymakan-phase1.md, then grep the backend for
transaction_type, listing_type, rent, sale, lease, purchase (models + schemas only,
not every usage) starting from backend/app/models/ and backend/app/api/routes/properties.py,
backend/app/api/routes/search.py.

Task: Confirm (or establish) ONE canonical field name for Phase-1 — recommended
`transaction_type` with allowed values `rent` / `sale`. Do not perform a global rename.
If the current model already uses this cleanly, just document it. If there are
inconsistent/legacy values or field names, add a thin mapping/adapter (e.g. a small
helper or serializer-level normalization) so the API surface is consistent — no
destructive migration, no breaking existing API contracts.

Acceptance: documented canonical mapping, existing backend tests still pass, no schema
was destructively changed. Update docs/implementation/mymakan-phase1.md ("Database
impact" section) with what you found and what you changed, if anything. Commit.
Stop there — do not touch frontend.
```

---

## Prompt 4 — Customer web navigation cleanup

*(Prereq: Prompt 1 done; Prompt 3 not required)*

```
Read only: frontend/src/components/maskan/TopNav.tsx, frontend/src/routes/__root.tsx,
frontend/src/routes/index.tsx, and the "frontend routes" classification table in
docs/implementation/mymakan-phase1.md.

Task: Trim the main customer nav (TopNav.tsx / __root.tsx) to: Home, Rent, Buy, Map,
AI Advisor, Area Intelligence, Saved, My Requests/Leads, Profile. Remove links to
Hide-Phase1 items (projects, bookings, etc.) from the nav — do not delete those route
files. Update the home page (index.tsx) hero copy to communicate "Find the right
property to rent or buy with AI-powered intelligence" and prominently surface
Rent / Buy / Search / Map / AI Advisor. Reuse the existing design system — no redesign.

Acceptance: nav renders only the Phase-1 items listed above, `bun run build` (or the
project's existing typecheck/build script) succeeds.
Update "Navigation changed" and "Routes changed" sections of
docs/implementation/mymakan-phase1.md. Commit. Stop there.
```

---

## Prompt 5 — Customer property details + out-of-scope route guarding

*(Prereq: Prompt 4 done)*

```
Read only: frontend/src/routes/property.$id.tsx, frontend/src/routes/projects.tsx,
frontend/src/routes/project.$id.tsx, docs/implementation/mymakan-phase1.md
("Feature flags" and "Routes changed" sections).

Task:
1. In property.$id.tsx, make sure the display clearly branches by transaction_type:
   Rent shows annual/monthly rent, rental estimate, rental score, area intelligence,
   agent, enquiry, save, compare, AI advisor. Buy shows sale price, price/value
   intelligence (if already available), area intelligence, agent, enquiry, save,
   compare, AI advisor. Do not invent new financing/mortgage UI.
2. Guard the Hide-Phase1 routes still reachable by direct URL (projects.tsx,
   project.$id.tsx, and any booking-related route found in Prompt 1's table) so they
   render a simple "not available in this version" state instead of full content,
   rather than deleting the files. Base the gate on the feature flags added in Prompt 2
   if there's a cheap way to read them from the frontend; otherwise use a local
   constant and note that choice in the doc.

Acceptance: property detail page branches correctly by transaction type; out-of-scope
routes show a graceful gate instead of full content; build still succeeds.
Update docs/implementation/mymakan-phase1.md accordingly. Commit. Stop there.
```

---

## Prompt 6 — Partner portal cleanup

*(Prereq: Prompt 1 done)*

```
Read only: frontend/src/routes/partner.tsx, partner.leads.$leadId.tsx,
partner.requests.tsx, partner.requests.$id.tsx, partner.register.tsx,
docs/implementation/mymakan-phase1.md.

Task: Trim the partner portal nav/dashboard to: Dashboard, My Properties, Rental
Listings, Sale Listings, Leads, Messages, Profile, Reviews, Area Coverage,
Subscription. Ensure listing creation/edit forms and the listing table/filters only
expose Rent and Sale as transaction types (All / Rent / Sale filter). Reuse the
existing property entity — do not create a parallel listing system.

Acceptance: partner portal builds, nav and listing type options match the spec above.
Update "Navigation changed" in docs/implementation/mymakan-phase1.md. Commit.
Stop there.
```

---

## Prompt 7 — Admin portal cleanup

*(Prereq: Prompt 1 done)*

```
Read only: frontend/src/routes/admin.tsx, admin_.notifications.tsx,
admin_.property-requests.tsx, analytics.tsx, import.tsx,
docs/implementation/mymakan-phase1.md.

Task: Trim the admin nav to: Dashboard, Properties, Rentals, Sales, Mediators, Leads,
Reviews, Area Intelligence, Data Import, Analytics, Users, Settings. Property/listing
filters should include: transaction type, status, city, district, mediator,
verification, property type. Remove project/booking-related items from the admin nav
(don't delete the underlying route files).

Acceptance: admin portal builds, nav and filters match the spec above.
Update "Navigation changed" in docs/implementation/mymakan-phase1.md. Commit.
Stop there.
```

---

## Prompt 8 — Mobile navigation cleanup

*(Prereq: Prompt 1 done. If you haven't built the mobile app on this machine before,
skim mobile/CLAUDE.md and the "Maskan mobile Android build" note first.)*

```
Read only: mobile/app/(tabs)/_layout.tsx, mobile/app/(tabs)/index.tsx,
mobile/app/(tabs)/projects.tsx, mobile/app/(tabs)/bookings.tsx,
docs/implementation/mymakan-phase1.md.

Task: Reduce the bottom tab bar in _layout.tsx to: Home, Search, AI, Saved, Profile.
Represent Rent/Buy through a segmented toggle or search-mode selector on Home/Search
(not separate tabs). Remove the Projects and Bookings tabs from the tab bar
registration — keep the underlying screen files, just deregister them from
_layout.tsx.

Acceptance: mobile app still type-checks/builds (use the existing Android build
recipe if you need to verify on the emulator); tab bar matches the 5 items above.
Update "Navigation changed" in docs/implementation/mymakan-phase1.md. Commit.
Stop there.
```

---

## Prompt 9 — Branding replacement (Maskan / myHome → myMakan)

*(Prereq: Prompts 4, 6, 7, 8 done — run this after nav cleanup so you're not
re-touching files that are about to change)*

```
Read only: docs/implementation/mymakan-phase1.md. Then grep (case-insensitive) for
"maskan" and "myhome" across frontend/src, mobile/app, mobile/components, mobile/assets
— visible text/copy/config only (i18n strings, headers, titles, splash/app display
name, meta tags), not code identifiers.

Task: Replace user-visible brand strings (nav/header, page titles, i18n copy, mobile
app display name/splash) from Maskan/myHome to myMakan across customer web, partner
portal, admin portal, and mobile. Do NOT rename: package.json "name" fields, bundle
identifiers, Docker service names, env var namespaces, database names, or API paths —
those are explicitly out of scope for this task.

Acceptance: no visible "Maskan"/"myHome" string remains in nav, headers, titles, or
mobile app display name; all technical identifiers (packages, bundle IDs, env vars,
DB names, API paths) are unchanged.
Update "Branding changes" in docs/implementation/mymakan-phase1.md with a list of
files touched. Commit. Stop there.
```

---

## Prompt 10 — Tests & build validation

*(Prereq: Prompts 2, 3, 4, 5, 6, 7, 8, 9 done)*

```
Read only: docs/implementation/mymakan-phase1.md (full doc — this is your context for
everything done so far), backend/pytest.ini, backend/tests/ (directory listing only),
frontend/package.json (scripts section), mobile/package.json (scripts section).

Task:
1. Run backend pytest, focused on search/properties/leads/feature-flag-related tests.
2. Run frontend typecheck/build (bun run build or equivalent).
3. Run mobile TypeScript check/build.
4. Fix any breakage caused specifically by Prompts 2–9 (do not fix unrelated
   pre-existing failures — just note them).
5. If cheap, add minimal focused tests per the original brief: rent search works, sale
   search works, an out-of-scope route/category is hidden or gated, feature flags work.
   Do not build a large new test suite.

Acceptance: builds pass; tests pass or pre-existing unrelated failures are clearly
noted as such, not silently ignored.
Update "Validation results" and "Known limitations" in
docs/implementation/mymakan-phase1.md. Commit. Stop there — no new features.
```

---

## Prompt 11 — Final wrap-up

*(Prereq: Prompt 10 done)*

```
Read only: docs/implementation/mymakan-phase1.md (full).

Task: Fill in any remaining TODO sections (should just be "Known limitations" and
"Recommended next feature" if not already done). "Recommended next feature" should
name one concrete, small next step — not a re-scope of Phase 1.
Then produce a final summary as your response text (not a new file) covering exactly:
What was kept / What was hidden / What was renamed / Files changed / Feature flags
added / Build+test results / Any blockers / Recommended next visible feature.

Acceptance: doc has no remaining TODO markers.
Commit the finished doc. Do not start any new feature work. Stop there.
```
