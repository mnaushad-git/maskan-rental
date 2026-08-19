# myMakan AI Negotiation & Offer Management — Copy-Paste Session Prompts

Companion to the original "myMakan AI Negotiation & Offer Management" brief, same pattern
as `MYMAKAN_PHASE1_PROMPTS.md` / `MYMAKAN_PROPERTY_INTELLIGENCE_PROMPTS.md` /
`MYMAKAN_VISIT_VIEWING_PROMPTS.md`. Run these **in order, one per fresh Claude Code
window/session**. Each prompt is self-contained: it lists exactly which files to read (so
the session doesn't re-explore the whole repo) and exactly when to stop. Do not paste two
prompts into the same session — that is what causes session-limit blowouts.

Working directory: repo root. Branch: `feature/mymakan-phase1` (current branch — stay on
it unless told otherwise).

All progress is tracked in `docs/implementation/mymakan-negotiations.md` (created in
Prompt 1). If a session runs out before finishing its prompt, the next session should read
that doc first to see what's already done.

**Note on `CLAUDE.md`:** there is no repo-root `CLAUDE.md` or `AGENTS.md` in this project
(only `mobile/CLAUDE.md`, itself just `@AGENTS.md` — a 3-line warning to check versioned
Expo docs before writing mobile code). Prompts below that say "read `mobile/CLAUDE.md`"
only apply to the mobile prompts.

**Ground truth already gathered** (so later prompts don't need to re-discover it):

- **Both companion features this brief leans on are already 100% built and committed** —
  this changes the brief's shape: it is NOT a green-field build of fair-range math or a
  viewing→negotiation hook, it's additive on top of working infrastructure. Specifically:
  - **Property Intelligence's negotiation math already exists**:
    `backend/app/services/negotiation_intelligence.py` — `negotiation_insight(prop,
    price_intelligence) -> NegotiationInsight | None` (line 26) returns `None` unless
    `price_intelligence.sufficient_data` is `True`; `NegotiationInsight` has
    `asking_price`, `market_midpoint`, `discussion_range_low`, `discussion_range_high`,
    `approach` text. `backend/app/services/price_intelligence.py` —
    `rent_price_intelligence`/`buy_price_intelligence` (lines 144/175), fair range via
    interquartile spread around median, `MIN_COMPARABLES = 3` (line 30), classification
    Excellent/Good/Fair/Above/Significantly-Above via `_classify()` (41-50). A registered
    AI prompt `PROPERTY_NEGOTIATION_MESSAGE` already exists
    (`backend/app/core/ai/prompts.py:308-328`) and is already wired into
    `POST /properties/{id}/ai-summary` (`backend/app/api/routes/properties.py:488-513`,
    `variant: "summary"|"negotiation_message"`, 422 if `negotiation_intelligence is None`).
    It's already rendered on Property Detail as `NegotiationInsightCard` — web
    (`frontend/src/routes/property.$id.tsx:1434`, rendered 350) and mobile
    (`mobile/app/property/[id].tsx:1312`, rendered 490) — with a "Draft message" → editable
    textarea → send-via-ContactModal/WhatsApp/lead-note flow. **Reuse all of this as the
    grounding for the new Offer's initial ask and message drafting. Do not reimplement fair
    range/discussion range math or re-register a duplicate AI template.**
  - **Visit & Viewing Management is fully built**: `backend/app/models/property_viewing.py`
    (`PropertyViewing`, `id: int` PK, `status` values including terminal `"completed"`,
    `lead_id` nullable FK). The brief's "allow access from Completed Viewing" already has a
    real hook to extend: on a completed viewing with "Very Interested" feedback, the app
    shows a suggested-actions row including **"Ask AI about negotiation"**, which today
    just deep-links to `/advisor` with a canned question — web
    `frontend/src/routes/viewings.$id.tsx:726`, mobile `mobile/app/viewings/[id].tsx:573`.
    **Retarget this existing hook to "Make an Offer" instead of adding a parallel entry
    point.**
  - **What's genuinely net-new**: a formal, stateful Offer/counter-offer object (create,
    counter, accept, reject, withdraw, partner inbox). Confirmed by repo-wide grep: no
    `Offer`/negotiation model, schema, route, or table exists anywhere outside
    `negotiation_intelligence.py` itself (which is deterministic math, not a persisted
    entity).
- `backend/app/models/property.py`: `id: int` PK, `listing_type: str` default `"rent"`
  (line 18, values `"rent"`/`"sale"` — **not** `transaction_type`, mirror the viewing
  feature's decision: read `listing_type` at the model layer, expose either name in
  API-facing schemas but don't introduce a second competing field), `mediator_id: int |
  None` FK `mediators.id` SET NULL (29, direct ownership — no lead indirection needed),
  `status: str` default `"Published"` (24) — **`"Published"` is the active/available
  value**, matches what `create_viewing()` and `comparable_properties.py:96` already check.
  No dedicated currency column — SAR is hardcoded everywhere in this codebase (e.g.
  `f"SAR {midpoint:,.0f}"` in negotiation copy); do the same, don't add a currency field
  that has no other value anywhere in the system.
- `backend/app/models/lead.py` (114 lines, full file already read for prior features):
  `Lead` has **no `property_id`** — area/city-based, linked to a property only via
  `LeadSuggestion(lead_id, property_id)` (line 48). **`LeadMessage` model already exists**
  (102-114: `lead_id`, `sender_user_id`, `sender_role: "customer"|"mediator"`, `content`,
  `is_read`, `created_at`) with working endpoints (`fetchLeadMessages`/`sendLeadMessage` in
  `maskan.ts`) — **this is the "existing lead messaging for free-form conversation" the
  brief's §12/§18 point at. Do not build a second chat/messaging model.** Lead-linking
  decision already made for viewings (reuse it, don't re-litigate): attach a negotiation's
  `lead_id` only when an existing `LeadSuggestion(lead_id, property_id)` row already links
  the customer's lead to this exact property; never auto-create a Lead.
- Mediator authorization is **direct ownership**, not lead-based. Canonical pattern:
  `backend/app/api/routes/partner_quality.py:99-103` — `Depends(get_mediator_user)` (in
  `backend/app/api/deps.py`, returns `tuple[User, Mediator]`) then
  `if prop.mediator_id != mediator.id: raise HTTPException(403, "Not your listing")`. Exact
  viewing-domain mirror to copy: `backend/app/api/routes/partner_viewings.py:34-40`'s
  `_load_owned_viewing()` helper — build a `_load_owned_negotiation()` the same shape.
- Event/notification pattern, mirror exactly: `backend/app/core/outbox.py` `EventType`
  class (17-68, dot-namespaced strings, most recent block is
  `# ── Visit & Viewing Management ──` at 63-68 — add a
  `# ── Negotiation & Offer Management ──` block the same way) +
  `record_event(db, *, event_type, aggregate_type, aggregate_id, payload) -> OutboxEvent`
  (71-87, `db.add()` only, caller commits). `backend/app/models/notification.py`
  `NOTIFICATION_TYPES` tuple (9-36, underscore-style, e.g. `"viewing_requested"`) +
  `dedupe_key = f"{event_type}:{aggregate_id}:{user_id}"` (truncated to 160 chars).
  **Worker template to mirror exactly**: `backend/app/tasks/viewing_notifications.py` (240
  lines, full file) — `_TITLES` dict en/ar → `_render()` → `_enqueue(event)` →
  `@register_handler(EventType.X)` dispatch fns → `_recipients_for_event()` (always
  excludes `payload.get("actor_user_id")`, never self-notify) → `_recipient_locale()` from
  most-recent `Device` row → Celery task with feature-flag check + dedupe-key pre-check +
  `_deliver(db, notification, ["in_app", "push"])` + `publish_invalidate(...)`.
- AI pattern to mirror for new negotiation-guidance/summary text:
  `backend/app/services/home_finder_ai.py::explain_match` (242-283) — plain-text facts
  block from deterministic inputs only, `try: gateway.run_chat(...) except Exception:
  return _deterministic_explanation(...), "fallback"`, never raises, returns `(text,
  generated_by)`. `run_chat` signature (`backend/app/core/ai/gateway.py:64-71`): `run_chat(
  *, model, system, tools, messages, max_tokens=1500) -> ChatResult`. Register new prompt
  templates in `backend/app/core/ai/prompts.py` via `_register(name, version, template)`
  (line 20) — same single registry, existing names include `PROPERTY_INTELLIGENCE_SUMMARY`
  (287), `PROPERTY_NEGOTIATION_MESSAGE` (308), `VIEWING_NEXT_STEPS` (351) — don't invent a
  second registry.
- Feature flag recipe (3 files, copy exactly): `FLAGS` dict entry in
  `backend/app/core/feature_flags.py:14-58` (e.g. `"visit_management":
  "FEATURE_VISIT_MANAGEMENT"` at line 57) → boolean `Settings` attribute in
  `backend/app/core/config.py` (e.g. `FEATURE_VISIT_MANAGEMENT: bool = True` at line 170)
  → commented example line in `backend/.env.example`. Plus a per-request
  `_require_enabled()` dependency (not just registration-time gating) — pattern at
  `backend/app/api/routes/viewings.py:28-33` / `partner_viewings.py:29-31`. New flag:
  `FEATURE_NEGOTIATIONS` / `"negotiations"`, default `True` (this repo's convention is to
  ship the current feature-first demo feature default-on, matching
  `FEATURE_VISIT_MANAGEMENT`/`FEATURE_PROPERTY_INTELLIGENCE`).
- Outbox+lead-create pattern to mirror for offer submission (`backend/app/api/routes/
  leads.py:82-120`): idempotency-key handling (`IdempotencyStore().begin(...)` → replay on
  match, 409 on conflict) → `db.flush()` (assigns id, no commit) → `record_event(...)` →
  `db.commit()` → `db.refresh(...)` → `enqueue(post_commit_job, ...)`. This exact 5-step
  sequence is the template for `POST /properties/{id}/negotiations`.
- Alembic: current head is `b1c2d3e4f5a6_add_property_viewings` (traced the full
  `down_revision` chain across all files in `backend/alembic/versions/` — it's the only
  revision not referenced as another file's `down_revision`). **Re-verify with
  `alembic heads` at the start of Prompt 1** — the head may have moved again since this
  research.
- Frontend web: `frontend/src/routes/property.$id.tsx` is **3904 lines**. Anchor points:
  `ContactModal` defined 2354/rendered 3693, `NegotiationInsightCard` defined
  1434/rendered 350, `sessionStorage.setItem("maskan_advisor_ctx", ...)` at 2915,
  `ViewingStatusBanner` already present (viewing feature). No "Make an Offer" string
  anywhere yet. `frontend/src/lib/api/maskan.ts` is **3425 lines** — exact template
  functions to copy for a new `negotiations` namespace: `createLead` (1515),
  `fetchMyLeads` (1530), `fetchPropertyIntelligence` (1094), `fetchPropertyAiSummary`
  (1105), and the whole viewing block (`createViewing` 1679 through `markViewingNoShow`
  1804) as the closest structural sibling. `frontend/src/routes/partner.tsx`:
  `NAV_ITEMS` array at line 319; the existing "Viewing Requests" nav entry (line 372) is a
  **separate routed page**, not a `view`-state toggle — follow this exact pattern for a new
  "Negotiations"/"Offers" nav entry. Existing routed partner files as structural templates:
  `partner.viewings.tsx` (213 lines, list) / `partner.viewings.$id.tsx` (411 lines, detail)
  / `viewings.tsx` (328 lines, customer list) / `viewings.$id.tsx` (811 lines, customer
  detail). **Gotcha, hits again here**: a `foo.bar.tsx` sibling of `foo.tsx` under TanStack
  Router's file-based routing needs `useRouterState` + a conditional `<Outlet/>` guard in
  the parent — documented in `docs/implementation/mymakan-viewings.md:624-634` and
  `:765-770`; a new `partner.negotiations.tsx` + `partner.negotiations.$id.tsx` will need
  the same guard added to `partner.tsx`. i18n: `property:` namespace at
  `frontend/src/lib/i18n/en.ts:529` / `ar.ts:521`.
- Mobile: `mobile/app/property/[id].tsx` — `handleContactAgent` at line 232,
  `ViewingStatusBanner` rendered 278/defined 768, `NegotiationInsightCard` defined
  1312/rendered 490. `mobile/app/_layout.tsx` `<Stack.Screen>` registrations at lines
  66-95 (includes `viewing/new` 76, `viewings/index` 77, `viewings/[id]` 78) — **every new
  routable file needs an explicit line added here, easy to forget** (bit the viewings work
  twice per its own tracking doc). `mobile/src/lib/api/maskan.ts` template functions:
  `createLead` (558), `fetchMyLeads` (597), and the viewing block `createViewing` (687)
  through `fetchViewingNextSteps` (746). i18n: `property:` namespace at
  `mobile/src/lib/i18n/en.ts:505` / `ar.ts:502`. Partner portal is **web-only** — there is
  no partner mobile app in this repo, so no mobile partner-side work is needed.
- Test conventions: `backend/tests/conftest.py` — `db_session` (savepoint-rollback against
  the real local Postgres, no separate test DB) and `client` (`TestClient(app)`, `get_db`
  overridden) — no role-specific fixtures, every test file builds its own users/mediators
  inline. Best structural templates: `backend/tests/test_viewings.py` (364 lines — note its
  autouse `_no_real_ai_calls` fixture at line 28 forcing `gateway.run_chat` to raise, so AI
  fallback paths are what run by default in tests; helpers `_make_user`/`_make_mediator`/
  `_make_property`/`_auth`/`_future`/`_payload`) and `backend/tests/test_partner_viewings.py`
  (258 lines, ownership-check 403 structure). Known pre-existing unrelated failing test to
  ignore in full-suite runs: `test_list_properties_date_range_filter_excludes_conflicting_booking`.
- `docs/implementation/` currently has: `mymakan-ai-home-finder.md`, `mymakan-phase1.md`,
  `mymakan-property-intelligence.md`, `mymakan-trust-center.md`,
  `mymakan-trust-center-prompts.md`, `mymakan-viewings.md`. No `mymakan-negotiations.md`
  yet — created fresh in Prompt 1.

---

## Prompt 1 — Feature flag + tracking doc + PropertyNegotiation/NegotiationOffer models + migration + schemas

```
Read only: docs/implementation/mymakan-viewings.md (skim structure only, as the
closest-sibling precedent), docs/implementation/mymakan-property-intelligence.md
(skim, for the negotiation_insight/PROPERTY_NEGOTIATION_MESSAGE section only),
backend/app/models/property_viewing.py (full file — closest structural
sibling: status-as-plain-string convention, transitions dict, FK/index
conventions), backend/app/models/lead.py (full file), backend/app/models/property.py,
backend/app/models/mediator.py, backend/app/models/notification.py,
backend/app/core/outbox.py, backend/app/core/feature_flags.py,
backend/app/core/config.py, backend/app/services/negotiation_intelligence.py
(full file — the NegotiationInsight dataclass this new domain must reuse, not
duplicate), backend/alembic/versions/ (run `alembic heads` in backend/ first
to confirm the current head, then read only the single most recent migration
file to confirm the pattern).

We are building myMakan's "AI Negotiation & Offer Management" feature — full
scope lives only in the user's original brief (not in this repo); this prompt
file breaks it into small steps. Do NOT read ahead into later prompts' scope.
We are in feature-first investor-demo mode: Rent + Buy, customer mobile +
customer web + partner portal, reusing existing auth/leads/viewings/property
intelligence/notifications/AI gateway. Explicitly out of scope for the whole
feature: payments, reservation payment, Ejar, Nafath, contract generation,
legal signing, financing, mortgage, escrow, new Redis/queue/microservice
infra, external integrations, a second messaging/chat platform (reuse
LeadMessage for free-form conversation).

IMPORTANT — two companion features this depends on are already fully built,
confirm this yourself by reading the files above rather than assuming: (1)
`negotiation_intelligence.py::negotiation_insight(prop, price_intelligence) ->
NegotiationInsight | None` already computes asking price / market midpoint /
discussion range / approach text, already exposed via
`GET /properties/{id}/intelligence` and already rendered as
`NegotiationInsightCard` on Property Detail (web + mobile) with a working
"Draft message" flow via `PROPERTY_NEGOTIATION_MESSAGE`. (2) PropertyViewing
is fully built with a `"completed"` terminal status and `lead_id` linking.
Reuse both; do not reimplement fair-range math or a viewing model.

Task:
1. Add feature flag `FEATURE_NEGOTIATIONS` (default True) to
   `feature_flags.py`'s `FLAGS` dict and `config.py`'s `Settings`, exactly
   following the `visit_management` pattern. Add a commented example line to
   `backend/.env.example` too.
2. Create `docs/implementation/mymakan-negotiations.md` with section headers
   (fill what you know now, leave the rest `TODO — filled in by a later
   prompt`): Feature completed / Existing functionality reused / Models /
   APIs / Status flow / Property Intelligence integration / Viewing
   integration / Lead integration / AI behavior (guidance + draft message) /
   Notifications / Screens changed / Tests / Known limitations / Investor
   demo instructions. Explicitly document: (a) the decision to reuse
   `negotiation_insight()`/`PROPERTY_NEGOTIATION_MESSAGE` rather than
   duplicate fair-range math, (b) the lead-linking decision (attach via
   existing `LeadSuggestion(lead_id, property_id)` match only, never
   auto-create a Lead — same as the viewings feature), (c) no dedicated
   `draft` status is persisted — a negotiation row is only created once the
   customer actually submits their first offer (status starts at
   `submitted`); the "Enter Amount → Review" steps before that are
   frontend-only state, per "do not create unnecessary complexity."
3. Create `backend/app/models/property_negotiation.py`:
   - `PropertyNegotiation`: `id: int` PK, `property_id` FK `properties.id`
     CASCADE, `customer_user_id` FK `users.id` RESTRICT, `mediator_id` FK
     `mediators.id` SET NULL (nullable, copied from `Property.mediator_id` at
     creation — same convention as `PropertyViewing.mediator_id`), `lead_id`
     FK `leads.id` SET NULL nullable, `viewing_id` FK `property_viewings.id`
     SET NULL nullable, `transaction_type: str` (copied from
     `Property.listing_type` at creation time — store the copy so a later
     listing edit can't retroactively change a live negotiation's type; do
     NOT read `listing_type` live via a relationship for this field),
     `status: str` default `"submitted"` — values (a module-level tuple,
     mirror `PROPERTY_VIEWING_STATUSES`'s convention): `submitted`,
     `countered`, `accepted`, `rejected`, `withdrawn`, `closed` (no separate
     `draft`/`expired` persisted status per the doc decision above — `closed`
     covers any terminal wrap-up state a later prompt might need; skip
     `expired` entirely unless Prompt 3/4 finds a concrete need, don't build
     an expiry cron for a feature-first demo), `current_offer_amount:
     Numeric`, `original_listing_amount: Numeric` (snapshot of
     `Property.monthly_rent`/`sale_price` at creation), `created_at`,
     `updated_at`, `accepted_at`, `rejected_at`, `closed_at` (all nullable
     timestamps except `created_at`/`updated_at`). Explicit
     `PROPERTY_NEGOTIATION_TRANSITIONS` dict (plain lookup, mirror
     `PROPERTY_VIEWING_TRANSITIONS`'s shape exactly — the brief explicitly
     says avoid complex state machines).
   - `NegotiationOffer`: `id: int` PK, `negotiation_id` FK
     `property_negotiations.id` CASCADE, `offered_by_user_id` FK `users.id`
     SET NULL nullable (the acting user — customer or mediator's user
     account, whichever placed this specific offer row), `amount: Numeric`,
     `message: Text | None`, `offer_type: str` (`customer_offer`,
     `mediator_counter`, `customer_counter`), `status: str` default
     `"pending"` (`pending`, `accepted`, `rejected`, `superseded` — set to
     `superseded` when a newer offer/counter is placed on the same
     negotiation; this is what backs "only latest active offer can be
     accepted"), `expires_at: DateTime | None` (column present per the
     brief's "if used" but NOT enforced by any background job in this
     feature-first build — document as a known limitation), `created_at`.
   Indexes: `(customer_user_id, status)`, `(mediator_id, status)` on
   `PropertyNegotiation` (mirror `PropertyViewing`'s index convention), plus
   `(property_id, customer_user_id)` — what the duplicate-active-negotiation
   check in Prompt 2 will query. Index `(negotiation_id, created_at)` on
   `NegotiationOffer`.
4. Add outbox `EventType` entries in `outbox.py` under a new
   `# ── Negotiation & Offer Management ──` block: `NEGOTIATION_SUBMITTED =
   "negotiation.offer_submitted"`, `NEGOTIATION_COUNTERED =
   "negotiation.counter_received"`, `NEGOTIATION_ACCEPTED =
   "negotiation.accepted"`, `NEGOTIATION_REJECTED = "negotiation.rejected"`,
   `NEGOTIATION_WITHDRAWN = "negotiation.withdrawn"` (names match brief §19
   exactly). Add matching underscore-style entries to `notification.py`'s
   `NOTIFICATION_TYPES` tuple: `negotiation_offer_submitted`,
   `negotiation_counter_received`, `negotiation_accepted`,
   `negotiation_rejected`, `negotiation_withdrawn`.
5. `backend/app/schemas/property_negotiation.py`: `NegotiationOfferCreate`,
   `NegotiationOfferOut`, `PropertyNegotiationOut` (include denormalized
   property title/image/district/listing amount and mediator display name so
   list/detail screens don't need N+1 fetches — mirror how
   `PropertyViewingDetailOut` denormalizes), `PropertyNegotiationDetailOut`
   (adds the full ordered offer history + the `NegotiationInsight` grounding
   from Prompt 1's reused service, embedded read-only). A separate
   timeline-shape schema is NOT needed — the timeline (brief §12) will be
   computed client-side from the offer list + status timestamps, same
   decision the viewings feature made for its own timeline.
6. Alembic migration for both new tables, chained onto the current head (from
   `alembic heads`).

Do not add any API route yet. Do not touch frontend or mobile. Run
`alembic upgrade head` in backend/ and confirm it applies cleanly, then
`alembic downgrade -1` and `alembic upgrade head` again to sanity-check
reversibility. Fill in the "Models" section of the tracking doc (including
the status-value table and the reuse/lead-linking/no-draft-status decisions).
Commit is not required. Stop there.
```

---

## Prompt 2 — Create-negotiation service + customer submit/list/detail APIs

```
Read only: docs/implementation/mymakan-negotiations.md,
backend/app/models/property_negotiation.py, backend/app/schemas/property_negotiation.py
(from Prompt 1), backend/app/api/routes/leads.py (full file — exact template
for idempotency-key handling ~lines 82-91/122-124, outbox event write inside
the same transaction ~108-117, `enqueue()` post-commit job pattern ~120),
backend/app/services/property_viewing.py (the `_find_linked_lead_id()`
helper — reuse the identical lead-linking query, don't reimplement it),
backend/app/main.py (locate where existing routers are mounted, e.g.
`viewings.router`/`partner_viewings.router`, so the new router mounts the
same way), backend/app/core/feature_flags.py.

Task:
1. `backend/app/services/property_negotiation.py`:
   `create_negotiation(db, customer_user, property_id, amount, message,
   viewing_id=None) -> PropertyNegotiation`. Validates: property exists and
   `status == "Published"`; `mediator_id` copied from the property;
   `amount > 0`; no existing active negotiation (status not in
   `{accepted, rejected, withdrawn, closed}`) for this (customer_user_id,
   property_id) pair — raise a domain error the route layer turns into 409.
   If `viewing_id` is supplied, verify it belongs to this customer+property
   and is `completed` before attaching it (don't trust an arbitrary id from
   the client). Lead-linking: reuse `_find_linked_lead_id()`'s exact query
   pattern from `property_viewing.py` (existing `LeadSuggestion` match only,
   never auto-create). Creates the `PropertyNegotiation` row (`status =
   "submitted"`, `current_offer_amount = original_listing_amount = amount`
   — wait, `original_listing_amount` must be the property's actual listing
   price, `current_offer_amount` is the customer's amount, do not conflate
   them) plus the first `NegotiationOffer` row (`offer_type =
   "customer_offer"`, `offered_by_user_id = customer_user.id`, `status =
   "pending"`), and `record_event(..., event_type =
   EventType.NEGOTIATION_SUBMITTED, ...)`, all in one transaction (flush →
   record_event → commit → refresh), same shape as `leads.py`'s create_lead.
2. `backend/app/api/routes/negotiations.py` (new router, mounted in
   `main.py` the same way `viewings.router` is, gated behind
   `FEATURE_NEGOTIATIONS` via a `_require_enabled`-style dependency per the
   Prompt 1 flag):
   - `POST /api/v1/properties/{property_id}/negotiations` — accepts an
     `Idempotency-Key` header exactly like `POST /leads/` does (reuse the
     same `IdempotencyStore` mechanism).
   - `GET /api/v1/negotiations` — customer's own negotiations, optional
     `status` query filter, ordered by `updated_at` desc.
   - `GET /api/v1/negotiations/{id}` — 404 if not found, 403 if
     `negotiation.customer_user_id != current_user.id`. Returns
     `PropertyNegotiationDetailOut` (full offer history + embedded
     `NegotiationInsight` grounding, computed fresh via the existing
     `price_intelligence`/`negotiation_intelligence` services — do not
     persist a stale copy of market data on the negotiation row).
   - `GET /api/v1/properties/{property_id}/negotiations/active` — returns
     the customer's active negotiation for this property if one exists, else
     404; this is what the frontend's "Make an Offer" vs "View Negotiation"
     entry-point decision (brief §3) will call before deciding which CTA to
     show. (If this feels like route-count creep, folding the same lookup
     into an optional query param on the list endpoint is also acceptable —
     your call, document which you chose.)
3. Enqueue a notification-creation job after commit (new
   `backend/app/tasks/negotiation_notifications.py`, mirroring
   `viewing_notifications.py`'s event→Notification pattern exactly —
   `_TITLES`, `_render`, `_enqueue`, `@register_handler`, `_recipients_for_event`
   excluding the actor, dedupe-key pre-check) for `NEGOTIATION_SUBMITTED` —
   notify the mediator.

Tests in `backend/tests/test_negotiations.py` (new file — mirror
`test_viewings.py`'s helper style: `_make_user`/`_make_mediator`/
`_make_property`/`_auth`, autouse `_no_real_ai_calls` fixture, `pytestmark =
pytest.mark.skipif(not settings.FEATURE_NEGOTIATIONS, ...)`): create succeeds
with valid amount; rejects zero/negative amount; rejects duplicate active
negotiation for same customer+property; 404 on unknown property; 403 on
reading another customer's negotiation; lead-linking attaches when a matching
`LeadSuggestion` exists and stays null when it doesn't; viewing-linking
attaches only when the viewing is genuinely completed and belongs to this
customer+property; idempotency-key replay returns the same negotiation
without creating a duplicate; `original_listing_amount` correctly snapshots
the property's price at creation time.

No partner endpoints, no counter/accept/withdraw yet, no frontend/mobile
changes. Update the tracking doc's "APIs" (partial), "Property Intelligence
integration", "Viewing integration", and "Lead integration" sections. Run
`pytest backend/tests/test_negotiations.py -q`. Stop there.
```

---

## Prompt 3 — Customer-side transitions: counter-again, accept, withdraw

```
Read only: docs/implementation/mymakan-negotiations.md,
backend/app/services/property_negotiation.py,
backend/app/api/routes/negotiations.py (from Prompt 2),
backend/app/models/property_negotiation.py, backend/app/core/outbox.py.

Task:
1. In `property_negotiation.py`, add:
   - `submit_counter(db, actor_user, negotiation, amount, message,
     offer_type: "mediator_counter"|"customer_counter") ->
     PropertyNegotiation` — allowed only from `submitted`/`countered`; marks
     the negotiation's previous `pending` `NegotiationOffer` row `superseded`,
     inserts the new offer row (`status="pending"`), updates
     `current_offer_amount`, sets negotiation `status = "countered"`. Emits
     `NEGOTIATION_COUNTERED`. (This single function backs both the
     customer's "Counter Again" action and the mediator's "Counter Offer"
     action from Prompt 4 — same transition, different `offer_type`/actor.)
   - `accept_offer(db, actor_user, negotiation, actor_role:
     "customer"|"mediator") -> PropertyNegotiation` — only valid when the
     latest `NegotiationOffer` is `pending` AND was NOT placed by the
     accepting actor (a customer can't accept their own offer, a mediator
     can't accept their own counter) — enforce this explicitly, it's the
     brief's "only the latest valid counter, by the other party" rule.
     Marks that offer `status="accepted"`, sets negotiation `status =
     "accepted"`, `accepted_at = now()`. Emits `NEGOTIATION_ACCEPTED`.
   - `withdraw_negotiation(db, customer_user, negotiation, reason) ->
     PropertyNegotiation` — customer-only, allowed from
     `submitted`/`countered`; sets `status = "withdrawn"`,
     `cancellation_reason` (add this column to the model in this prompt —
     it was missed in Prompt 1's field list; also add `cancelled_by:
     str|None` for symmetry with the reject-side actor in Prompt 4). Emits
     `NEGOTIATION_WITHDRAWN`.
   Withdrawal/reject reason values from brief §11 (persist as free text with
   an optional matching enum-ish string on the frontend — backend just
   stores `reason: str`, don't over-engineer an enum column): customer
   withdrawal reasons "Changed mind" / "Found another property" / "Budget
   changed" / "Other"; mediator rejection reasons (used in Prompt 4) "Offer
   too low" / "Property no longer available" / "Owner declined" / "Other".
2. Add to `negotiations.py`:
   - `POST /api/v1/negotiations/{id}/offer` — customer counter-again
     (`submit_counter(..., offer_type="customer_counter")`), ownership check.
   - `POST /api/v1/negotiations/{id}/accept` — customer accepting the
     mediator's latest counter.
   - `POST /api/v1/negotiations/{id}/withdraw` — reason in body.
3. Wire each transition's notification via
   `negotiation_notifications.py` (Prompt 2's task file).

Tests (extend `test_negotiations.py`): counter-again updates
`current_offer_amount` and supersedes the prior pending offer; accept
rejected when the latest offer was placed by the same actor trying to accept
it (self-accept blocked); accept succeeds on the other party's latest
pending offer; withdraw persists reason and blocks further transitions;
invalid-transition rejections (e.g. accepting/countering an already
`accepted`/`withdrawn` negotiation → 409); ownership checks (403 on another
customer's negotiation); offer history remains intact (superseded rows not
deleted) after multiple rounds.

No partner endpoints yet, no AI guidance, no frontend/mobile. Update tracking
doc's "Status flow" section with the transition table (including the
self-accept-blocked rule). Run `pytest backend/tests/test_negotiations.py -q`.
Stop there.
```

---

## Prompt 4 — Partner portal backend: list, detail, counter, accept, reject

```
Read only: docs/implementation/mymakan-negotiations.md,
backend/app/services/property_negotiation.py (from Prompts 2-3),
backend/app/api/routes/partner_viewings.py (full file — this is your exact
template: standalone router file, `_load_owned_viewing()` ownership-check
helper, `get_mediator_user`, main.py mounting), backend/app/main.py (mounting
point only), backend/app/models/lead.py (LeadMessage — check what a mediator
is currently allowed to see of a customer via the existing lead detail
response, so the new negotiation detail response doesn't leak more).

Task:
1. `backend/app/api/routes/partner_negotiations.py` (new router, prefix
   `/partner/negotiations`, mounted in `main.py` alongside
   `partner_viewings`, gated behind `FEATURE_NEGOTIATIONS`, every endpoint
   using `Depends(get_mediator_user)` + a `_load_owned_negotiation()` helper
   mirroring `partner_viewings.py`'s `_load_owned_viewing()` exactly — 404 if
   not found, 403 "Not your listing" if `negotiation.mediator_id !=
   mediator.id`):
   - `GET /api/v1/partner/negotiations` — mediator's own negotiations across
     all their properties, `status` query filter, ordered by `updated_at`
     desc.
   - `GET /api/v1/partner/negotiations/{id}` — response schema must not
     expose more customer PII than the existing partner lead detail view
     does (check and match that bar — brief §8/§26 explicitly call this out;
     no private viewing notes, no other customers' negotiations, no other
     mediators' negotiations).
   - `POST /api/v1/partner/negotiations/{id}/counter` — reuses Prompt 3's
     `submit_counter(..., offer_type="mediator_counter")`.
   - `POST /api/v1/partner/negotiations/{id}/accept` — reuses Prompt 3's
     `accept_offer(..., actor_role="mediator")`.
   - `POST /api/v1/partner/negotiations/{id}/reject` — new
     `reject_negotiation(db, mediator_user, negotiation, reason) ->
     PropertyNegotiation`: valid from `submitted`/`countered`, sets `status =
     "rejected"`, `rejected_at`, `cancellation_reason`, `cancelled_by =
     "mediator"`. Mediator reason list from brief §11 (Prompt 3's list).
     Emits `NEGOTIATION_REJECTED`.
2. Wire notifications for counter/accept/reject via
   `negotiation_notifications.py` (Prompt 2's task file), matching
   event→notification mapping including `negotiation_counter_received` for
   the customer.

Tests in `backend/tests/test_partner_negotiations.py` (mirror
`test_partner_viewings.py`'s ownership-check structure): counter from
`submitted`/`countered`; accept only the customer's latest pending offer
(mediator can't accept their own counter); reject with mediator reason;
403 when mediator doesn't own the property (a second mediator's property);
PII exposure check (assert no customer email/phone leaks beyond what the
existing partner lead view already exposes).

This completes the entire backend transition surface. No AI guidance yet, no
frontend/mobile. Update tracking doc's "APIs" section (full backend surface
for submit/counter/accept/reject/withdraw now done) and "Notifications"
section. Run
`pytest backend/tests/test_partner_negotiations.py backend/tests/test_negotiations.py -q`.
Stop there.
```

---

## Prompt 5 — Negotiation strength signals + AI guidance ("Ask myMakan") + AI negotiation summary

```
Read only: docs/implementation/mymakan-negotiations.md,
backend/app/models/property_negotiation.py, backend/app/services/negotiation_intelligence.py
(full file — the NegotiationInsight this reuses), backend/app/services/price_intelligence.py
(_classify() thresholds only — the signal thresholds below should be
consistent with these, not invent a second scale), backend/app/services/home_finder_ai.py
(explain_match, full function — the grounded-narration-with-fallback pattern
to mirror exactly), backend/app/core/ai/prompts.py (registry pattern + read
PROPERTY_NEGOTIATION_MESSAGE in full for tone/structure), backend/app/core/ai/gateway.py
(run_chat signature only), backend/app/api/routes/negotiations.py (current
state after Prompts 2-3), backend/app/api/routes/ai.py (rate_limit_dependency
usage only — reuse it, don't reinvent rate limiting).

Task, all in new files under backend/app/services/:
1. `negotiation_signals.py`: deterministic (no LLM) —
   `compute_negotiation_signal(offer_amount, price_intelligence) ->
   NegotiationSignal` returning one of: `within_market_range`,
   `below_market_range`, `above_market_range`, `close_to_asking_price`,
   `significant_discount_requested`, `limited_comparable_data` (brief §14
   exact names), each with a one-line deterministic label + the numeric
   basis (e.g. "SAR 68K is within the estimated SAR 64K–71K market range").
   Returns `limited_comparable_data` whenever `price_intelligence.
   sufficient_data` is `False` — never fabricates a signal from insufficient
   data. Use `price_intelligence.py`'s existing deviation thresholds for
   consistency (e.g. "close to asking" vs "significant discount" should read
   naturally against the same percentage bands already defined there —
   reuse the constants via import, don't hardcode a second copy of the same
   numbers).
2. Register a new prompt `NEGOTIATION_GUIDANCE` in `prompts.py` (instructions
   modeled on `PROPERTY_NEGOTIATION_MESSAGE`'s existing grounding rules):
   explain the negotiation's current position using ONLY the given
   deterministic facts (asking price, current/counter amounts, market
   range/midpoint from `negotiation_insight`, the offer history, the
   negotiation signal from step 1) — must NOT invent comparables, guarantee
   acceptance, claim owner intent, or give legal advice; explicitly instruct
   it to say so plainly when `price_intelligence.sufficient_data` is False
   rather than inventing a "mathematically optimal offer" (brief §13's exact
   requirement).
3. `negotiation_ai.py`:
   - `generate_guidance(negotiation, offers, price_intelligence,
     negotiation_insight, language) -> tuple[str, str]` ("Ask myMakan" —
     answers questions like "is my offer reasonable / how far below asking /
     what should I say" per brief §5) — same `try: run_chat(...) except:
     deterministic fallback` shape as `explain_match`; the deterministic
     fallback is a short templated sentence built from the negotiation
     signal + numeric gap, always useful, never blocks.
   - `generate_summary(negotiation, offers, price_intelligence,
     negotiation_insight, language) -> str` ("myMakan Summary" for brief
     §21, e.g. "You started at X against an asking rent of Y... remaining
     difference is Z") — **deterministic only, no AI call**, built directly
     from the offer history + market data; keep this fast/free since it
     renders automatically on every negotiation detail view, not on request.
     Document this AI-vs-deterministic split explicitly in the tracking doc.
4. `POST /api/v1/negotiations/{id}/ai-guidance` in `negotiations.py` — body
   `{question?: str, language: "en"|"ar"}` (an optional free-text question
   lets "Ask myMakan" answer the specific brief §5 question list without
   needing 6 separate endpoints), rate-limited the same way existing AI
   endpoints are, gated behind `FEATURE_NEGOTIATIONS`. Embed `generate_summary`'s
   deterministic output directly in `PropertyNegotiationDetailOut` (Prompt
   2's response) as a `summary_text` field — no separate round trip needed
   to see it.

Tests in `backend/tests/test_negotiation_signals.py` and
`backend/tests/test_negotiation_ai.py`: all 6 signal values reachable with
correct thresholds; `limited_comparable_data` when insufficient; AI guidance
grounding (mock `run_chat`, assert only real facts reach the prompt — no
fabricated comparables/guarantees); AI failure falls back to deterministic
guidance; summary is deterministic and stable without mocking AI at all;
Arabic language output requested and returned for guidance.

No frontend/mobile changes. Update tracking doc's "AI behavior" section
(signal thresholds, the AI-guidance-vs-deterministic-summary split, grounding
rules). Run
`pytest backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py -q`.
Stop there.
```

---

## Prompt 6 — Draft negotiation message + Agreement Summary computation + notification content polish

```
Read only: docs/implementation/mymakan-negotiations.md,
backend/app/services/negotiation_ai.py (from Prompt 5),
backend/app/core/ai/prompts.py (PROPERTY_NEGOTIATION_MESSAGE, full template),
backend/app/services/property_intelligence_ai.py (summarize_property_intelligence,
full function — the existing "variant" parameter pattern this prompt extends),
backend/app/api/routes/properties.py (lines ~480-513, the existing
POST /properties/{id}/ai-summary endpoint, full route only),
backend/app/tasks/negotiation_notifications.py (from Prompts 2-4).

Task:
1. Extend `property_intelligence_ai.py`'s existing `variant ==
   "negotiation_message"` path (or add a small sibling function if cleaner —
   your call, document it) to optionally accept a `negotiation` +
   `offer_history` context so the drafted message can reference an
   in-progress negotiation's actual numbers (e.g. "I'd like to offer SAR
   68,500..." for a fresh negotiation vs. "Following your counter of SAR
   70,000, I'd like to propose SAR 69,500..." mid-negotiation) rather than
   always drafting a first-contact message. Keep the existing no-negotiation
   call path (used directly from Property Detail before any offer exists)
   working unchanged. This satisfies brief §6 ("Draft Message with AI")
   without adding a second AI endpoint — the existing
   `POST /properties/{id}/ai-summary?variant=negotiation_message` gains an
   optional `negotiation_id` body field; when present and owned by the
   requesting customer, ground the draft in it.
2. Confirm the drafted message is always returned into an editable field,
   never auto-sent — this is enforced at the frontend layer (Prompts 7-9),
   but note it explicitly in the tracking doc as a hard requirement for
   those prompts to respect.
3. Add a small deterministic helper to `property_negotiation.py` (or a new
   `negotiation_agreement.py`): `build_agreement_summary(negotiation, offers,
   property) -> AgreementSummary` — property/customer/mediator/transaction
   type/original asking amount/final agreed amount/date-time/negotiation
   reference, used by `GET /negotiations/{id}` when `status == "accepted"`
   (add as an optional field on `PropertyNegotiationDetailOut`, populated
   only when accepted) — this backs brief §22's Agreement Summary screen
   without a new endpoint.
4. Polish `negotiation_notifications.py`'s `_TITLES`/`_render()` content to
   match the brief's exact example copy style (§19): "New counter offer" /
   "The mediator proposed SAR X for the apartment in {district}",
   "New offer received" / "SAR X offer received for {property title}", with
   a deep-link payload (`negotiation_id`) the frontend can route on — mirror
   `viewing_notifications.py`'s deep-link payload shape exactly.

Tests: extend `backend/tests/test_negotiation_ai.py` for the message-drafting
grounding (mid-negotiation draft references the correct current amounts, no
fabricated numbers), and `backend/tests/test_negotiations.py` for
`build_agreement_summary` (correct fields, only populated when accepted,
absent/null otherwise) and notification content (assert rendered title/body
strings match the expected template for each event type in both languages).

This completes the entire backend surface for the feature. No frontend/mobile
changes yet. Update tracking doc's "AI behavior" (message-drafting section)
and begin "Screens changed" with a note that backend is complete. Run
`pytest backend/tests/test_negotiations.py backend/tests/test_partner_negotiations.py backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py -q`
plus a full-suite smoke check (`pytest -q`, note only the known pre-existing
`test_list_properties_date_range_filter_excludes_conflicting_booking` failure
if it appears). Stop there.
```

---

## Prompt 7 — Web: Make an Offer flow + Property Detail entry points

```
Read only: docs/implementation/mymakan-negotiations.md,
frontend/src/routes/property.$id.tsx (skim structure only — it's ~3900
lines; locate `NegotiationInsightCard` (defined 1434, rendered 350),
`ContactModal` (defined 2354, rendered 3693), `ViewingStatusBanner`, and the
sessionStorage advisor handoff (~2915) as anchor points for where a new
"Make an Offer" CTA / "View Negotiation" CTA and modal/flow should live),
frontend/src/lib/api/maskan.ts (viewing block `createViewing` 1679 through
`markViewingNoShow` 1804 as the closest structural template; also
`fetchPropertyIntelligence` 1094 / `fetchPropertyAiSummary` 1105),
frontend/src/lib/i18n/en.ts and ar.ts (`property:` namespace, ~521-529),
frontend/src/routes/viewings.$id.tsx (line ~726, the existing "Ask AI about
negotiation" deep link to `/advisor` — this prompt retargets it).

Task:
1. Add to `maskan.ts`: `createNegotiation(propertyId, payload)`,
   `fetchMyNegotiations(status?)`, `fetchNegotiation(id)`,
   `fetchActiveNegotiation(propertyId)` — matching the exact backend request/
   response shapes from Prompts 1-2, same `requestJson` pattern as
   `createViewing`.
2. On `property.$id.tsx`: add a **Make an Offer** CTA near the existing
   Contact Agent / Schedule Viewing CTAs, hidden when
   `property.status !== "Published"` (brief §3's "do not show for
   inactive/unavailable properties"). Before showing it, call
   `fetchActiveNegotiation` — if an active negotiation already exists for
   this user/property, show **View Negotiation** (linking to Prompt 8's
   detail screen) instead of the Make an Offer flow.
3. Build the Make an Offer flow per brief §3-4 as a modal or stepper
   (whichever fits this codebase's existing modal patterns better — check
   `ContactModal`'s structure first): Offer Intelligence (reuse the already-
   rendered `NegotiationInsightCard`'s data — listing price, market range,
   discussion range from `negotiation_intelligence`; when
   `price_intelligence.sufficient_data` is false, show **"Limited market
   data — make an offer based on your own preference"** instead of a range,
   per brief §4) → Enter Amount → optional Message (with a **Draft with AI**
   action calling the Prompt 6 endpoint, editable, never auto-sent) → Review
   → Submit.
4. After submission, show a confirmation state and link into Prompt 8's
   Negotiation Detail screen.
5. Retarget the existing "Ask AI about negotiation" hook on completed
   viewings (`viewings.$id.tsx:~726`) to open the Make an Offer flow
   (pre-filled with `viewing_id`) instead of deep-linking to `/advisor`.

New i18n keys under `property.negotiation.*` in both `en.ts`/`ar.ts`
(RTL-safe). Verify `npx tsc --noEmit` and `npx vite build` in `frontend/`,
both clean. Start the dev server and manually check the flow on a real rent
property and a real sale property from the dev DB (submit an offer, confirm
the flow completes with no console errors, confirm re-opening the property
shows "View Negotiation" instead of "Make an Offer"). Update tracking doc's
"Screens changed" (web, partial). Stop there.
```

---

## Prompt 8 — Web: Negotiation Detail screen (timeline, counter, accept, withdraw, Ask myMakan)

```
Read only: docs/implementation/mymakan-negotiations.md,
frontend/src/routes/property.$id.tsx (current state after Prompt 7, for the
CTA/entry-point wiring to link into), frontend/src/lib/api/maskan.ts
(negotiation functions from Prompt 7), frontend/src/routes/viewings.$id.tsx
(full file — closest structural sibling: timeline rendering from timestamp
fields, action-per-status pattern, AI-guidance button pattern if one already
exists there — reuse the same layout conventions).

Task:
1. Add to `maskan.ts`: `submitCounterOffer(id, payload)`, `acceptNegotiation(id)`,
   `withdrawNegotiation(id, reason)`, `fetchNegotiationGuidance(id, question?,
   language)` — matching Prompts 3 and 5's backend endpoints.
2. New route `frontend/src/routes/negotiations.$id.tsx`: Negotiation Detail
   per brief §12/§9 — Property block (image/title/district/listing price/
   View Property), current offer vs. listing comparison with clear money
   typography, negotiation strength signal badge (from Prompt 5's
   `negotiation_signals`, embedded in the detail response), the deterministic
   `summary_text` ("myMakan Summary" from Prompt 5/6) rendered as a card,
   Timeline (derive from the offer list + status timestamps — Customer Offer
   / Mediator Counter / Customer Counter / Accepted, each with amount +
   time, per brief §12's exact example shape), Actions matching current
   status (Accept / Counter Again / Withdraw / **Ask myMakan**).
3. **Ask myMakan** panel: calls `fetchNegotiationGuidance`, shows the
   grounded response, makes clear (per brief §13) that this is not a
   mathematically optimal offer when confidence is low.
4. Counter-again UI: amount + optional message (with the same **Draft with
   AI** action as Prompt 7's flow, reusing the extended `ai-summary`
   endpoint with `negotiation_id`).
5. Withdraw UI: reason selection (brief §11 customer list) + optional free
   text.
6. When `status === "accepted"`, redirect/link to Prompt 9's Agreement
   Summary screen instead of showing counter/withdraw actions.

New i18n keys, RTL-checked. Verify `npx tsc --noEmit` + `npx vite build`
clean. Manually walk: submit an offer (Prompt 7) → open the negotiation
detail → Ask myMakan → counter again → confirm the timeline updates. Update
tracking doc's "Screens changed" (web, negotiation detail). Stop there.
```

---

## Prompt 9 — Web: My Negotiations page + Offer Agreed + Agreement Summary

```
Read only: docs/implementation/mymakan-negotiations.md,
frontend/src/routes/negotiations.$id.tsx (from Prompt 8),
frontend/src/routes/viewings.tsx (full file — closest structural sibling for
a tabbed, status-filtered customer list page), frontend/src/lib/api/maskan.ts
(negotiation functions from Prompts 7-8), frontend/src/components/maskan/PropertyCard.tsx.

Task:
1. New route `frontend/src/routes/negotiations.tsx`: **My Negotiations** per
   brief §20 — tabs Active / Accepted / Closed (mapping the backend's
   `submitted`/`countered` → Active, `accepted` → Accepted, `rejected`/
   `withdrawn`/`closed` → Closed; document the mapping in the tracking doc).
   Cards: property image/title, listing amount, current offer, status,
   last activity, mediator. Actions: Open / Ask myMakan / Message Mediator
   (the last reusing the existing lead-message thread — brief §12/§18's
   "do not duplicate full chat" instruction, link into whatever the leads
   feature already uses for this, e.g. `partner.leads.$leadId.tsx`'s
   customer-side equivalent if one exists, or the lead detail route).
   Skeleton loading, empty-per-tab, error/retry states. Reachable from the
   customer web account area (check where "My Viewings"/"My Leads" are
   currently linked from and add a sibling entry).
2. On accept (either side accepting, detected via the negotiation's
   `status === "accepted"`), show an **Offer Agreed** state on
   `negotiations.$id.tsx` per brief §10 — agreed amount, and the required
   disclaimer copy verbatim: **"This records the commercial agreement in
   myMakan. It is not the legal rental/purchase contract."** Actions: View
   Agreement Summary / Message Mediator / Continue Transaction (the last
   pointing to a simple placeholder route — e.g. a static
   `/transaction/{negotiationId}` page with a "Coming soon" state — brief
   explicitly allows this placeholder in this session, do NOT build real
   contract/payment logic behind it).
3. New route `frontend/src/routes/negotiations.$id.agreement.tsx` (or a
   dedicated view/section on the detail route — your call, document it):
   **Offer Agreement Summary** per brief §22, rendering the backend's
   `AgreementSummary` (Prompt 6) fields, with the same disclaimer sentence
   repeated verbatim. Download/share omitted (brief explicitly allows
   skipping unless trivial — it isn't here, so skip it).

New i18n keys, RTL-checked. Verify `npx tsc --noEmit` + `npx vite build`
clean. Manually walk: My Negotiations (tabs render, even empty) → open a
detail → (use the partner API or a quick DB update to move one to accepted if
Prompt 10's partner UI isn't built yet, note this in manual-test notes) →
confirm Offer Agreed state + disclaimer + Agreement Summary render correctly.
Update tracking doc's "Screens changed" (web, now complete for customer) and
begin "Investor demo instructions" with the web Rent walkthrough. Stop there.
```

---

## Prompt 10 — Web: Partner Portal Offers & Negotiations inbox + detail

```
Read only: docs/implementation/mymakan-negotiations.md,
frontend/src/routes/partner.tsx (skim structure/auth pattern + `NAV_ITEMS`
array ~line 319 and the "Viewing Requests" nav entry ~372 as the exact
pattern to follow — 3100+ lines, don't read in full),
frontend/src/routes/partner.viewings.tsx and partner.viewings.$id.tsx (full
files — closest structural siblings: tabs/status-filtered list + detail,
and the `useRouterState`+conditional-`<Outlet/>` routing guard documented in
mymakan-viewings.md:624-634/765-770 that a sibling `foo.bar.tsx` route needs
in the parent `partner.tsx`), frontend/src/lib/api/maskan.ts
(fetchPartnerViewings/confirmViewing/etc. as the request-shape template for
the new partner negotiation endpoints from backend Prompt 4).

Task:
1. Add to `maskan.ts`: `fetchPartnerNegotiations(status?)`,
   `fetchPartnerNegotiation(id)`, `counterNegotiationAsPartner(id, payload)`,
   `acceptNegotiationAsPartner(id)`, `rejectNegotiationAsPartner(id, reason)`
   — matching backend Prompt 4's endpoints.
2. New route `frontend/src/routes/partner.negotiations.tsx`: **Offers &
   Negotiations** per brief §7 — tabs New Offers / Countered / Accepted /
   Rejected / Closed, each card: property / customer display name / listing
   price / current offer / difference / viewing status if linked / lead
   status if linked / submitted time / negotiation status. Actions: Open /
   Accept / Counter / Reject. Add the routing guard in `partner.tsx` (same
   pattern as the existing viewing/leads sibling routes) and a
   "Negotiations"/"Offers" `NAV_ITEMS` entry mirroring the "Viewing
   Requests" entry exactly.
3. New route `frontend/src/routes/partner.negotiations.$id.tsx`: detail per
   brief §8 — Property block (image/title/district/listing price/View
   Property), Customer block (only info the existing partner lead view
   already exposes — no more), Offer block (current amount, difference from
   asking, message, submitted time), Market Context (reuse
   `GET /properties/{id}/intelligence` — estimated range, comparable
   summary, data confidence; do NOT show private customer viewing notes),
   Actions (Accept / Counter / Reject / Message Customer — the last reusing
   the existing lead-message thread, same instruction as Prompt 9).
4. Confirm the customer side (Prompts 7-9) reflects a partner action
   promptly through whatever existing refresh/polling mechanism the app
   already uses (check if web has any polling/refetch-on-focus, or if a
   manual refresh is the current norm for leads/viewings — match that, don't
   build a new real-time mechanism).

New i18n keys, RTL-safe strings even though partner portal is desktop-first.
Verify `npx tsc --noEmit` + `npx vite build` clean. Manually walk: as a test
mediator, see a new offer → counter it → as the test customer, see it become
Countered on My Negotiations (refresh if that's the existing norm). Update
tracking doc's "Screens changed" (web, partner portal) and add the partner
side to "Investor demo instructions". Stop there.
```

---

## Prompt 11 — Mobile: Make an Offer + My Negotiations + Negotiation Detail

```
Read: mobile/CLAUDE.md first. Then read only:
docs/implementation/mymakan-negotiations.md,
mobile/app/property/[id].tsx (skim — locate `handleContactAgent` ~232,
`NegotiationInsightCard` defined 1312/rendered 490, `ViewingStatusBanner`
rendered 278, as anchor points), mobile/app/_layout.tsx (Stack.Screen
registration list, lines 66-95 — you WILL need new entries here),
mobile/src/lib/api/maskan.ts (viewing block `createViewing` 687 through
`fetchViewingNextSteps` 746 as the template — mirror Prompts 7-9's web
function names/shapes exactly for consistency), mobile/app/viewings/[id].tsx
(line ~573, the existing "Ask AI about negotiation" deep link — retargeted
here same as web Prompt 7), mobile/src/lib/i18n/en.ts and ar.ts (`property:`
namespace ~505/502), mobile/src/components/ui/ (list directory —
`BottomSheet.tsx`/`Chip.tsx` are your building blocks).

Task: port Prompts 7-9's web functionality to mobile, using the SAME backend
endpoints (no mobile-only backend changes). Partner portal is web-only — skip
any partner-side work.
1. Add the same `createNegotiation`/`fetchMyNegotiations`/`fetchNegotiation`/
   `fetchActiveNegotiation`/`submitCounterOffer`/`acceptNegotiation`/
   `withdrawNegotiation`/`fetchNegotiationGuidance` functions to
   `mobile/src/lib/api/maskan.ts`.
2. Add a **Make an Offer** action on `mobile/app/property/[id].tsx`
   alongside the existing contact/schedule-viewing actions, same
   active-negotiation check and View-Negotiation fallback as web Prompt 7.
   Build the flow as a new screen (`mobile/app/negotiation/new.tsx`) or
   `BottomSheet` flow (your call — a full screen is likely cleaner for the
   multi-step Offer Intelligence/Amount/Message/Review flow; document the
   choice), same "Limited market data" fallback, same Draft-with-AI
   never-auto-send message step.
3. Retarget the existing "Ask AI about negotiation" hook
   (`mobile/app/viewings/[id].tsx:~573`) to open the Make an Offer flow,
   same as web.
4. New screen `mobile/app/negotiations/index.tsx` (**My Negotiations**,
   tabbed) and `mobile/app/negotiations/[id].tsx` (**Negotiation Detail**:
   timeline, summary, Ask myMakan, counter/accept/withdraw actions), mirroring
   web Prompts 8-9's structure and status→tab mapping (reuse the exact
   mapping documented in the tracking doc).
5. Offer Agreed + Agreement Summary states on the detail screen, same
   disclaimer copy verbatim as web, same placeholder "Continue Transaction"
   route.
6. Register every new screen file in `mobile/app/_layout.tsx`'s
   `<Stack.Screen>` list. Add a "My Negotiations" entry point reachable from
   Profile (check current tab/nav structure — mirror however "My Viewings"
   was placed).

New i18n keys mirroring the web namespace/key names from Prompts 7-9. Verify
`npx tsc --noEmit` in `mobile/` is clean. If a device/emulator or
`npx expo start` is available in this environment, manually walk: property →
Make an Offer → My Negotiations → detail → Ask myMakan → counter, for one
rent and one sale property. If no device/emulator is available, say so
explicitly rather than claiming a manual check happened. Update tracking
doc's "Screens changed" (mobile). Stop there.
```

---

## Prompt 12 — Polish pass: negotiation strength indicators UI, notifications deep-links, RTL/loading states

```
Read only: docs/implementation/mymakan-negotiations.md,
frontend/src/routes/negotiations.$id.tsx and negotiations.tsx (web, current
state), mobile/app/negotiations/[id].tsx and index.tsx (mobile, current
state), frontend/src/routes/partner.negotiations.tsx and .$id.tsx (web
partner, current state), the notification-bell/deep-link handling on web
(grep for how viewing notifications currently deep-link, e.g. a
`NotificationBell`-equivalent or route-based `?highlight=` param) and mobile
(`mobile/src/components/NotificationBell.tsx`, `mobile/src/lib/push.ts`
`data.deepLink` handling).

Task:
1. Wire notification deep-links (from Prompt 6's `negotiation_id` payload)
   to open the correct negotiation detail screen on tap/click, both web and
   mobile — mirror exactly how viewing notifications already deep-link, no
   new mechanism.
2. Render the negotiation strength signal (Prompt 5, brief §14) as a small
   badge/chip on: the negotiation detail screens (web + mobile, both
   customer and partner), and the My Negotiations / partner inbox list
   cards. Use consistent color/labeling across all four surfaces (pick a
   simple mapping — e.g. green for within-range/close-to-asking, amber for
   above-market/significant-discount, gray for limited-data — and reuse
   whatever badge component `NegotiationInsightCard` or `ScoreIndicator`
   already established rather than inventing new visual language).
3. Sweep all negotiation screens (web + mobile, customer + partner) for:
   loading/skeleton states, empty states, error/retry states, RTL rendering
   (money amounts, timeline direction, action button order) — fix any gaps
   found. This is a polish pass, not new functionality; keep changes small
   and targeted at genuine gaps, not a rewrite.
4. Confirm the full brief §23/§27 money-typography and "one obvious next
   action" requirements are met on both the Make an Offer flow and the
   Negotiation Detail screen — if the current offer-comparison UI is just
   plain numbers with no visual hierarchy, upgrade it (e.g. a simple
   before/after or listing-vs-offer comparison bar), but don't over-design
   beyond what the brief actually asks for.

Verify `npx tsc --noEmit` + `npx vite build` (web) and `npx tsc --noEmit`
(mobile) clean. Manually check RTL (switch the app to Arabic) on the Make an
Offer flow and Negotiation Detail screen, both web and mobile if a
device/emulator is available. Update tracking doc's "Screens changed"
sections to mark customer + partner UI fully complete. Stop there.
```

---

## Prompt 13 — Tests, validation, investor-demo walkthrough, docs finalization

```
Read only: docs/implementation/mymakan-negotiations.md, and
`git diff main...feature/mymakan-phase1 --stat` scoped mentally to files
touched by Prompts 1-12 (do not re-read every file in full — use the diff
stat plus the tracking doc's running notes).

Task:
1. Run the full backend suite: `pytest -q` in `backend/`. Confirm only the
   already-known unrelated failure remains
   (`test_list_properties_date_range_filter_excludes_conflicting_booking`)
   and nothing from Prompts 1-6 regressed. Re-verify every §25 validation
   rule from the brief is actually enforced and tested: property active,
   customer ownership, mediator authorization (direct `mediator_id` check,
   never trusting a client-supplied mediator id), valid transaction type,
   offer amount > 0, valid status transitions only, only the latest active
   (and other-party-placed) offer can be accepted, no duplicate active
   negotiation per customer/property, accepted negotiation cannot continue
   counters, closed/rejected/withdrawn negotiation immutable except the
   documented allowed transitions, customer cannot call mediator-only
   endpoints and vice versa, mediator cannot manage unrelated negotiations.
   Add a focused test for any genuine gap found — do not build a large new
   suite.
2. Re-verify §26 privacy rules with a quick grep/read rather than assuming:
   customer sees only their own negotiations; mediator sees only negotiations
   for their own properties; no private viewing notes, private AI
   conversation, other customers' offers, private search history, or other
   mediators' negotiations leak anywhere in the negotiation API responses.
3. Run `npx tsc --noEmit` and `npm run build` in `frontend/`; run
   `npx tsc --noEmit` in `mobile/`. All must be clean.
4. Fill in every remaining TODO section of
   `docs/implementation/mymakan-negotiations.md`: Feature completed /
   Existing functionality reused / Models / APIs / Status flow / Property
   Intelligence integration / Viewing integration / Lead integration / AI
   behavior / Notifications / Screens changed / Tests / Known limitations /
   Investor demo instructions. For "Investor demo instructions," write out
   the full §27 storyline for BOTH Rent and Buy, end to end: AI Home Finder
   → Property Intelligence → Trust → Viewing → Completed Viewing → Make an
   Offer → Offer Intelligence (listing/range) → Ask AI → Submit offer →
   Partner Portal new offer → Counter → Customer Ask myMakan → Counter again
   → Partner Accept → Offer Agreed → Agreement Summary → Continue Transaction
   (placeholder) — referencing real property/mediator/customer ids from the
   dev DB where possible so the demo is copy-pasteable end to end on both web
   and mobile.
5. Explicitly note in "Known limitations": `NegotiationOffer.expires_at` is a
   column with no enforcement job (no expiry cron per the feature-first
   no-new-infra constraint), "Continue Transaction" is a placeholder page,
   no fixed counter-round limit is enforced (matches the brief's own
   instruction), and anything else scoped out per the brief's exclusion list
   that came up during implementation.
6. Give a concise final implementation summary in your response (not a new
   file) covering: what was built across backend/web/mobile/partner portal,
   what existing functionality was reused (Property Intelligence's
   negotiation math, Viewings, Leads/LeadMessage, notifications, AI gateway,
   auth, design system), the full API surface, and any known limitations an
   investor demo should route around.

Do not start any other feature. Commit is optional — leave staged/unstaged
changes for the user to review. Stop there.
```
</content>
