# myMakan Customer Web vs. Mobile — Feature Parity Audit

Code-verified audit (not doc-trusted) of every customer-facing capability built so far
across the web portal (`frontend/`) and the mobile app (`mobile/`), run against
`docs/implementation/mymakan-phase1.md`, `mymakan-ai-home-finder.md`,
`mymakan-property-intelligence.md`, `mymakan-trust-center.md`, `mymakan-viewings.md`,
and `mymakan-negotiations.md`. Two parallel research passes inspected the actual route
files, components, and API clients on each platform (not just prior implementation
docs, which can drift from code) — findings below reconcile the two.

**Headline: the prior 40+ prompts of feature work already delivered near-complete
business-capability parity.** This audit found two real, fixable gaps in the earlier
feature set (both fixed in that session) and a handful of intentional, documented
platform differences. No P0 gaps were found — no customer journey is blocked on either
platform. A later pass (Transaction Workspace, `docs/implementation/
mymakan-transaction-workspace.md` Prompt 14) added that feature's own capabilities to
this matrix and found one more real, fixable gap — a mobile "Continue Transaction" id
bug — fixed in that same pass.

## Parity matrix

| Feature | Web Portal | Mobile App | Parity | Action |
|---|---|---|---|---|
| Home | `index.tsx` — hero, quick links, AI Home Finder banner | `(tabs)/index.tsx` — map-first home, `HomeSearchHeader`, `MoreWaysSection` switcher | Equivalent Platform UX | None — different layout, same discovery entry points |
| Rent search | `/search?listingType=rent` | Rent/Sale segmented control on Home + Search | Full Parity | None |
| Buy search | `/search?listingType=sale` | same segmented control | Full Parity | None |
| Map search | `/search` (map view toggle) | `PropertyMapView` full-screen on Home + Search | Full Parity | None |
| List search | `/search` (list view toggle) | Search screen list mode | Full Parity | None |
| Filters | City/district/type/budget/beds/amenities on `search.tsx` | `HomeFilterSheet` — same filter set | Full Parity | None |
| City/district filters | Cascading city→district | Cascading city→district (`districtsByCity`) | Full Parity | None |
| Property detail | `property.$id.tsx` (~4300 lines) | `property/[id].tsx` (~1480 lines) | Full Parity | None — same sections, native layout |
| Save property | `saveProperty`/`deleteSavedProperty`, heart icon everywhere | Same functions, same UX | Full Parity | None |
| Saved properties list | `/saved` — notes, inquiry-status stepper, viewing-date field | `saved.tsx` — plain list only, `updateSavedProperty`'s `notes` field defined but never called by any screen | **P1 — Fixed** | Added a notes section (add/remove, optimistic + toast-on-failure) to mobile's saved list, wired to the same `updateSavedProperty` endpoint web uses |
| Saved notes | Full (see above) | Fixed this session (see above) | Full Parity (post-fix) | Fixed |
| Compare properties | `/compare`, reachable via footer, saved page, search results, property detail — not in top nav (deliberate) | `/compare`, reachable via property detail, Home Finder results, and a persistent Profile row | Equivalent Platform UX | None — mobile's entry point is arguably more discoverable; not worth changing web to match |
| Recently viewed | Not implemented | Not implemented | N/A | Neither platform has this; not a gap |
| Saved searches | `/saved-searches` — create/preview/enable-disable alerts/delete | `saved-searches.tsx` — same | Full Parity | None |
| Saved-search alerts | Full | Full, plus `PushPermissionPrompt` wiring on enable | Full Parity | None |
| Notification center | `/notifications`, bell w/ SSE live stream + poll fallback | `notifications.tsx`, bell on Home header | Full Parity | None |
| Notification settings | `/notification-settings` — channel/frequency/digest/devices/test push | `notification-settings.tsx` — same | Full Parity | None |
| Property inquiry / Leads (create) | `/lead/new` | `lead/new.tsx` | Full Parity | None |
| My Leads | `/my-leads`, top-nav "My Leads" (signed in) | `leads.tsx`, Profile row | Full Parity | None |
| Lead detail | `/lead/$leadId` | `lead/[id].tsx` | Full Parity | None |
| Lead chat / read-unread | Poll-based thread, `markLeadMessagesRead` | Same, 5s poll | Full Parity | None |
| Mediator/agent profile | `/agent/$id` — Trust & Activity, AI review summary, listings, reviews | `agent/[id].tsx` — same sections | Full Parity | None |
| Mediator reviews | Full | Full | Full Parity | None |
| Area Intelligence | `/areas` | `areas/index.tsx`, `areas/[name].tsx` | Full Parity | None |
| Methodology | `/methodology` | `methodology.tsx` | Full Parity | None |
| Rent estimate | `/estimate` — client-side factor model off `fetchAreas()` | `estimate.tsx` — same client-side model | Full Parity | None |
| AI Advisor | `/advisor`, streaming chat, deep-link via `?propertyId&q` | `advisor.tsx`, streaming chat, deep-link via `?q` | Full Parity | None |
| AI Home Finder — natural language | `/home-finder` step 1 | `home-finder.tsx` step 1 | Full Parity | None |
| — structured interpretation | Editable criteria cards | Editable criteria cards | Full Parity | None |
| — edit criteria | Yes, no re-trigger on edit | Yes | Full Parity | None |
| — ranked results | `ScoreRing` match cards | Same | Full Parity | None |
| — match score | Yes | Yes | Full Parity | None |
| — why-this-property | Modal w/ AI explanation | Modal w/ AI explanation | Full Parity | None |
| — refine search | Instruction bar → diff banner | Same | Full Parity | None |
| Property Intelligence — decision score | `DecisionScoreCard`, 6 dimensions | Same | Full Parity | None |
| — price intelligence | `PriceIntelligenceCard` | Same | Full Parity | None |
| — comparables | `SimilarPropertiesSection` | Same | Full Parity | None |
| — strengths/considerations | `AtAGlanceCard` | Same | Full Parity | None |
| — area intelligence embed | `AreaIntelligenceEmbed` | `PropertyAreaInsights` (pre-existing, differently scoped, deliberately not unified — see Property Intelligence doc) | Equivalent Platform UX | None |
| — smart questions | `SmartQuestionsSection` (copy) | Same (share via `Share.share()`) | Full Parity | None |
| — negotiation insight | `NegotiationInsightCard` | Same | Full Parity | None |
| — Ask myMakan | `AskMyMakanQuickQuestions` | Same | Full Parity | None |
| Trust Center — badge | `PropertyTrustCenter` on property page | `PropertyTrustSection` (distinct from unrelated `TrustBadge.tsx`, the renter identity-verification chip) | Full Parity | None |
| — listing completeness | Yes | Yes | Full Parity | None |
| — mediator trust | Yes | Yes | Full Parity | None |
| — freshness | Yes | Yes | Full Parity | None |
| — report listing | `ReportListingModal`, 409-aware | `ReportListingSheet`, 409-aware | Full Parity | None |
| Viewing — schedule | `ScheduleViewingModal` (4-step) | `viewing/new.tsx` (4-step, full screen) | Full Parity | None |
| — My Viewings | `/viewings`, **no persistent nav entry** — only reachable via a per-property status banner (visible only when that specific property has an active viewing) or a direct URL | `viewings/index.tsx`, persistent Profile row "My Viewings" | **P1 — Fixed** | Added "My Viewings" to web's account dropdown (`NavAuthButton.tsx`), matching the placement of My Leads/My Negotiations |
| — Viewing detail | `/viewings/$id` | `viewings/[id].tsx` | Full Parity | None |
| — AI checklist | Yes, AI-annotated | Yes, AI-annotated (verified live on-device per viewings doc) | Full Parity | None |
| — During-Viewing mode | Checkbox + private notes | Same | Full Parity | None |
| — post-viewing feedback | `FeedbackSection` | Same | Full Parity | None |
| — Ask myMakan what next | `NextStepsSection` | Same | Full Parity | None |
| Negotiation — make offer | `MakeOfferModal` (4-step) | `negotiation/new.tsx` (4-step, full screen) | Full Parity | None |
| — negotiation detail | `/negotiations/$id` | `negotiations/[id].tsx` | Full Parity | None |
| — counter | Yes | Yes | Full Parity | None |
| — accept/withdraw | Yes, self-accept-blocked | Yes, same rule | Full Parity | None |
| — AI guidance | "Ask myMakan" panel | Same | Full Parity | None |
| — agreement summary | Separate route `/negotiations/$id/agreement` | Inline on the same detail screen (no nested dynamic-segment precedent on mobile — documented judgment call, same data, same disclaimer string) | Equivalent Platform UX | None |
| — My Negotiations | `/negotiations`, top-nav (signed in) | `negotiations/index.tsx`, Profile row | Full Parity | None |
| Transaction Workspace — My Transactions | `/my-transactions`, avatar dropdown (`navAuth.myTransactions`) | `my-transactions.tsx`, Profile row | Full Parity | None |
| — Transaction detail (header, progress, Next Best Action) | `transaction.$id.tsx` header + horizontal `TransactionStepper` | `transaction/[id].tsx` header + a separate **vertical** `TransactionStepper` component | Equivalent Platform UX | Different stepper orientation only (mobile avoids horizontal scroll on a phone width) — same underlying checklist/progress/NBA data from `transaction_progress.py`, never recomputed on either client |
| — My Information (edit + Information Confirmation) | "My Information" tab | Inline section on the single scroll | Full Parity | None |
| — Documents (upload/replace/delete, update-requested review note) | `TransactionDocumentCard`, `<input type="file">` | `TransactionDocumentCard`, `expo-document-picker` system file picker | Full Parity | Different native picker mechanism per platform; identical status states (not_uploaded/uploaded/accepted/needs_update) and gating rules |
| — Agreed Commercial Terms (read-only) | "Overview" tab, `terms_snapshot` | Inline section, same `terms_snapshot` | Full Parity | None |
| — Checklist detail | Separate "Checklist" tab (verbose companion to the header stepper) | No separate section — the vertical stepper already shows every step's label/status/detail | Equivalent Platform UX | Same data, no duplicated section on mobile (see Prompt 11 tracking note) |
| — Activity timeline | "Activity" tab, `TransactionActivityTimeline.tsx` | Inline section, same timestamps-only derivation | Full Parity | No shared component between platforms (RN/web split), identical event list logic |
| — Ask myMakan (transaction) | "AI Assistant" tab, 6 customer quick actions | Toggleable panel, same 6 quick actions | Full Parity | None |
| — Message Mediator | Sidebar action → `/lead/$leadId` (only when `lead_id` present) | Actions block → `/lead/[id]` (same condition) | Full Parity | None |
| — Cancellation | Sidebar action + reason-picker modal | Actions block + `BottomSheet` reason picker | Full Parity | None |
| — Continue Transaction (from an accepted negotiation) | `negotiations.$id.tsx` resolves the real transaction id via `fetchMyTransactions()` before navigating | `negotiations/[id].tsx` — **fixed this session**, see below | Full Parity (post-fix) | Fixed |
| Profile/account | No standalone page — avatar dropdown only | Full Profile tab/screen | Equivalent Platform UX | None — web's dropdown covers the same links; a full profile page isn't required for parity since no capability is missing |
| Language selection | `LanguageSwitcher` in TopNav | Row in Profile screen | Full Parity | None |
| Arabic / RTL | `dir` attr + reactive language context | `I18nManager.forceRTL` | Full Parity | None |
| Authentication | `/auth` (toggle signin/signup) | `auth/login.tsx`, `auth/signup.tsx` | Full Parity | None |
| Logout | Dropdown "Sign out" | Profile "Sign out" | Full Parity | None |
| Error/empty/loading states | Present across all audited screens | Present across all audited screens | Full Parity | None |
| Deep links | Notification → in-app route resolvers | Notification → in-app route resolvers (role-aware, per negotiations doc) | Full Parity | None |

