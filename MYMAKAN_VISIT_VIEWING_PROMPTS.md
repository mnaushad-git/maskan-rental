# myMakan Visit & Viewing Management — Copy-Paste Session Prompts

Companion to the original "myMakan Visit & Viewing Management" brief, same pattern as
`MYMAKAN_PHASE1_PROMPTS.md` / `MYMAKAN_PROPERTY_INTELLIGENCE_PROMPTS.md`. Run these **in
order, one per fresh Claude Code window/session**. Each prompt is self-contained: it lists
exactly which files to read (so the session doesn't re-explore the whole repo) and exactly
when to stop. Do not paste two prompts into the same session.

Working directory: repo root. Branch: `feature/mymakan-phase1` (current branch — stay on
it unless told otherwise).

All progress is tracked in `docs/implementation/mymakan-viewings.md` (created in Prompt 1).
If a session runs out before finishing its prompt, the next session should read that doc
first to see what's already done.

**Note on `CLAUDE.md`:** there is no repo-root `CLAUDE.md` in this project (only
`mobile/CLAUDE.md`, itself just `@AGENTS.md` — a 3-line warning to check versioned Expo
docs before writing mobile code). Prompts below that say "Read: CLAUDE.md" mean "read
`mobile/CLAUDE.md`/`mobile/AGENTS.md` if touching mobile, otherwise skip."

**Ground truth already gathered** (so later prompts don't need to re-discover it):

- **Nothing viewing/appointment-related exists yet.** The repo's `Booking` model
  (`backend/app/models/booking.py`, `FEATURE_BOOKING=False`) is an unrelated short-stay
  night-range reservation feature, explicitly called out in
  `docs/implementation/mymakan-phase1.md` as *"unrelated to viewing"*. Build the
  `PropertyViewing` domain fresh — no partial code to reuse or collide with.
- `backend/app/models/property.py`: field is **`listing_type`** (`"rent"`/`"sale"`,
  plain string, line 18), **not** `transaction_type`. `mediator_id` (line 29) is a direct
  FK — a property is owned by exactly one mediator, no lead indirection needed for
  ownership checks. `PropertyOut` (`backend/app/schemas/property.py`) exposes a
  **computed** `transaction_type` field that just returns `listing_type`, kept for
  newer Phase-1 code — new viewing code should read `property.listing_type` at the model
  layer and can use either name in API-facing schemas, but don't introduce a second
  competing field.
- `backend/app/models/lead.py`: `Lead` has **no `property_id` column** — leads are
  area/city-based ("customer looking in Al Yasmin, Riyadh"), not per-listing. The only
  lead↔property link is `LeadSuggestion(lead_id, property_id)` (line 48). **Decision for
  §19 lead-linking (make this explicit in Prompt 2, don't re-litigate it later):** attach
  `PropertyViewing.lead_id` only when an existing `LeadSuggestion` row already links this
  customer's lead to this exact property; otherwise leave `lead_id` null. Do **not**
  auto-create a `Lead` from a viewing request — a Lead represents an area-wide search, and
  synthesizing one from a single-property viewing would misrepresent its scope and pollute
  mediator lead-matching (`_find_mediator_for_lead`, `leads.py:33`).
- Mediator authorization for a property is **direct ownership**, not lead-based:
  `backend/app/api/routes/properties.py:234-246` (`PATCH /partner/{property_id}`) is the
  canonical pattern — `Depends(get_mediator_user)` then
  `if prop.mediator_id != mediator.id: raise HTTPException(403, "Not your listing")`.
  Repeated in `partner_quality.py`. **Every partner-side viewing endpoint must use this
  exact check.**
- Event/notification pattern, mirror exactly: `backend/app/core/outbox.py` `EventType`
  (dot-namespaced strings like `"lead.created"`, `"lead.status_changed"`) +
  `record_event(db, event_type=..., aggregate_type=..., aggregate_id=..., payload={...})`
  called in the *same transaction* as the mutating write, `db.flush()` first (see
  `leads.py:108-117`). `backend/app/models/notification.py` has a separate
  underscore-style `NOTIFICATION_TYPES` tuple (line 9, e.g. `"lead_message"`) and a
  `dedupe_key = f"{event_type}:{aggregate_id}:{user_id}"` convention (lines 66-70). A
  worker file like `backend/app/tasks/lead_notifications.py` turns outbox events into
  `Notification` rows. New viewing events: outbox `"viewing.requested"`,
  `"viewing.confirmed"`, `"viewing.reschedule_proposed"`, `"viewing.cancelled"`,
  `"viewing.completed"` (matching the brief's §8 naming exactly) → notification types
  `"viewing_requested"`, `"viewing_confirmed"`, etc.
- Mobile push/notification client plumbing **already exists, reuse as-is, don't rebuild**:
  `mobile/src/lib/push.ts` (Expo push tokens, Android channels incl. a `"leads"` channel
  at line 59 — add a `"viewings"` channel the same way, deep-link tap handling via
  `data.deepLink`) and `mobile/src/components/NotificationBell.tsx` (60s poll +
  focus-refetch + immediate refetch on push receipt). No WebSocket client on mobile by
  deliberate design (see doc-comment in `push.ts:13-30`).
- AI pattern to mirror for both the checklist and the post-viewing assistant:
  `backend/app/services/home_finder_ai.py` `explain_match` (line 242) — build a plain-text
  facts block strictly from deterministic inputs, `try: gateway.run_chat(...) except:
  fallback` (never raises, never blocks), return `(text, generated_by)`. Register new
  prompt templates in `backend/app/core/ai/prompts.py` via `_register(name, version,
  template)` (existing examples: `PROPERTY_INTELLIGENCE_SUMMARY` line 287,
  `PROPERTY_NEGOTIATION_MESSAGE` line 308) — same file/pattern, don't invent a second
  registry.
- Feature flag recipe (3 steps, copy exactly): `FLAGS` dict entry in
  `backend/app/core/feature_flags.py:14` (e.g. `"property_intelligence":
  "FEATURE_PROPERTY_INTELLIGENCE"` at line 47) → boolean `Settings` attribute in
  `backend/app/core/config.py:154-155` → a `_require_enabled`-style zero-arg dependency
  like `backend/app/api/routes/home_finder.py:43`, wired via
  `dependencies=[Depends(_require_enabled)]` on the router. New flag:
  `FEATURE_VISIT_MANAGEMENT` / `"visit_management"`, default `True` (this is the one
  feature-first demo the whole session is about — do not ship it default-off).
  `frontend/src/lib/phase1-flags.ts` is a **separate, narrower** mechanism only for the 6
  explicitly Phase-1-hidden features — this new flag does **not** need an entry there; the
  frontend just calls the API and a 404/503 means it's off, same as Property Intelligence.
- `frontend/src/routes/property.$id.tsx` is **3534 lines** — the Property Intelligence
  feature (hero, Decision Score, `ContactModal` at line 2305/rendered at 3323, advisor
  handoff via `sessionStorage.setItem("maskan_advisor_ctx", ...)` at line 2561) is already
  fully built in this file (uncommitted). New viewing UI is additive sections/CTAs in this
  same file, not a rewrite — read it with a scoped `grep`/skim, not a full read.
- `frontend/src/lib/api/maskan.ts` (3214 lines) has the exact template functions to copy
  for a new `viewings` namespace: `createLead` (line 1515), `fetchMyLeads` (1530),
  `fetchLead` (1552), `fetchPartnerLeads`/`acceptLead`/`rejectLead` (1556-1585),
  `fetchLeadMessages`/`sendLeadMessage` (1589-1600) — all thin wrappers over a shared
  `requestJson<T>()` helper. Also `fetchPropertyIntelligence` (1094) and
  `fetchPropertyAiSummary(propertyId, language, variant)` (1105) as query-param/POST-body
  idioms.
- `frontend/src/lib/i18n/en.ts` `property:` namespace starts at line 529 (ar.ts: line 521)
  — insertion point for `property.viewing.*` keys.
- `frontend/src/routes/partner.tsx` (3137 lines) is a hybrid: the main dashboard is one
  big file, but leads/requests get their own routed files
  (`partner.leads.$leadId.tsx`, `partner.requests.tsx`, `partner.requests.$id.tsx` — dot
  segment = TanStack Router file convention). **New partner viewing UI should be its own
  `frontend/src/routes/partner.viewings.tsx` + `partner.viewings.$id.tsx`**, not crammed
  into `partner.tsx`. Partner pages use the exact same `maskan.ts` client and
  `useAuth()`/bearer-token auth as customer pages — the backend distinguishes roles via
  route dependencies (`get_mediator_user`), not a different frontend client.
- `backend/app/api/routes/partner_quality.py` is the strongest backend template for the
  new partner router: a standalone file (not folded into `properties.py`), prefix
  `/partner/properties`, every endpoint using `get_mediator_user` +
  `prop.mediator_id != mediator.id → 403`, mounted in `main.py` alongside the others —
  mirror this exactly for `backend/app/api/routes/partner_viewings.py`
  (prefix `/partner/viewings`).
- `mobile/app/property/[id].tsx` (1335 lines): contact/lead flow is `handleContactAgent`
  (line 206) → `onContactAgent` prop (270/737) → `Pressable` (825); lead CTA string
  `t("property.actions.submitLeadRequest")` (495). `mobile/app/_layout.tsx` requires an
  **explicit `<Stack.Screen name="...">` registration** (lines 65-92) for every new
  routable file under `mobile/app/` — e.g. `property/[id]` at line 67, `lead/new` at 75 —
  a new `mobile/app/viewing/new.tsx` / `mobile/app/viewings/index.tsx` etc. needs a
  matching line added here, the file alone is not enough.
  `mobile/src/components/ui/BottomSheet.tsx` is the component to reuse for the mobile
  time-slot picker (alongside `SegmentedControl.tsx`/`Chip.tsx` also in that directory).
  `mobile/src/lib/i18n/en.ts` `property:` namespace at line 504 (ar.ts: 501).
- Test conventions: `backend/tests/conftest.py` has `db_session` (savepoint-rollback
  isolation against the real local Postgres, no separate test DB) and `client`
  (`TestClient(app)` with `get_db` overridden) — **no role-specific fixtures**; every test
  file builds its own users/mediators inline. Best structural templates: `test_bookings.py`
  (`_make_property`/`_make_mediator` helpers, `pytestmark = pytest.mark.skipif(not
  settings.FEATURE_X, ...)` flag-gating, `_signup`/`_auth` helper pair) and
  `test_partner_quality_api.py` (ownership-check pattern). There is **no `test_leads.py`**
  — don't assume one exists to extend. One known pre-existing unrelated failing test to
  ignore in full-suite runs: `test_list_properties_date_range_filter_excludes_conflicting_booking`.
- Before writing the new Alembic migration, run `alembic heads` in `backend/` to confirm
  the current head (at research time it was `a9b0c1d2e3f4_add_availability_confirmed_at_and_...`,
  an uncommitted Trust Center migration — the head may have moved since).

---

## Prompt 1 — Feature flag + tracking doc + PropertyViewing model + migration + schemas

```
Read only: docs/implementation/mymakan-phase1.md,
backend/app/models/property.py, backend/app/models/lead.py (full file),
backend/app/models/mediator.py, backend/app/models/notification.py,
backend/app/core/outbox.py, backend/app/core/feature_flags.py,
backend/app/core/config.py, backend/app/api/routes/home_finder.py
(_require_enabled pattern only), backend/alembic/versions/ (list directory,
then read only the single most recent migration file to confirm the current
head/pattern — run `alembic heads` in backend/ first to be sure).

We are building myMakan's "Visit & Viewing Management" feature — full scope
lives only in the user's original brief (not in this repo); this prompt file
breaks it into small steps. Do NOT read ahead into later prompts' scope. We
are in feature-first investor-demo mode: Rent + Buy, customer mobile +
customer web + partner portal, reusing existing auth/leads/notifications/AI
gateway. Explicitly out of scope for the whole feature: Ejar, Nafath,
payments, financing, new Redis/queue infra, external calendar sync,
SMS/WhatsApp, new microservices.

Task:
1. Add feature flag `FEATURE_VISIT_MANAGEMENT` (default True) to
   `feature_flags.py`'s `FLAGS` dict and `config.py`'s `Settings`, exactly
   following the `property_intelligence`/`area_intelligence` pattern. Add to
   `backend/.env.example` too if flags are listed there.
2. Create `docs/implementation/mymakan-viewings.md` with section headers
   (fill what you know now, leave the rest `TODO — filled in by a later
   prompt`): Feature completed / Models / APIs / Status flow / Lead
   integration / AI checklist behavior / AI post-viewing assistant /
   Notifications / Screens changed / Tests / Known limitations / Investor
   demo steps. Explicitly document the lead-linking decision already made
   (see this file's "Ground truth" section above): attach via existing
   `LeadSuggestion(lead_id, property_id)` match only, never auto-create a
   Lead.
3. Create `backend/app/models/property_viewing.py`: `PropertyViewing` model
   with exactly the fields from the brief's §2 (id, property_id,
   customer_user_id, mediator_id, lead_id nullable, requested_start_at,
   requested_end_at, confirmed_start_at, confirmed_end_at, timezone, status,
   customer_note, mediator_note, cancellation_reason, cancelled_by (actor:
   "customer"|"mediator"), created_at, updated_at, confirmed_at, cancelled_at,
   completed_at, plus proposed_start_at/proposed_end_at/proposed_by,
   last_reminder_at). Status values as a plain string column (mirror
   `Property.status`'s un-enumed string convention, not a DB enum type):
   requested, confirmed, reschedule_proposed, cancelled_by_customer,
   cancelled_by_mediator, completed, no_show_customer, no_show_mediator. Add
   two lightweight columns for §15 ("During Viewing" mode): `checklist_state`
   (JSONB — generated checklist items + checked state) and `private_notes`
   (JSONB list of {text, created_at}) — keep these on the same row rather
   than a new table, per the brief's "keep implementation lightweight" /
   "no offline-sync architecture" instructions. Add `interest_level` and
   `feedback_reason`/`feedback_note` columns for §16 post-viewing feedback.
   FKs to properties/users/mediators/leads with sensible ondelete behavior
   mirroring `property.py`'s existing FK conventions. Indexes on
   (customer_user_id, status), (mediator_id, status), (property_id,
   customer_user_id) — the last one is what the §18 duplicate-active-viewing
   check will query.
4. Add outbox `EventType` entries in `outbox.py`: `VIEWING_REQUESTED =
   "viewing.requested"`, `VIEWING_CONFIRMED = "viewing.confirmed"`,
   `VIEWING_RESCHEDULE_PROPOSED = "viewing.reschedule_proposed"`,
   `VIEWING_CANCELLED = "viewing.cancelled"`, `VIEWING_COMPLETED =
   "viewing.completed"`. Add matching underscore-style entries to
   `notification.py`'s `NOTIFICATION_TYPES` tuple: `viewing_requested`,
   `viewing_confirmed`, `viewing_reschedule_proposed`, `viewing_cancelled`,
   `viewing_completed`.
5. `backend/app/schemas/property_viewing.py`: `PropertyViewingCreate`,
   `PropertyViewingOut` (include denormalized property title/image/district
   and mediator display name so list/detail screens don't need N+1 fetches —
   mirror how `PropertyOut` denormalizes mediator fields), a status-history/
   timeline-friendly shape is NOT needed yet (Prompt 2 will decide whether
   timeline is computed from timestamps or a separate event log — don't
   pre-build it here).
6. Alembic migration for the new table, chained onto the current head (from
   `alembic heads`).

Do not add any API route yet. Do not touch frontend or mobile. Run
`alembic upgrade head` in backend/ and confirm it applies cleanly, then
`alembic downgrade -1` and `alembic upgrade head` again to sanity-check the
migration is reversible. Fill in the "Models" and "Notifications" sections of
the tracking doc. Commit is not required. Stop there.
```

---

## Prompt 2 — Create-viewing service + customer create/list/detail APIs

```
Read only: docs/implementation/mymakan-viewings.md,
backend/app/models/property_viewing.py, backend/app/schemas/property_viewing.py
(from Prompt 1), backend/app/api/routes/leads.py (full file — this is your
exact template: idempotency-key handling lines ~82-91/122-124, outbox event
write inside the same transaction lines ~108-117, `enqueue()` post-commit job
pattern line ~120), backend/app/models/lead.py, backend/main.py (or
backend/app/main.py — locate it) just enough to see how existing routers are
mounted (e.g. where `partner_quality.router`/`leads.router` get included, so
you mount the new router the same way), backend/app/core/feature_flags.py.

Task:
1. `backend/app/services/property_viewing.py`:
   `create_viewing(db, customer_user, property_id, requested_start_at,
   requested_end_at, timezone, customer_note) -> PropertyViewing`. Validates:
   property exists and `status == "Published"`; `mediator_id` copied from the
   property; requested_start_at is in the future; no existing active viewing
   (status not in the cancelled/completed/no_show set) for this
   (customer_user_id, property_id) pair — raise a domain error the route
   layer turns into 409. Lead-linking: query for an existing
   `LeadSuggestion` joined to `Lead` where `Lead.customer_user_id ==
   customer_user.id and LeadSuggestion.property_id == property_id`; if found,
   set `lead_id`; otherwise leave null (per the tracking doc's already-made
   decision — do not create a Lead here). Writes the row + `record_event(...,
   event_type=EventType.VIEWING_REQUESTED, ...)` in one transaction, same
   shape as `leads.py`'s create_lead.
2. `backend/app/api/routes/viewings.py` (new router, mounted in main.py the
   same way `leads.router` is, gated behind `FEATURE_VISIT_MANAGEMENT` via a
   `_require_enabled`-style dependency per the Prompt 1 flag):
   - `POST /api/v1/viewings` — accepts `Idempotency-Key` header exactly like
     `POST /leads/` does (reuse the same `IdempotencyStore` mechanism, don't
     reinvent it).
   - `GET /api/v1/viewings` — customer's own viewings, optional `status`
     query filter, ordered by `requested_start_at` desc.
   - `GET /api/v1/viewings/{id}` — 404 if not found, 403 if
     `viewing.customer_user_id != current_user.id`.
3. Enqueue a notification-creation job after commit (new
   `backend/app/tasks/viewing_notifications.py`, mirroring
   `lead_notifications.py`'s event→Notification pattern) for
   `VIEWING_REQUESTED` — notify the mediator, `dedupe_key` per the existing
   convention.

Tests in `backend/tests/test_viewings.py` (new file — no existing template to
extend, build local `_make_property`/`_make_mediator`/`_signup`/`_auth`
helpers mirroring `test_bookings.py`'s style, plus a
`pytestmark = pytest.mark.skipif(not settings.FEATURE_VISIT_MANAGEMENT, ...)`
guard): create succeeds with valid future time; rejects past time; rejects
duplicate active viewing for same customer+property; 404 on unknown property;
403 on reading another customer's viewing; lead-linking attaches when a
matching `LeadSuggestion` exists and stays null when it doesn't;
idempotency-key replay returns the same viewing without creating a duplicate.

No partner endpoints, no reschedule/cancel yet, no frontend/mobile changes.
Update the tracking doc's "APIs" (partial) and "Lead integration" sections.
Run `pytest backend/tests/test_viewings.py -q`. Stop there.
```

---

## Prompt 3 — Customer-side transitions: cancel, propose-time, accept-reschedule

```
Read only: docs/implementation/mymakan-viewings.md,
backend/app/services/property_viewing.py,
backend/app/api/routes/viewings.py (from Prompt 2),
backend/app/models/property_viewing.py, backend/app/core/outbox.py.

Task:
1. In `property_viewing.py`, add a small, explicit status-transition
   validator (a dict of `{current_status: {allowed_next_statuses}}` or
   equivalent — keep it a plain lookup, the brief explicitly says "avoid
   complex negotiation state machines" / "minimum clean status model") plus:
   - `cancel_viewing(db, actor_user, viewing, reason, actor_role: "customer"|
     "mediator") -> PropertyViewing` — sets status to
     `cancelled_by_customer`/`cancelled_by_mediator` per actor_role,
     `cancellation_reason`, `cancelled_at`; allowed from requested/confirmed/
     reschedule_proposed only. Emits `VIEWING_CANCELLED`.
   - `propose_new_time(db, actor_user, viewing, start_at, end_at, note,
     proposed_by: "customer"|"mediator") -> PropertyViewing` — sets status
     `reschedule_proposed`, `proposed_start_at/end_at/by`; keeps
     `confirmed_start_at`/`requested_start_at` untouched (history preserved
     per brief §9). Emits `VIEWING_RESCHEDULE_PROPOSED`.
   - `accept_reschedule(db, customer_user, viewing) -> PropertyViewing` —
     only valid when `status == "reschedule_proposed"` and
     `proposed_by == "mediator"` (customer accepting mediator's proposal);
     sets status `confirmed`, `confirmed_start_at/end_at` = the proposed
     values, `confirmed_at` = now. Emits `VIEWING_CONFIRMED`.
2. Add to `viewings.py`:
   - `POST /api/v1/viewings/{id}/cancel` (body: reason enum/free-text per
     brief §10 customer reason list — Plans changed / Found another property
     / Time no longer works / Other) — ownership check
     (`customer_user_id == current_user.id`).
   - `POST /api/v1/viewings/{id}/propose-time` — customer proposing a new
     time (the mediator-side propose-time is a separate endpoint in
     Prompt 4's partner router, sharing this same service function with
     `proposed_by="customer"`).
   - `POST /api/v1/viewings/{id}/accept-reschedule` — only when the
     mediator was the one who last proposed.
3. Wire each transition's notification via `viewing_notifications.py`
   (Prompt 2's task file), matching event→notification mapping.

Tests (extend `test_viewings.py`): valid transitions for each of the three
new actions; invalid-transition rejections (e.g. cancelling an already
completed viewing → 409/400); customer cannot accept-reschedule when they
themselves were the last proposer (must propose-another-time or cancel
instead — assert the correct error); ownership checks (403 on another
customer's viewing); cancellation reason persisted; history fields
(`requested_start_at` etc.) remain intact after a reschedule.

No partner endpoints yet, no checklist/feedback, no frontend/mobile. Update
tracking doc's "Status flow" section with the transition table. Run
`pytest backend/tests/test_viewings.py -q`. Stop there.
```

---

## Prompt 4 — Partner portal backend: list, confirm, propose-time, cancel, complete, no-show

```
Read only: docs/implementation/mymakan-viewings.md,
backend/app/services/property_viewing.py (from Prompts 2-3),
backend/app/api/routes/partner_quality.py (full file — this is your exact
template: standalone router file, prefix, get_mediator_user +
"Not your listing" ownership check, main.py mounting), backend/app/main.py
(mounting point only).

Task:
1. `backend/app/api/routes/partner_viewings.py` (new router, prefix
   `/partner/viewings`, mounted in `main.py` alongside `partner_quality`,
   gated behind `FEATURE_VISIT_MANAGEMENT`, every endpoint using
   `Depends(get_mediator_user)` + `prop.mediator_id != mediator.id → 403
   "Not your listing"` exactly like `partner_quality.py`):
   - `GET /api/v1/partner/viewings` — mediator's own viewings across all
     their properties, `status` query filter, ordered by `requested_start_at`.
   - `GET /api/v1/partner/viewings/{id}`.
   - `POST /api/v1/partner/viewings/{id}/confirm` — new service function
     `confirm_viewing(db, mediator_user, viewing, mediator_note=None)`:
     valid only from `requested` (or `reschedule_proposed` where
     `proposed_by == "customer"`, i.e. mediator accepting the customer's
     counter-proposal); sets status `confirmed`,
     `confirmed_start_at/end_at` = `requested_start_at/end_at` (or the
     customer's proposed values if accepting a counter-proposal),
     `confirmed_at`. Emits `VIEWING_CONFIRMED`.
   - `POST /api/v1/partner/viewings/{id}/propose-time` — reuses Prompt 3's
     `propose_new_time(..., proposed_by="mediator")`.
   - `POST /api/v1/partner/viewings/{id}/cancel` — reuses Prompt 3's
     `cancel_viewing(..., actor_role="mediator")` with the mediator reason
     list from brief §10 (Property unavailable / Owner unavailable /
     Schedule conflict / Other).
   - `POST /api/v1/partner/viewings/{id}/complete` — new
     `complete_viewing(db, mediator_user, viewing)`: valid only from
     `confirmed`, sets status `completed`, `completed_at`. Emits
     `VIEWING_COMPLETED`.
   - `POST /api/v1/partner/viewings/{id}/no-show` — new
     `mark_no_show(db, mediator_user, viewing, who: "customer"|"mediator")`:
     valid only from `confirmed`, sets status `no_show_customer` or
     `no_show_mediator`.
2. Confirm the mediator-facing response schema doesn't leak more customer PII
   than the existing lead flow exposes (check what `LeadSummaryOut`/
   `LeadDetailOut` show a mediator today and match that privacy bar — brief
   §7 explicitly says not to expose more than existing lead/privacy rules
   allow).
3. Wire notifications for confirm/complete/no-show the same way as Prompt 3.

Tests in `backend/tests/test_partner_viewings.py` (mirror
`test_partner_quality_api.py`'s ownership-check structure): confirm from
`requested`; confirm accepting a customer counter-proposal; propose-time;
cancel with mediator reason; complete only from confirmed (rejected from
other states); no-show for both parties; 403 when mediator doesn't own the
property (a second mediator's property); PII exposure check (assert no
customer email/phone leaks beyond what leads already expose, or that it
matches — whichever the codebase's existing convention is).

No frontend/mobile, no checklist/feedback/AI yet. Update tracking doc's
"APIs" section (full backend surface for confirm/reschedule/cancel/complete
now done) and "Notifications" section. Run
`pytest backend/tests/test_partner_viewings.py backend/tests/test_viewings.py -q`.
Stop there.
```

---

## Prompt 5 — AI Viewing Checklist (deterministic + AI-enhanced, Rent + Buy) + persistence API

```
Read only: docs/implementation/mymakan-viewings.md,
backend/app/models/property_viewing.py, backend/app/models/property.py,
backend/app/services/home_finder_ai.py (explain_match, full function — the
grounded-narration-with-fallback pattern to mirror exactly),
backend/app/core/ai/prompts.py (registry pattern + skim 2-3 existing
templates for tone/structure), backend/app/core/ai/gateway.py (run_chat
signature only), backend/app/api/routes/viewings.py (from Prompts 2-3).

If available (check first, read only if present and skim, don't deep-read):
docs/implementation/mymakan-property-intelligence.md and
backend/app/services/property_highlights.py / data_confidence.py — these may
already compute "missing field" signals (furnishing, property age, floor
plan, amenities) that the checklist should reuse rather than re-deriving
independently.

Task, all in new files under backend/app/services/:
1. `viewing_checklist.py`: deterministic (no LLM) checklist generator.
   - `generate_verify_during_visit_items(property) -> list[ChecklistItem]`:
     the fixed core list from brief §11 (parking, room sizes, water
     pressure, network coverage, furnishings included, natural lighting,
     visible maintenance issues) — always included.
   - `generate_property_specific_items(property) -> list[ChecklistItem]`:
     conditional items driven by actual listing fields per brief §11's
     examples (parking claimed → confirm exact assigned spot; furnished →
     confirm which items; property age missing → ask when built; floor plan
     missing → verify dimensions; pool/gym/amenities claimed → confirm
     access terms). Never invent a defect or claim not evidenced by the
     listing data — every generated item must trace to a concrete field
     value or a concrete missing field.
   - `generate_rent_items(property) -> list[ChecklistItem]` and
     `generate_buy_items(property) -> list[ChecklistItem]`: the
     transaction-specific question lists from brief §12/§13, each skipped
     when the answer is already present on the listing (mirror how the
     Property Intelligence `smart_questions.py` does this skip-if-known
     check, if that file exists — otherwise implement the same idea fresh).
     Branch on `property.listing_type` ("rent" vs "sale").
   - `build_checklist(property) -> ViewingChecklist`: assembles the above
     into named sections; this is the deterministic fallback that must
     always work even if AI is down.
2. `viewing_checklist_ai.py`: register a `VIEWING_CHECKLIST_SUMMARY` (or
   similar) prompt in `prompts.py` whose instructions state explicitly: only
   reprioritize/reword/explain-why the given deterministic items, never
   invent defects/legal problems/amenities/ownership issues, never diagnose
   structural safety, keep total items reasonable (brief says 4-7 for smart
   questions; checklist sections can be a bit longer but stay curated).
   `enhance_checklist(checklist, property_intelligence_summary=None,
   trust_summary=None, language) -> ViewingChecklist` — calls `run_chat` to
   reorder/annotate items with a short "why this matters" line per item and
   a 1-2 sentence visit-plan summary; `try/except` around the AI call with
   the deterministic `checklist` returned unmodified on any failure (mirror
   `explain_match` exactly). If Property Intelligence / Trust Center
   summaries aren't available/passed, proceed with property facts alone.
3. Checklist + private-notes persistence (brief §15 "During Viewing" mode):
   add `PATCH /api/v1/viewings/{id}/checklist` to `viewings.py` — body
   accepts checked-state updates for existing items and/or new private notes
   (`{text}` appended with a server timestamp to the `private_notes` JSONB
   column from Prompt 1); persists into `checklist_state`/`private_notes`.
   The checklist itself (item list) should be generated once (e.g. on first
   GET or on confirm) and stored in `checklist_state` so repeated PATCH calls
   only toggle/append rather than regenerating — decide the exact
   generate-once trigger point and document it in the tracking doc.
4. Expose the checklist on `GET /api/v1/viewings/{id}` (add a
   `checklist: ViewingChecklistOut` field to the response, generating it
   lazily on first access if not yet stored).

Tests in `backend/tests/test_viewing_checklist.py`: rent items differ from
buy items; conditional items appear/skip correctly based on property data
(parking claimed vs not, furnishing present vs missing, etc.); AI enhancement
grounding (mock `run_chat`, assert only the deterministic items/facts reach
the prompt, no fabricated content); AI failure falls back to the
deterministic checklist unchanged; `PATCH .../checklist` persists checked
state and appends notes without clobbering existing ones; checklist generated
once and stable across repeated GETs.

No frontend/mobile. Update tracking doc's "AI checklist behavior" section
(document the generate-once trigger decision and the AI grounding rules).
Run `pytest backend/tests/test_viewing_checklist.py -q`. Stop there.
```

---

## Prompt 6 — Post-viewing feedback + AI Post-Viewing Assistant ("Ask myMakan What Next?")

```
Read only: docs/implementation/mymakan-viewings.md,
backend/app/models/property_viewing.py, backend/app/services/home_finder_ai.py
(explain_match — same pattern again), backend/app/core/ai/prompts.py,
backend/app/api/routes/viewings.py (current state after Prompts 2-3, 5).

If available (skim only): backend/app/services/negotiation_intelligence.py
and property_intelligence assembly service — the post-viewing assistant's
"suggest negotiation" step should call into these rather than reimplementing
negotiation logic, if they already exist.

Task:
1. `POST /api/v1/viewings/{id}/feedback` in `viewings.py` — only valid when
   `status == "completed"`. Body: `interest_level` (Very Interested / Maybe /
   Not Interested, brief §16), optional private note, optional
   `feedback_reason` (Price/Location/Size/Condition/Amenities/Other, only
   meaningful when Not Interested). Persists to the Prompt 1 columns. No
   status transition — this is feedback on an already-completed viewing, not
   a new state.
2. `backend/app/services/viewing_next_steps_ai.py`: register a
   `VIEWING_NEXT_STEPS` prompt in `prompts.py` (instructions: summarize the
   visit grounded ONLY in provided facts — property facts, Property
   Intelligence/Trust summaries if passed in, the customer's own private
   checklist notes and checklist completion, feedback/interest level, current
   search criteria if available; suggest next steps from a bounded action
   set: compare with a saved property, ask mediator about a specific point,
   confirm a specific open question; explicitly must NOT auto-contact or
   auto-negotiate on the customer's behalf, must not invent facts not in the
   input). `generate_next_steps(viewing, property, checklist_state,
   private_notes, feedback, property_intelligence=None, trust_summary=None,
   search_criteria=None, language) -> NextStepsResult` — same
   try/except-with-deterministic-fallback shape as Prompt 5 (fallback: a
   short templated summary built from whichever fields are present, no AI
   wording, still useful, never blocks).
3. `POST /api/v1/viewings/{id}/ai-next-steps` — only callable once
   `status == "completed"` (feedback not required first, but richer if
   present); rate-limited the same way other AI endpoints are (check
   `ai.py`'s `rate_limit_dependency` usage and reuse it), gated behind
   `FEATURE_VISIT_MANAGEMENT`.

Tests in `backend/tests/test_viewing_feedback.py` (or extend
`test_viewing_checklist.py`): feedback rejected before completion; feedback
persists interest_level/reason/note; AI next-steps grounding (mock run_chat,
assert only real facts reach the prompt — no fabricated negotiation claims,
no auto-contact language); AI failure falls back to deterministic summary;
next-steps works with minimal input (no criteria, no intelligence summary,
just the checklist+feedback).

This completes the entire backend surface for the feature. No
frontend/mobile changes yet. Update tracking doc's "AI post-viewing
assistant" section. Run
`pytest backend/tests/test_viewing_feedback.py backend/tests/test_viewing_checklist.py backend/tests/test_viewings.py backend/tests/test_partner_viewings.py -q`
plus a quick full-suite smoke check (`pytest -q`, note only the known
pre-existing `test_list_properties_date_range_filter_excludes_conflicting_booking`
failure if it appears — not yours to fix). Stop there.
```

---

## Prompt 7 — Web: Schedule Viewing flow + Property Detail integration

```
Read only: docs/implementation/mymakan-viewings.md,
frontend/src/routes/property.$id.tsx (skim structure only — it's 3534 lines;
locate the existing "Contact Agent" CTA area, `ContactModal` (~line 2305,
rendered ~3323), and the sessionStorage advisor handoff (~line 2561) as
anchor points for where a new "Schedule Viewing" CTA and modal/flow should
live), frontend/src/lib/api/maskan.ts (createLead ~1515, fetchPropertyIntelligence
~1094 and fetchPropertyAiSummary ~1105 as request-shape templates),
frontend/src/lib/i18n/en.ts and ar.ts (`property:` namespace, ~line
521-529), frontend/src/components/maskan/ (list directory — locate any
existing date/time picker component before building a new one).

Task:
1. Add to `maskan.ts`: `createViewing(payload)`, `fetchMyViewings(status?)`,
   `fetchViewing(id)` — matching the exact backend request/response shapes
   from Prompts 1-2 (`POST/GET /viewings`), same `requestJson` pattern as
   `createLead`.
2. On `property.$id.tsx`: add a **Schedule Viewing** CTA near the existing
   Contact Agent CTA (secondary or primary per current layout — your call,
   document it). Build the flow per brief §3-4 as a modal or stepper
   (whichever fits this codebase's existing modal patterns better — check
   `ContactModal`'s structure first): select date → select time (configurable
   business hours, default 09:00-21:00, 30/60-min slots, exclude past times;
   label it **"Request a preferred time"**, never "Available Slot", since
   there's no real mediator-availability data source yet per brief §4) → 
   optional note → review (property image/title/district/mediator/date/time/
   timezone/note) → submit. Default timezone: Saudi Arabia (Asia/Riyadh) if
   no user-profile timezone is available.
3. After submission, show a **"Viewing Requested — Waiting for mediator
   confirmation"** confirmation state (not a claim of confirmed time).
4. Property Detail should show the logged-in customer's upcoming/active
   viewing status if one exists (brief §18) — a small banner ("Viewing
   Requested" / "Viewing Confirmed — Tuesday, 6:30 PM") with actions "View
   Appointment" / "Message Mediator" / "Prepare for Visit" (the last one can
   link to a placeholder route if Prompt 9's checklist screen doesn't exist
   yet — say so with a short TODO). Prevent opening the Schedule Viewing flow
   again while an active (non-cancelled/completed) viewing already exists for
   this property — surface the existing one instead.

New i18n keys under `property.viewing.*` in both `en.ts`/`ar.ts` (RTL-safe).
Verify `npx tsc --noEmit` and `npx vite build` in `frontend/`, both clean.
Start the dev server and manually check the flow on a real rent property and
a real sale property from the dev DB (submit a request, confirm the
"Waiting for confirmation" state and the Property Detail banner appear, no
console errors). Update tracking doc's "Screens changed" (web, partial).
Stop there.
```

---

## Prompt 8 — Web: My Viewings page + Viewing Detail screen

```
Read only: docs/implementation/mymakan-viewings.md,
frontend/src/routes/property.$id.tsx (current state after Prompt 7, for the
banner/CTA wiring to link into), frontend/src/lib/api/maskan.ts (viewing
functions from Prompt 7), an existing tabbed list page for structural
reference (check frontend/src/routes/ for how leads or saved-searches render
a tabbed/status-filtered list — reuse that pattern rather than inventing a
new one), frontend/src/components/maskan/PropertyCard.tsx.

Task:
1. New route `frontend/src/routes/viewings.tsx` (or `my-viewings.tsx` —
   match this codebase's existing file-naming convention for similar
   customer pages): **My Viewings** with tabs Upcoming / Pending / Completed
   / Cancelled (brief §5), mapping the backend's 8 statuses into these 4 UI
   buckets (document the mapping in the tracking doc). Each card: property
   image/title/district/mediator/date-time/status chip/"time until viewing"
   where useful. Actions per status exactly as brief §5 lists (Requested:
   view+cancel; Confirmed: view+message+cancel [+add-to-calendar only if a
   trivially-easy native/ICS approach exists, else omit]; Reschedule
   proposed: accept/decline/propose-another; Completed: view
   property+contact+review-if-existing-review-flow-supports-it — check if a
   review feature already exists before building anything new for this).
   Skeleton loading state, empty state per tab, error/retry.
2. New route `frontend/src/routes/viewings.$id.tsx`: Viewing Detail per brief
   §6 — Property block (image/title/district/price/View Property link),
   Appointment block (requested/confirmed time, status, mediator details),
   Timeline (derive purely from the model's timestamp fields —
   requested_start_at/confirmed_at/proposed_*/cancelled_at/completed_at — no
   new backend endpoint needed, render client-side from what `GET
   /viewings/{id}` already returns), Actions block matching current status
   (accept proposed time / propose new time / cancel / message mediator /
   view AI checklist — the last one links to Prompt 9's screen, TODO-comment
   if not built yet).
3. Reschedule UI: accept / propose-another (reuses the Prompt 7 date/time
   picker component) / decline-via-cancel, wired to the
   accept-reschedule/propose-time/cancel endpoints from backend Prompt 3.
4. Cancellation UI: reason selection (customer reason list from brief §10)
   + optional free text, wired to `POST .../cancel`.

New i18n keys, RTL-checked. Verify `npx tsc --noEmit` + `npx vite build`
clean. Manually walk: My Viewings (all 4 tabs render, even empty) →
open a detail → cancel one test viewing → confirm it moves to the Cancelled
tab. Update tracking doc's "Screens changed" (web). Stop there.
```

---

## Prompt 9 — Web: AI Checklist + During-Viewing mode + Post-viewing feedback + Ask myMakan What Next

```
Read only: docs/implementation/mymakan-viewings.md,
frontend/src/routes/viewings.$id.tsx (from Prompt 8),
frontend/src/lib/api/maskan.ts, frontend/src/routes/property.$id.tsx
(the sessionStorage advisor-handoff mechanism ~line 2561, and how the
existing "Ask myMakan" AI surfaces render responses, for visual consistency).

Task:
1. Add `fetchViewingChecklist` (or read it off `fetchViewing`'s response if
   Prompt 5 embedded it there — check), `updateViewingChecklist(id, patch)`,
   `submitViewingFeedback(id, payload)`, `fetchViewingNextSteps(id)` to
   `maskan.ts`, matching Prompts 5-6's backend shapes.
2. **Prepare for Your Visit / AI Viewing Checklist** section on the Viewing
   Detail screen (visible for confirmed or pending viewings, brief §11):
   render the sectioned checklist (Verify During Visit / property-specific /
   rent-or-buy questions) with the AI "why this matters" annotations when
   present, always renders even if AI enhancement failed (deterministic
   fallback must look identical in structure, just without the annotations).
3. **During Viewing** mode (brief §15): checkboxes for each item (persist via
   `updateViewingChecklist` on toggle, optimistic UI is fine), a private
   notes field (persist via the same endpoint), clearly labeled as private to
   the customer. Keep this lightweight — no offline queue/sync, a simple
   debounced save or save-on-blur is enough.
4. **Post-viewing decision** (brief §16): once a viewing is `completed`, show
   "How did it go?" (Very Interested / Maybe / Not Interested) + optional
   note + optional reason (when Not Interested), calling
   `submitViewingFeedback`. On Very Interested, surface the three suggested
   actions (Contact mediator / Ask AI about negotiation / Compare with saved
   properties) reusing existing handlers (contact modal, advisor handoff,
   compare route) — no new mechanisms.
5. **Ask myMakan What Next?** (brief §17): a button that calls
   `fetchViewingNextSteps`, rendering the "Your Visit Summary" text and a
   "Suggested Next Steps" list. Make clear in the UI that suggested actions
   are informational only (no auto-contact/auto-negotiate).

New i18n keys, RTL-checked. Verify `npx tsc --noEmit` + `npx vite build`
clean. Manually walk the full web customer journey end-to-end on one rent and
one sale property in the dev server: schedule → (use backend/partner API or
a quick DB update to move it to confirmed+completed if the partner UI isn't
built yet, note this in your manual-test notes) → checklist → check items +
note → feedback → Ask myMakan What Next. Update tracking doc's "Screens
changed" (web, now complete) and begin "Investor demo steps" with the web
Rent walkthrough. Stop there.
```

---

## Prompt 10 — Web: Partner Portal Viewing Requests

```
Read only: docs/implementation/mymakan-viewings.md,
frontend/src/routes/partner.tsx (skim structure/auth pattern only — 3137
lines, don't read in full), frontend/src/routes/partner.leads.$leadId.tsx
(structural template for a new routed partner sub-page), 
frontend/src/routes/partner.requests.tsx (another close structural sibling —
tabs/status-filtered operational list), frontend/src/lib/api/maskan.ts
(fetchPartnerLeads/acceptLead/rejectLead ~1556-1585 as the request-shape
template for the new partner viewing endpoints from backend Prompt 4).

Task:
1. Add to `maskan.ts`: `fetchPartnerViewings(status?)`, `fetchPartnerViewing(id)`,
   `confirmViewing(id, note?)`, `proposeViewingTime(id, payload)`,
   `cancelViewingAsPartner(id, reason)`, `completeViewing(id)`,
   `markViewingNoShow(id, who)` — matching backend Prompt 4's endpoints.
2. New route `frontend/src/routes/partner.viewings.tsx`: **Viewing Requests**
   per brief §7 — tabs New Requests / Confirmed / Reschedule / Completed /
   Cancelled, each row/card showing customer display name, property,
   requested date/time, lead status if linked, request age, viewing status.
   Actions per brief §7 exactly (New: Confirm / Propose New Time /
   Decline-Cancel; Confirmed: Open / Message Customer / Mark Completed / Mark
   No Show). Do not expose more customer info than the existing partner leads
   view already shows (match that privacy bar).
3. New route `frontend/src/routes/partner.viewings.$id.tsx` (or a modal
   opened from the list, matching whichever pattern
   `partner.leads.$leadId.tsx` uses): confirm flow per brief §8 (show
   property/customer/requested time/optional note, single "Confirm Viewing"
   action), propose-new-time flow per brief §9 (date/time/optional note),
   cancel flow with mediator reason list (Property unavailable / Owner
   unavailable / Schedule conflict / Other).
4. Ensure the customer side (Prompts 7-9) reflects a partner confirm/
   reschedule/cancel action promptly through whatever existing
   refresh/polling mechanism the app already uses (check if `NotificationBell`-
   equivalent polling exists on web, or if it's refetch-on-focus/navigation —
   don't build a new real-time mechanism).

New i18n keys, RTL-checked (partner portal is desktop-first per brief §20,
but keep strings translatable). Verify `npx tsc --noEmit` + `npx vite build`
clean. Manually walk: as a test mediator, see a new viewing request → confirm
it → as the test customer, see it become Confirmed on My Viewings without a
hard refresh (or note if a refresh is currently required and that's
consistent with how leads already behave). Update tracking doc's "Screens
changed" (web, partner portal) and add the partner side to "Investor demo
steps". Stop there.
```

---

## Prompt 11 — Mobile: Schedule Viewing + My Viewings + Viewing Detail

```
Read: mobile/CLAUDE.md (i.e. mobile/AGENTS.md's Expo-version warning) first.
Then read only: docs/implementation/mymakan-viewings.md,
mobile/app/property/[id].tsx (skim — 1335 lines; locate `handleContactAgent`
~line 206 and its `Pressable` ~825 as the anchor for a new "Schedule Viewing"
action), mobile/app/_layout.tsx (Stack.Screen registration list, lines
~65-92 — you WILL need to add entries here for every new screen file),
mobile/src/lib/api/maskan.ts (createLead ~558, fetchMyLeads ~597 as the
template for new viewing functions — mirror Prompts 7-8's web function names/
shapes exactly for consistency), mobile/src/lib/i18n/en.ts and ar.ts
(`property:` namespace ~504/501), mobile/src/components/ui/ (list directory —
`BottomSheet.tsx`, `SegmentedControl.tsx`, `Chip.tsx` are your building blocks
for the time picker and status tabs).

Task: port Prompts 7-8's web functionality to mobile, using the SAME backend
endpoints (no mobile-only backend changes):
1. Add the same `createViewing`/`fetchMyViewings`/`fetchViewing`/
   accept-reschedule/propose-time/cancel functions to
   `mobile/src/lib/api/maskan.ts`.
2. Add a **Schedule Viewing** action on `mobile/app/property/[id].tsx`
   alongside the existing contact-agent action, opening either a new screen
   (`mobile/app/viewing/new.tsx`) or a `BottomSheet`-based flow (mobile-native
   choice — your call, but a full screen is likely cleaner for a multi-step
   date/time/note/review flow on small screens; document the choice) — same
   date/time selection rules as web (business hours, 30/60-min slots,
   "Request a preferred time" labeling, Saudi default timezone), same
   "Viewing Requested — waiting for confirmation" result state, same
   upcoming-viewing banner on the property screen, same duplicate-prevention
   UX.
3. New screen `mobile/app/viewings/index.tsx` (**My Viewings**, tabs via
   `SegmentedControl`) and `mobile/app/viewings/[id].tsx` (**Viewing
   Detail**, timeline + actions), mirroring web Prompt 8's structure and
   status→tab mapping (reuse the same mapping documented in the tracking
   doc, don't redefine it differently for mobile).
4. Register every new screen file in `mobile/app/_layout.tsx`'s
   `<Stack.Screen>` list (this is easy to forget and the screens will 404 in
   the app without it).
5. Add a viewings entry point somewhere reachable (tab bar has been reduced
   to Home/Search/AI/Saved/Profile per recent history — check
   `mobile/app/_layout.tsx`/tab config for the current nav structure and
   place "My Viewings" as a Profile-screen link or similar, not a new tab,
   unless the existing nav already has room — your call, document it).

New i18n keys mirroring the web namespace/key names from Prompts 7-8 for
consistency. Verify `npx tsc --noEmit` in `mobile/` is clean. If a
device/emulator or `npx expo start` is available in this environment,
manually walk: property → Schedule Viewing → My Viewings → detail → cancel,
for one rent and one sale property. If no device/emulator is available, say
so explicitly rather than claiming a manual check happened. Update tracking
doc's "Screens changed" (mobile, partial). Stop there.
```

---

## Prompt 12 — Mobile: AI Checklist + During-Viewing + Post-viewing feedback + Ask myMakan

```
Read: mobile/CLAUDE.md first. Then read only:
docs/implementation/mymakan-viewings.md,
mobile/app/viewings/[id].tsx (from Prompt 11),
mobile/src/lib/api/maskan.ts (viewing functions from Prompt 11),
mobile/src/components/ui/ (Accordion.tsx/Banner.tsx for checklist sections
and the visit-summary card), whatever mobile screen currently hosts the AI
Advisor chat (locate via grep for the sessionStorage-equivalent
advisor-context handoff mentioned in the tracking doc/Prompt 9, adapted to
mobile's actual storage mechanism — check what mobile uses instead of
sessionStorage, e.g. a navigation param or AsyncStorage).

Task: port web Prompt 9's functionality to mobile Viewing Detail
(`mobile/app/viewings/[id].tsx`):
1. Add `fetchViewingChecklist`/`updateViewingChecklist`/
   `submitViewingFeedback`/`fetchViewingNextSteps` to
   `mobile/src/lib/api/maskan.ts`, matching Prompt 11's endpoint set.
2. **Prepare for Your Visit / AI Checklist** section, same sectioned
   structure as web (Verify During Visit / property-specific / rent-or-buy
   questions), deterministic fallback always renders even without AI
   annotations.
3. **During Viewing** mode: checkable items (native checkbox/`Chip` toggle
   component) + private notes input, persisted via `updateViewingChecklist`
   with a debounced/on-blur save — no offline sync per the brief.
4. **Post-viewing decision**: "How did it go?" (Very Interested/Maybe/Not
   Interested) + optional note + optional reason, only shown once
   `status === "completed"`, wired to `submitViewingFeedback`. Very
   Interested surfaces the same three suggested actions as web (contact
   mediator, ask AI negotiation, compare saved properties) using mobile's
   existing equivalents of those handlers.
5. **Ask myMakan What Next?** button calling `fetchViewingNextSteps`,
   rendering the visit summary + suggested next steps, same
   informational-only framing as web (no auto-contact/negotiate language).

New i18n keys mirroring web's `property.viewing.*` key names. Verify
`npx tsc --noEmit` in `mobile/` clean. If a device/emulator is available,
manually walk: confirmed viewing → checklist check items + note → (move to
completed via partner web portal or a DB update, note how you did it) →
feedback → Ask myMakan What Next, for one rent and one sale property. If not
available, say so explicitly. Update tracking doc's "Screens changed"
(mobile, now complete) and add mobile-specific notes to "Investor demo steps"
only if materially different from web. Stop there.
```

---

## Prompt 13 — Tests, validation, investor-demo walkthrough, docs finalization

```
Read only: docs/implementation/mymakan-viewings.md, and
`git diff main...feature/mymakan-phase1 --stat` scoped mentally to files
touched by Prompts 1-12 (do not re-read every file in full — use the diff
stat plus the tracking doc's running notes).

Task:
1. Run the full backend suite: `pytest -q` in `backend/`. Confirm only the
   already-known unrelated failure remains
   (`test_list_properties_date_range_filter_excludes_conflicting_booking`)
   and nothing from Prompts 1-6 regressed. Re-verify the §22 validation
   rules from the brief are all actually enforced and tested: customer owns
   viewing, mediator authorized for property (direct `mediator_id` check,
   never trusting a client-supplied mediator id), property is active/
   Published, requested time is in the future, valid status transitions
   only, no duplicate active viewing per customer+property, users can't
   touch another user's viewing, mediators can't manage unrelated-property
   viewings. Add a focused test for any genuine gap found — do not build a
   large new suite.
2. Run `npx tsc --noEmit` and `npm run build` in `frontend/`; run
   `npx tsc --noEmit` in `mobile/`. All must be clean.
3. Fill in every remaining TODO section of
   `docs/implementation/mymakan-viewings.md`: Feature completed / Models /
   APIs / Status flow / Lead integration / AI checklist behavior / AI
   post-viewing assistant / Notifications / Screens changed / Tests / Known
   limitations / Investor demo steps. For "Investor demo steps," write out
   the full §23 storyline for BOTH Rent and Buy, end to end: AI Home Finder →
   Match → Property Intelligence → Trust Center → Schedule Viewing → Tuesday
   5:00 PM request → Partner Portal new request → Propose 6:30 PM →
   Customer sees update → Accept 6:30 PM → Viewing Confirmed → Prepare for
   Your Visit / AI Checklist → During Viewing checks + private notes →
   Partner Mark Completed → Customer Very Interested → Ask myMakan What
   Next? → AI visit summary + negotiation suggestion — referencing real
   property/mediator/customer ids from the dev DB where possible so the demo
   is copy-pasteable end to end on both web and mobile.
4. Explicitly confirm/note in "Known limitations": no real
   mediator-availability calendar (all times are "requested," never a true
   available-slot system per brief §4), no calendar-sync, no
   SMS/WhatsApp, review-writing only if it plugged into an existing review
   flow (note whether it did), and anything else scoped out per the brief's
   exclusion list that came up during implementation.
5. Give a concise final implementation summary in your response (not a new
   file) covering: what was built across backend/web/mobile/partner portal,
   what existing functionality was reused (leads, notifications, AI gateway,
   auth, design system), the full API surface, and any known limitations an
   investor demo should route around.

Do not start any other feature. Commit is optional — leave staged/unstaged
changes for the user to review. Stop there.
```