## Navigation parity

**Web** (`TopNav.tsx`, confirmed by direct read): Home, Rent, Buy, Map, AI Advisor, Area
Intelligence, Saved, + My Leads / My Negotiations when signed in. Profile/account is the
avatar dropdown (`NavAuthButton.tsx`), which now lists: Saved Properties, My Leads,
**My Viewings**, My Negotiations, **My Transactions**, Property Requests, Saved
Searches, Notification Settings, (Admin Console if admin), Sign Out. A `NotificationBell`
sits beside the avatar.

**Mobile** (`(tabs)/_layout.tsx` + `(tabs)/profile.tsx`, confirmed by direct read): tabs
Home, Search, AI Advisor, Saved, Account — matching this feature's own "keep mobile nav
compact" guidance. Secondary features sit in the Profile screen: Saved, My Leads, My
Viewings, My Negotiations, **My Transactions**, Notification Center, Saved Searches,
Property Requests, Notification Settings, plus always-visible Submit a Request, Explore
Areas, Rent Estimate, Compare, Methodology.

Both platforms now expose the same 10 primary discovery/account surfaces
(Home/Rent/Buy/Map/AI/Saved/Leads/Viewings/Negotiations/Transactions) through
platform-appropriate navigation — top nav + dropdown on web, tabs + Profile rows on
mobile.

## Gaps found and fixed this session

### P1 — Web: "My Viewings" had no persistent navigation entry point
Confirmed by grepping `frontend/src` for links to `/viewings`: the only two matches were
the viewing-detail page's own back-links. The sole way into the My Viewings list was a
status banner on the *specific* property page a customer had an active viewing for —
anyone who navigated away, or wanted to check on a viewing for a property they weren't
currently looking at, had no way back in short of typing the URL. Every sibling feature
(Leads, Negotiations, Saved Searches, Saved) already had a dropdown entry.

**Fix:** added a "My Viewings" item to `NavAuthButton.tsx`'s dropdown (between My Leads
and My Negotiations, matching mobile's Profile-row ordering), plus `navAuth.myViewings`
i18n keys in `en.ts`/`ar.ts`.

### P1 — Mobile: saved-property notes had no UI
`mobile/src/lib/api/maskan.ts`'s `updateSavedProperty()` already accepted a `notes`
field (identical shape to the backend's `PATCH /saved-properties/{id}`, which web's
`saved.tsx` already exercises for its full note-taking UI) — and mobile's own
`en.ts`/`ar.ts` already had the matching `saved.yourNotes`/`notesCountSingular`/
`addNotePlaceholder`/etc. keys pre-built — but a repo-wide grep confirmed the function
was never called from any screen or component. `mobile/app/saved.tsx` rendered bare
`PropertyCard`s with no way to add, view, or remove a note.

**Fix:** added a `SavedNotes` component to `mobile/app/saved.tsx` (add/remove notes,
optimistic local update, `useToast()` error feedback on failure), using the exact same
`\n`-joined wire format web already uses, so the same saved-property row now shows
identical notes on both platforms. Reuses only existing UI primitives (`Button`,
`IconButton`, `useToast`) — no new components or backend changes.

### P1 — Mobile: "Continue Transaction" linked to the wrong id
Found while building the Transaction Workspace mobile screens (`docs/implementation/
mymakan-transaction-workspace.md` Prompt 11). `mobile/app/negotiations/[id].tsx`'s
"Continue Transaction" button linked straight to `` `/transaction/${negotiation.id}` `` —
using the *negotiation's* id, not the real `PropertyTransaction` id. This was invisible
while `/transaction/[id]` was a Prompt-1-era placeholder that ignored its route param, but
would have opened the wrong (or a nonexistent) transaction once that screen became real.
Web's own `negotiations.$id.tsx` never had this bug — it already resolved the real
transaction id via `fetchMyTransactions()` before navigating.

**Fix:** added the same `handleContinueTransaction()` resolution logic to mobile's
negotiation detail screen (locate the transaction whose `negotiation_id` matches, then
navigate to its real id), with loading/error states (`negotiationDetail.agreed.
openingTransaction`/`continueTransactionFailed`) matching web's own UX for this action.

## Deliberate, documented platform differences (not gaps)

- **Compare/Partners/Projects not in web's top nav** — pre-existing decision from Phase-1
  Prompt 4 (`TopNav.tsx`'s own header comment); routes remain reachable via footer/in-page
  links. Mobile keeps Compare as a Profile row. Both are reachable; layout differs by
  design.
- **Agreement Summary is a separate route on web, inline on mobile** — mobile has no
  precedent for nesting a second dynamic segment under an already-dynamic `[id]` route;
  inlining uses the same data/disclaimer with zero functional loss (documented in the
  negotiations implementation doc).
- **Property Intelligence's area-intelligence embed differs in shape** — mobile's
  pre-existing `PropertyAreaInsights` (schools/hospitals/scores) predates this feature and
  was kept rather than force-fitting web's newer "typical range" embed onto a differently
  scoped component.
- **No standalone web profile/account page** — account info surfaces in the dropdown
  header + Notification Settings only; every capability a mobile Profile row exposes has
  a working web equivalent, so this is a layout difference, not a missing capability.

## Findings explicitly out of scope for this session

- **Mobile has no Phase-1 feature-flag gating** (`mobile/app/` never reads any
  flag/env-based conditional — confirmed by grep), while web gates
  off-plan-projects/short-stay-booking/financing behind `PHASE1_FLAGS`. Concretely:
  mobile's Projects and Bookings tabs are `href: null` (unreachable via nav — no
  `router.push`/`Link` anywhere targets them, so they're *effectively* hidden already),
  but a bookable property's detail screen still renders the live short-term-booking
  calendar unconditionally, and `my-bookings.tsx` is a dead end with nothing linking to
  it. This is a pre-existing gap already documented in `mymakan-phase1.md`'s "Known
  limitations" ("Mobile app has no Phase-1 gating at all"), and this session's brief
  explicitly excludes financing/booking work. **Status: Deferred**, not fixed — flagged
  here rather than silently left out. A future prompt should either build a
  `PHASE1_FLAGS`-equivalent for mobile or remove the orphaned Projects/Bookings/My
  Bookings screens outright.
- **Recently Viewed** is absent on both platforms — listed as "if present" in the audit
  brief; since neither platform has it, this is not a parity gap, just a feature neither
  side has built yet.

## Testing

- `frontend/`: `npx tsc --noEmit` — clean. `npm run build` — clean (Vite + Nitro SSR,
  `.output/` generated with no errors, incl. the Transaction Workspace routes).
- `mobile/`: `npx tsc --noEmit` — clean (`strict: true`, incl. the Transaction Workspace
  screens/components and their React Native `FormData` upload path). No build script
  exists in `mobile/package.json` (consistent with every prior prompt's own bar in this
  codebase — `expo run:android`/`expo run:ios` require a device/emulator); no Jest/test
  runner exists either, so mobile coverage here is typecheck + manual review, same bar
  every other mobile feature in this repo uses.
- `backend/`: full transaction-related suite (`test_property_transactions.py` +
  `test_transaction_progress.py` + `test_transactions_api.py` +
  `test_partner_transactions.py` + `test_transaction_notifications.py` +
  `test_transaction_ai.py` + `test_admin_transactions.py` + `test_negotiations.py` +
  `test_partner_negotiations.py`) — 187 passed, no regressions. (The original two P1
  fixes above predate this feature and needed no backend changes.)

## Completion matrix

| Feature | Web | Mobile | Final Status | Notes |
|---|---|---|---|---|
| Rent/Buy/Map/List discovery + filters | ✓ | ✓ | Full Parity | |
| Property detail + Save + Saved notes | ✓ | ✓ | Full Parity | Notes fixed this session |
| Compare | ✓ | ✓ | Equivalent Platform UX | Different nav placement, same capability |
| Saved searches + alerts | ✓ | ✓ | Full Parity | |
| Notifications (center + settings) | ✓ | ✓ | Full Parity | |
| Leads (inquiry, list, detail, chat) | ✓ | ✓ | Full Parity | |
| Mediator profile + reviews | ✓ | ✓ | Full Parity | |
| Area Intelligence + Methodology | ✓ | ✓ | Full Parity | |
| Rent estimate | ✓ | ✓ | Full Parity | Same client-side model both platforms |
| AI Advisor | ✓ | ✓ | Full Parity | |
| AI Home Finder (full flow) | ✓ | ✓ | Full Parity | |
| Property Intelligence (full stack) | ✓ | ✓ | Equivalent Platform UX | Area-intelligence embed shape differs by design |
| Trust Center (badge, sheet, report) | ✓ | ✓ | Full Parity | |
| Viewing management (full flow) | ✓ | ✓ | Full Parity | Nav entry point fixed this session |
| Negotiations (full flow) | ✓ | ✓ | Equivalent Platform UX | Agreement Summary inline vs. separate route |
| Transaction Workspace (full flow) | ✓ | ✓ | Equivalent Platform UX | Vertical stepper + no separate Checklist tab on mobile; "Continue Transaction" id bug fixed |
| Profile/account, language, RTL, auth | ✓ | ✓ | Equivalent Platform UX | Web has no standalone profile page; not a capability gap |
| Recently viewed | — | — | Deferred | Not built on either platform |
| Off-plan projects / short-stay booking gating | Gated (`PHASE1_FLAGS`) | Ungated (no flag system on mobile) | Backend Missing (mobile-side gating) | Pre-existing, documented, out of scope this session |
