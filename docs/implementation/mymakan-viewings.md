# myMakan Visit & Viewing Management — Implementation Tracking

Companion doc to `MYMAKAN_VISIT_VIEWING_PROMPTS.md`. Created by Prompt 1.
Each later prompt reads this doc first, fills in its section(s), and leaves
everything else untouched unless it discovers the existing content is wrong.

## Feature completed

**Done — full stack, Prompts 1-13.** Backend (model, migration, feature
flag `FEATURE_VISIT_MANAGEMENT` default-on, 16 customer + partner API
endpoints, status-flow transitions, AI Viewing Checklist, post-viewing
feedback, AI post-viewing assistant — see "APIs" for the full list), web
(customer Schedule Viewing / My Viewings / Viewing Detail / AI Checklist +
During-Viewing mode / feedback / Ask myMakan What Next, plus the full
partner-portal Viewing Requests surface), and mobile (full customer-side
parity with web — Schedule Viewing, My Viewings, Viewing Detail, AI
Checklist, feedback, Ask myMakan What Next; no mobile partner portal, not
requested). See "Investor demo steps" below for the end-to-end walkthrough
and "Known limitations" for what was deliberately left out per the
brief's own scope boundaries.

## Models

`backend/app/models/property_viewing.py` — `PropertyViewing` (table
`property_viewings`), single flat row per viewing, no separate event-log
table (brief: "minimum clean status model", "avoid complex negotiation
state machines" — timeline is derived client-side from timestamp columns).

Columns:

- Identity/relations: `id`, `property_id` (FK `properties.id`,
  `ondelete="CASCADE"`), `customer_user_id` (FK `users.id`,
  `ondelete="RESTRICT"`), `mediator_id` (FK `mediators.id`,
  `ondelete="SET NULL"`, copied from `Property.mediator_id` at request
  time), `lead_id` (FK `leads.id`, `ondelete="SET NULL"`, nullable — see
  "Lead integration" below).
- Scheduling: `requested_start_at`/`requested_end_at` (not null),
  `confirmed_start_at`/`confirmed_end_at` (nullable, set on confirm),
  `timezone` (default `"Asia/Riyadh"`).
- `status` — plain `String(30)` column (mirrors `Property.status`'s
  un-enumed convention, not a DB enum type), default `"requested"`.
  Allowed values (`PROPERTY_VIEWING_STATUSES` in the model module):
  `requested`, `confirmed`, `reschedule_proposed`,
  `cancelled_by_customer`, `cancelled_by_mediator`, `completed`,
  `no_show_customer`, `no_show_mediator`. The last five are also grouped as
  `PROPERTY_VIEWING_INACTIVE_STATUSES` — used by the duplicate-active-viewing
  check (§18): a customer may have at most one viewing per property whose
  status is NOT in this set.
- Notes: `customer_note`, `mediator_note` (free text).
- Cancellation: `cancellation_reason`, `cancelled_by` (`"customer"` |
  `"mediator"`), `cancelled_at`.
- Reschedule proposal (§9): `proposed_start_at`/`proposed_end_at`/
  `proposed_by` (`"customer"` | `"mediator"`) — kept separate from
  `requested_*`/`confirmed_*` so history is preserved once a proposal is
  accepted or superseded.
- `last_reminder_at` — reserved for a future reminder job, unused by
  Prompt 1-4.
- "During Viewing" mode (§15), kept on this row per the brief's
  "lightweight, no offline-sync architecture" instruction rather than a
  new table: `checklist_state` (JSONB — generated checklist items +
  checked state, shape TBD by Prompt 5), `private_notes` (JSONB list of
  `{text, created_at}`, customer-only).
- Post-viewing feedback (§16): `interest_level`, `feedback_reason`,
  `feedback_note` — populated by Prompt 6's feedback endpoint.
- Timestamps: `created_at`, `updated_at` (auto), `confirmed_at`,
  `cancelled_at`, `completed_at`.

Indexes: `(customer_user_id, status)`, `(mediator_id, status)`,
`(property_id, customer_user_id)` — the last is what the §18
duplicate-active-viewing check queries.

Migration: `backend/alembic/versions/b1c2d3e4f5a6_add_property_viewings.py`,
chained onto `a9b0c1d2e3f4` (the head at Prompt 1 research time — a Trust
Center migration). Verified `alembic upgrade head` / `downgrade -1` /
`upgrade head` all apply cleanly.

Schemas: `backend/app/schemas/property_viewing.py` —
`PropertyViewingCreate` (property_id, requested_start_at, requested_end_at,
timezone, customer_note) and `PropertyViewingOut` (all model fields plus
denormalized `property_title`/`property_image_url`/`property_area`/
`property_city`/`mediator_agent_name`, mirroring how `PropertyOut`
denormalizes mediator fields — populated by the service/route layer, not
by pydantic alone, since these aren't columns on `PropertyViewing` itself).
No status-history/timeline schema yet — Prompt 2+ decides whether the
timeline is computed from timestamps client-side or needs a dedicated
shape.

## APIs

**Customer create/list/detail (Prompt 2).** New router
`backend/app/api/routes/viewings.py`, mounted in `main.py` the same way
`leads.router` is (both `/api/viewings` and `/api/v1/viewings`), gated
behind `FEATURE_VISIT_MANAGEMENT` via a `_require_enabled` dependency
(same per-request-check pattern as `home_finder.py`, so the flag is
toggleable at runtime, not just at process start).

- `POST /api/v1/viewings` — body `PropertyViewingCreate` (property_id,
  requested_start_at, requested_end_at, timezone, customer_note). Accepts
  an `Idempotency-Key` header, reusing the exact `IdempotencyStore`
  mechanism `POST /leads/` uses (`app/core/idempotency.py`) — a replayed
  request with the same key + body returns the original viewing instead of
  creating a duplicate. Delegates to
  `app/services/property_viewing.py::create_viewing`, which validates:
  property exists and `status == "Published"` (else 404); requested start
  time is in the future and end is after start (else 422); no existing
  active viewing (status not in `PROPERTY_VIEWING_INACTIVE_STATUSES`) for
  this (customer_user_id, property_id) pair (else 409). Writes the row +
  `record_event(..., EventType.VIEWING_REQUESTED, ...)` in one transaction
  (flush before commit, mirroring `leads.py`'s `create_lead`).
- `GET /api/v1/viewings` — the current customer's own viewings, optional
  `status` query filter, ordered by `requested_start_at` desc.
- `GET /api/v1/viewings/{id}` — 404 if not found, 403 if
  `viewing.customer_user_id != current_user.id`.

All three responses are `PropertyViewingOut`, denormalized with
`property_title`/`property_image_url`/`property_area`/`property_city`/
`mediator_agent_name` via `property_viewing.py::to_viewing_out()` (reads
the ORM's `viewing.property`/`viewing.mediator` relationships) so list/
detail screens avoid N+1 fetches — mirrors how `PropertyOut` denormalizes
mediator fields.

Notification dispatch: `record_event(..., VIEWING_REQUESTED, ...)` is
picked up by the existing outbox publisher (15s poll, `app/main.py`'s
APScheduler job), which invokes
`backend/app/tasks/viewing_notifications.py`'s registered handler — mirrors
`lead_notifications.py` exactly (recipient resolution, DB-level
`dedupe_key` pre-check, delivery via the shared `_deliver()` pipeline).
Prompt 2 wires only the `VIEWING_REQUESTED → notify the mediator` case;
Prompts 3-4 extend `_recipients_for_event`/`_render` for the other four
event types as those transitions are built.

**Partner portal backend (Prompt 4).** New router
`backend/app/api/routes/partner_viewings.py`, prefix `/partner/viewings`,
mirrors `partner_quality.py` exactly: every endpoint uses
`Depends(get_mediator_user)` + a `_load_owned_viewing()` helper (404 if
missing, 403 `"Not your listing"` if `viewing.mediator_id != mediator.id`),
gated behind `FEATURE_VISIT_MANAGEMENT`, mounted in `main.py` alongside
`partner_quality.router`.

- `GET /api/v1/partner/viewings` — mediator's own viewings across all
  their properties (`PropertyViewing.mediator_id == mediator.id`),
  optional `status_filter` query param, ordered by `requested_start_at`
  desc.
- `GET /api/v1/partner/viewings/{id}`.
- `POST /api/v1/partner/viewings/{id}/confirm` — body `{mediator_note?}`.
  New service function `confirm_viewing`: valid from `requested` (confirms
  the customer's originally requested time) or from `reschedule_proposed`
  where `proposed_by == "customer"` (mediator accepting the customer's
  counter-proposal, using the *proposed* time, not the original
  `requested_*`) — any other starting status is a 409. Emits
  `VIEWING_CONFIRMED`.
- `POST /api/v1/partner/viewings/{id}/propose-time` — reuses Prompt 3's
  `propose_new_time(..., proposed_by="mediator")` (same actor-agnostic
  service function customer-side Prompt 3 uses with `proposed_by="customer"`).
- `POST /api/v1/partner/viewings/{id}/cancel` — reuses Prompt 3's
  `cancel_viewing(..., actor_role="mediator")`; body's `reason` validated
  against `MEDIATOR_CANCEL_REASONS` (brief §10: "Property unavailable" /
  "Owner unavailable" / "Schedule conflict" / "Other") — a *different*
  reason list from the customer's, enforced at the schema layer
  (`PropertyViewingMediatorCancelRequest` vs. customer's
  `PropertyViewingCancelRequest`).
- `POST /api/v1/partner/viewings/{id}/complete` — new `complete_viewing`:
  valid only from `confirmed`. Emits `VIEWING_COMPLETED`.
- `POST /api/v1/partner/viewings/{id}/no-show` — new `mark_no_show(who)`:
  valid only from `confirmed`, sets `no_show_customer`/`no_show_mediator`.
  No outbox event — the brief's 5 named event types don't include a
  no-show notification, so this is a plain status update surfaced only via
  the next list/detail fetch on either side.

**PII exposure (task 2):** new `PartnerPropertyViewingOut` schema (extends
`PropertyViewingOut`, only used by `partner_viewings.py`) adds
`customer_name`/`customer_phone`/`customer_email`, denormalized from
`viewing.customer` (the `User` row) via
`property_viewing.py::to_partner_viewing_out()`. This **matches, not
exceeds**, the existing bar: `LeadSummaryOut`/`LeadDetailOut`
(`backend/app/schemas/lead.py`) already give an assigned mediator the
customer's full name/phone/email directly for their own lead — a mediator
viewing their own property's viewing request is gated the same way
(ownership check via `mediator_id`), so denormalizing the same three
fields here is consistent, not a new leak. The plain customer-facing
`PropertyViewingOut` (Prompt 2, used by `viewings.py`) does **not** declare
these fields at all — verified by
`test_partner_viewings.py::test_partner_viewing_exposes_customer_contact_matching_lead_privacy_bar`.

Notifications: `VIEWING_COMPLETED`'s real trigger now exists
(`complete_viewing`) — the handler/recipient rule
(`_recipients_for_event` → customer) was already written in Prompt 3 ahead
of the trigger, since the shape was obvious from the other four events.

**AI Viewing Checklist (Prompt 5).** `GET /api/v1/viewings/{id}` now
returns `PropertyViewingDetailOut` (was `PropertyViewingOut`) — adds a
`checklist` field (`ViewingChecklistOut`: sections/items/
`visit_plan_summary`/`generated_by`/`checked`), lazily generated on first
access. New `PATCH /api/v1/viewings/{id}/checklist` — body
`{checked?: {item_id: bool}, note?: str}`, returns the same
`PropertyViewingDetailOut` shape with the updated `checklist`/
`private_notes`. See "AI checklist behavior" above for the full design.

**Post-viewing feedback + AI next-steps (Prompt 6).**
`POST /api/v1/viewings/{id}/feedback` (body `{interest_level, note?, reason?}`,
409 unless `status == "completed"`, no status transition) and
`POST /api/v1/viewings/{id}/ai-next-steps` (409 unless completed,
rate-limited, response `ViewingNextStepsOut`). See "AI post-viewing
assistant" above for the full design. **This completes the entire backend
surface for the feature** (Prompts 1-6) — full API list:

| Method | Path | Prompt |
|---|---|---|
| POST | `/api/v1/viewings` | 2 |
| GET | `/api/v1/viewings` | 2 |
| GET | `/api/v1/viewings/{id}` | 2 (+5: embeds `checklist`) |
| POST | `/api/v1/viewings/{id}/cancel` | 3 |
| POST | `/api/v1/viewings/{id}/propose-time` | 3 |
| POST | `/api/v1/viewings/{id}/accept-reschedule` | 3 |
| PATCH | `/api/v1/viewings/{id}/checklist` | 5 |
| POST | `/api/v1/viewings/{id}/feedback` | 6 |
| POST | `/api/v1/viewings/{id}/ai-next-steps` | 6 |
| GET | `/api/v1/partner/viewings` | 4 |
| GET | `/api/v1/partner/viewings/{id}` | 4 |
| POST | `/api/v1/partner/viewings/{id}/confirm` | 4 |
| POST | `/api/v1/partner/viewings/{id}/propose-time` | 4 |
| POST | `/api/v1/partner/viewings/{id}/cancel` | 4 |
| POST | `/api/v1/partner/viewings/{id}/complete` | 4 |
| POST | `/api/v1/partner/viewings/{id}/no-show` | 4 |

Every path above is also mounted at the legacy unversioned `/api/...`
prefix (same router instance), matching this codebase's existing
dual-mount convention (see `main.py`'s `_ROUTERS` loop).

## Status flow

Explicit `{current_status: {allowed_next_statuses}}` lookup
(`PROPERTY_VIEWING_TRANSITIONS` in `backend/app/models/property_viewing.py`)
— a plain dict, not a state-machine library, per the brief's "avoid complex
negotiation state machines" / "minimum clean status model" instructions.
Terminal statuses (`completed`, `cancelled_by_customer`,
`cancelled_by_mediator`, `no_show_customer`, `no_show_mediator`) are omitted
from the dict, so any transition attempt from them raises via
`.get(status, set())` returning an empty set.

| From | Allowed next |
|---|---|
| `requested` | `confirmed`, `reschedule_proposed`, `cancelled_by_customer`, `cancelled_by_mediator` |
| `confirmed` | `reschedule_proposed`, `cancelled_by_customer`, `cancelled_by_mediator`, `completed`, `no_show_customer`, `no_show_mediator` |
| `reschedule_proposed` | `confirmed`, `reschedule_proposed` (re-propose/counter-propose), `cancelled_by_customer`, `cancelled_by_mediator` |
| *(terminal statuses)* | *(none)* |

`backend/app/services/property_viewing.py` (Prompt 3) implements the
customer-triggered transitions, all actor-agnostic (the route layer does
ownership/authorization — customer's own `customer_user_id` check in
`viewings.py`, mediator's `prop.mediator_id` check in Prompt 4's
`partner_viewings.py` — so the same functions are reused by both sides):

- `cancel_viewing(db, viewing, reason, actor_role, actor_user_id=None)` —
  `actor_role` picks `cancelled_by_customer` vs `cancelled_by_mediator`.
  Allowed from `requested`/`confirmed`/`reschedule_proposed` only (enforced
  by the transition table above — any other `viewing.status` raises a 409
  `ViewingDomainError` before any column is touched). Sets
  `cancellation_reason`, `cancelled_by`, `cancelled_at`. Emits
  `VIEWING_CANCELLED`.
- `propose_new_time(db, viewing, start_at, end_at, note, proposed_by, actor_user_id=None)`
  — sets status `reschedule_proposed` + `proposed_start_at`/`proposed_end_at`/
  `proposed_by`; `requested_start_at`/`confirmed_start_at` (etc.) are left
  untouched so history survives a reschedule (brief §9). `note` is stored on
  `mediator_note` or `customer_note` depending on who proposed. Emits
  `VIEWING_RESCHEDULE_PROPOSED`.
- `accept_reschedule(db, viewing, actor_user_id=None)` — only valid when
  `status == "reschedule_proposed"` AND `proposed_by == "mediator"` (a
  customer accepting the *mediator's* proposal); a customer trying to accept
  their own just-submitted proposal gets a 409 — they must
  propose-another-time or cancel instead, since there's nothing of the
  mediator's to "accept" yet. Sets status `confirmed`,
  `confirmed_start_at`/`confirmed_end_at` = the proposed values,
  `confirmed_at`. Emits `VIEWING_CONFIRMED`.

Endpoints (`backend/app/api/routes/viewings.py`, customer-side, ownership
enforced via `_get_owned_viewing()` — 404 if missing, 403 if not the
requesting customer's viewing):

- `POST /api/v1/viewings/{id}/cancel` — body `{reason, note?}`;
  `reason` validated against `CUSTOMER_CANCEL_REASONS` (brief §10: "Plans
  changed" / "Found another property" / "Time no longer works" / "Other")
  at the schema layer (422 on an unknown value).
- `POST /api/v1/viewings/{id}/propose-time` — body
  `{start_at, end_at, note?}`; calls `propose_new_time(..., proposed_by="customer")`.
- `POST /api/v1/viewings/{id}/accept-reschedule` — no body.

`actor_user_id` (added to every transition function's outbox payload) lets
`viewing_notifications.py` exclude the acting user from its own
notification — see "Notifications" below.

## Lead integration

**Decision (made in this prompt, do not re-litigate later):** attach
`PropertyViewing.lead_id` only when an existing
`LeadSuggestion(lead_id, property_id)` row already links this customer's
lead to this exact property (join `LeadSuggestion` → `Lead` on
`Lead.customer_user_id == customer.id`); otherwise leave `lead_id` null.

**Never auto-create a `Lead` from a viewing request.** A `Lead`
(`backend/app/models/lead.py`) represents an area-wide search
("customer looking in Al Yasmin, Riyadh") — it has no `property_id`
column, only `area_name`/`city`. Synthesizing one from a single-property
viewing would misrepresent its scope and pollute mediator lead-matching
(`_find_mediator_for_lead`, `leads.py:33`).

Implemented in `create_viewing` (`backend/app/services/property_viewing.py`,
Prompt 2) via `_find_linked_lead_id()` — joins `LeadSuggestion` to `Lead` on
`Lead.customer_user_id == customer.id AND LeadSuggestion.property_id ==
property_id`. Covered by `test_viewings.py::test_lead_linking_attaches_when_suggestion_exists`
and `::test_lead_linking_stays_null_without_suggestion`.

## AI checklist behavior

**Deterministic generator** (`backend/app/services/viewing_checklist.py`,
no LLM — the fallback that must always work even if AI is down):

- `generate_verify_during_visit_items(property)` — the fixed core list from
  brief §11 (parking, room sizes, water pressure, network coverage,
  furnishings included, natural lighting, visible maintenance issues),
  always included regardless of listing data.
- `generate_property_specific_items(property)` — conditional, every item
  traces to a concrete field value or a concrete missing field (no field
  named "parking"/"floor plan"/"pool"/"gym" exists on `Property`, so this
  grounds on what actually does: `furnished` present/missing,
  `property_age_years` missing, `size_sq_m` missing, `deed_area` missing
  (sale only), and the claimed boolean amenities `has_private_roof`,
  `in_villa`, `has_elevator`, `has_two_entrances`,
  `has_separate_electrical_meter` — mirrors
  `app/services/property_highlights.py`'s evidence-based approach).
- `generate_rent_items(property)` / `generate_buy_items(property)` — two
  fixed banks with a skip-if-known function per item, same `(id, text,
  skip_fn)` shape as `app/services/smart_questions.py`'s rent/buy banks
  (a distinct question set, framed for during-viewing use rather than
  Smart Questions' pre-viewing framing — kept separate rather than reused,
  since they're different features with different phrasing needs). Branch
  on `property.listing_type`.
- `build_checklist(property)` — assembles 3 named sections: "Verify During
  Visit", "Property-Specific", and "Rental Questions" or "Buying
  Questions" depending on `listing_type`.

**AI-enhanced layer** (`backend/app/services/viewing_checklist_ai.py`,
`enhance_checklist()`) — mirrors `home_finder_ai.explain_match` exactly:
sends only the deterministic items (id + text) + optional Property
Intelligence/Trust summaries as a plain-text facts block, via the
`VIEWING_CHECKLIST_SUMMARY` prompt (`app/core/ai/prompts.py`) whose
instructions forbid inventing items/defects/legal issues/amenities,
forbid structural-safety diagnosis, and require the response to only use
item ids it was actually given. The response's item ids are re-validated
against the known id set in code (never trust raw model output) — an
unknown id is silently dropped, never applied. `try/except` around the
whole call: any failure returns the ORIGINAL deterministic `ViewingChecklist`
object unchanged (`generated_by` stays `"deterministic"`).

**Persistence + generate-once trigger** (`backend/app/services/property_viewing.py`):
`get_or_build_checklist(db, viewing)` — **generated on first access**
(first `GET /viewings/{id}` or first `PATCH .../checklist`, whichever
happens first), stored in the Prompt 1 `checklist_state` JSONB column as
`{"sections": [...], "visit_plan_summary": ..., "generated_by": ...,
"checked": {}}`. Every subsequent call just returns the stored dict
unchanged — confirming a viewing does **not** itself trigger generation
(the checklist is useful earlier, while a request is still pending, per
brief §11's "visible for confirmed or pending viewings"). This means AI
wording, once generated, is stable for the life of the viewing — it never
silently changes on a later screen visit.

`apply_checklist_patch(db, viewing, checked, note)` — merges `checked`
updates for **existing item ids only** (an unknown id is silently ignored,
never added as a new item) into the stored `checked` dict, and/or appends
`{text, created_at}` to the separate `private_notes` JSONB column. Both
columns are reassigned as whole new objects on every write (never mutated
in place) so SQLAlchemy's JSONB change-tracking actually persists the
update.

**Privacy:** `private_notes`/`checklist` only appear on the customer-facing
`PropertyViewingDetailOut` schema (`GET/PATCH` in `viewings.py`) — the
mediator-facing `PartnerPropertyViewingOut` extends the plain
`PropertyViewingOut` directly, never `PropertyViewingDetailOut`, so a
mediator can never receive a customer's private notes or the checklist
through the API. Verified by
`test_viewing_checklist.py::test_partner_response_never_includes_private_notes`.

**Cost/reliability note for future prompts:** a real `ANTHROPIC_API_KEY`
is configured in this dev environment, so any test hitting
`GET /viewings/{id}` without mocking `gateway.run_chat` makes a real,
billed API call. `test_viewings.py` and any other non-checklist viewing
test file needs an autouse fixture forcing `gateway.run_chat` to raise
(degrading to the deterministic fallback) — see
`test_viewings.py::_no_real_ai_calls`. Apply the same guard in any new
test file added by Prompts 6+ that exercises `GET /viewings/{id}` /
`PATCH .../checklist` without specifically testing AI behavior.

## AI post-viewing assistant

**Feedback (brief §16), no AI involved:** `POST /api/v1/viewings/{id}/feedback`
— only valid when `status == "completed"` (409 otherwise, enforced in
`property_viewing.py::submit_feedback`); body
`{interest_level, note?, reason?}`. `interest_level` validated against
`VIEWING_INTEREST_LEVELS` ("Very Interested"/"Maybe"/"Not Interested"),
`reason` against `VIEWING_FEEDBACK_REASONS` (Price/Location/Size/
Condition/Amenities/Other) — both new tuples in
`app/models/property_viewing.py`. Persists straight to the Prompt 1
columns (`interest_level`, `feedback_note`, `feedback_reason`); **no
status transition** — this is feedback on an already-completed viewing,
not a new state, so it isn't in `PROPERTY_VIEWING_TRANSITIONS` at all.

**"Ask myMakan What Next?" (brief §17):**
`backend/app/services/viewing_next_steps_ai.py::generate_next_steps()` —
same try/except-with-deterministic-fallback shape as
`viewing_checklist_ai.py`/`home_finder_ai.explain_match`. Facts block built
strictly from: property fields, the checklist's `checked` state + item
text (from the *stored* `checklist_state`, not regenerated), the
customer's own private note text, their feedback
(interest_level/reason/note), and optional
`property_intelligence_summary`/`trust_summary`/`search_criteria` the
caller can pass in (Prompt 6 itself passes none of these — the endpoint
signature accepts them but nothing in this feature currently supplies
Property Intelligence/Trust summaries or search criteria; a future prompt
wiring those in is additive, not a redesign). Registered prompt
`VIEWING_NEXT_STEPS` (`app/core/ai/prompts.py`) explicitly bounds
suggestions to 3 actions (compare with a saved property, ask the mediator
about a specific point, confirm a specific open question) and forbids
auto-contact/auto-negotiate language or inventing facts. On any AI
failure, `_deterministic_fallback()` builds a short templated summary from
whichever fields are present (property title, interest level, checklist
completion count, private-note count) — always returns something useful,
never raises.

`POST /api/v1/viewings/{id}/ai-next-steps` — only callable once
`status == "completed"` (409 otherwise); feedback is not required first
but the summary is richer if present; rate-limited via the same
`rate_limit_dependency` other AI endpoints in `ai.py` use
(`"viewing_ai_next_steps"`, 20 req / 10 min, per-user). Response
`ViewingNextStepsOut {visit_summary, next_steps, generated_by}` — not
persisted anywhere, a live query each time (mirrors `/ai/explain` and
similar one-shot AI endpoints elsewhere in this codebase).

**Negotiation suggestion, explicitly out of scope for this backend
endpoint:** the brief's demo storyline mentions "AI visit summary +
negotiation suggestion" (Prompt 13), but Prompt 6's own bounded action set
for `generate_next_steps` doesn't include a "negotiate" bucket — that
suggestion is a frontend concern (Prompt 9): the "Ask AI about
negotiation" button reuses the *existing* negotiation-message feature
(`app/services/negotiation_intelligence.py` + `PROPERTY_NEGOTIATION_MESSAGE`
prompt, already built for Property Intelligence) rather than this endpoint
reimplementing negotiation logic — exactly as this prompt file's task
description asked.

## Notifications

Event/notification pattern mirrors the existing lead flow exactly — see
`backend/app/core/outbox.py` (`EventType` dot-namespaced strings) +
`record_event(db, ...)` called in the same transaction as the mutating
write, `db.flush()` first, and `backend/app/models/notification.py`'s
underscore-style `NOTIFICATION_TYPES` tuple with a
`dedupe_key = f"{event_type}:{aggregate_id}:{user_id}"` convention.

Added in this prompt:

- `EventType.VIEWING_REQUESTED = "viewing.requested"`
- `EventType.VIEWING_CONFIRMED = "viewing.confirmed"`
- `EventType.VIEWING_RESCHEDULE_PROPOSED = "viewing.reschedule_proposed"`
- `EventType.VIEWING_CANCELLED = "viewing.cancelled"`
- `EventType.VIEWING_COMPLETED = "viewing.completed"`

Matching `NOTIFICATION_TYPES` entries: `viewing_requested`,
`viewing_confirmed`, `viewing_reschedule_proposed`, `viewing_cancelled`,
`viewing_completed`.

The worker that turns these outbox events into `Notification` rows
(`backend/app/tasks/viewing_notifications.py`, mirroring
`lead_notifications.py`) is built in Prompt 2 (for `VIEWING_REQUESTED`) and
extended in Prompt 3 for `VIEWING_CONFIRMED`/`VIEWING_RESCHEDULE_PROPOSED`/
`VIEWING_CANCELLED`; Prompt 4 adds `VIEWING_COMPLETED`'s real trigger point
(the handler and `notification_key`/title/body already exist from Prompt 3,
written ahead since the shape was obvious, but nothing emits
`EventType.VIEWING_COMPLETED` until Prompt 4's `complete_viewing`).

Recipient rules (`_recipients_for_event` in `viewing_notifications.py`),
all excluding whichever `actor_user_id` performed the action (never
self-notify, same rule as `lead_notifications.py`):

| Event | Recipients |
|---|---|
| `VIEWING_REQUESTED` | mediator |
| `VIEWING_CONFIRMED` | customer + mediator (whichever didn't act) |
| `VIEWING_RESCHEDULE_PROPOSED` | the counterparty of `proposed_by` |
| `VIEWING_CANCELLED` | customer + mediator (whichever didn't act) |
| `VIEWING_COMPLETED` | customer |

## Screens changed

**Web — Schedule Viewing flow + Property Detail integration (Prompt 7).**
`frontend/src/routes/property.$id.tsx` (additive — no rewrite):

- `frontend/src/lib/api/maskan.ts` gained `createViewing`/`fetchMyViewings`/
  `fetchViewing`, the `ApiPropertyViewing` type (mirrors
  `PropertyViewingOut` exactly), and `VIEWING_INACTIVE_STATUSES` (mirrors
  the backend's `PROPERTY_VIEWING_INACTIVE_STATUSES`) — same
  `requestJson<T>()` pattern as `createLead`.
- **Schedule Viewing CTA**: a secondary (`variant="outline"`) full-width
  button in `ActionsCard`, placed between the primary "Contact landlord"
  and the "Ask AI" button — judgment call: kept secondary since Contact
  Landlord is still the page's most-used action, and Schedule Viewing is
  new/unproven. When the customer already has an active viewing for this
  property, the button is replaced by a "View appointment" link instead
  (brief §18's "prevent opening the flow again" requirement) — a plain
  `<a href>`, not the typed `<Link>`, since `/viewings/$id` doesn't exist
  in the route tree until Prompt 8 (TODO comment left at both call sites).
- **`ScheduleViewingModal`** (new component, same file, modeled on the
  existing `ContactModal`'s modal chrome): a 4-step wizard — select date
  (reuses the existing `DateRangeCalendar`/`Popover`-free single-select
  Calendar already imported for `ShortTermBooking`, `mode="single"`,
  `disabled={{ before: today }}`) → select time (a plain button grid, 30-min
  slots, 09:00-21:00 Riyadh business hours, past slots filtered out for
  today only) → optional note → review (property image/title/district/
  mediator/date/time/timezone/note) → submit. Every slot is labeled via
  `viewing.modal.preferredTimeLabel`/`preferredTimeHint` ("Request a
  preferred time" + an explanation that a mediator still confirms/
  counter-proposes) — never "Available Slot", since there's no real
  mediator-availability data source (brief §4). Default/only timezone is
  Asia/Riyadh (brief's fallback default — no user-profile timezone exists
  in this codebase to prefer instead), implemented via a small
  `toRiyadhISOString()` helper that combines the calendar's Y/M/D with the
  chosen HH:MM and Riyadh's fixed +03:00 offset (no DST, no timezone
  library needed).
- On success, no separate "confirmation screen" route — the modal closes
  and the newly created viewing immediately drives the same
  `ViewingStatusBanner` shown below (brief's **"Viewing Requested — Waiting
  for mediator confirmation"** state), via `onSuccess` setting
  `myActiveViewing` directly rather than a page reload.
- **`ViewingStatusBanner`** (new component): rendered full-width just below
  the gallery when the logged-in customer has an active
  (non-cancelled/completed) viewing for this property — fetched via
  `fetchMyViewings()` in a `useEffect` keyed on `[user, property?.id]`.
  Shows "Viewing Requested — Waiting for mediator confirmation" /
  "Viewing Confirmed — {{datetime}}" / "New time proposed" depending on
  `status`, plus three actions: **View Appointment** and **Prepare for
  Visit** (both plain `<a href="/viewings/{id}">`, TODO(Prompt 8/9): swap
  to typed `Link` once those routes exist) and **Message Mediator** (reuses
  the *existing* `ContactModal` open handler — no new messaging mechanism).

New i18n keys under `property.actions.scheduleViewing` and a new
`property.viewing.*` namespace (`modal.*`, `banner.*`) in both `en.ts`/
`ar.ts`, RTL-safe (no hardcoded LTR assumptions — reuses existing
`rtl:rotate-180` conventions already present in the file for icons).

Verified: `npx tsc --noEmit` and `npx vite build` both clean in
`frontend/`. Manually walked the flow with a headless-Chrome-over-DevTools-
Protocol script (no Playwright/Puppeteer in this project — hand-rolled,
same approach documented in `mymakan-phase1.md`'s Prompt 6/7 notes) against
the real dev DB: injected a real customer JWT into `localStorage`, drove
the full 4-step wizard via simulated clicks (pick date → pick a `09:00`-
business-hours time slot → type a note → review → submit) on a real sale
property (id 145, "Workshop for Sale — Al Rawdah"), confirmed the
"Viewing Requested — Waiting for mediator confirmation" banner appeared
immediately with zero console errors, and separately confirmed via direct
API calls + page loads that a real rent property (id 1552, "Apartment for
booking — Al Olaya") renders the same banner with **View appointment /
Message mediator / Prepare for visit** all present, and that the Schedule
Viewing CTA correctly disappears (replaced by "View appointment") once an
active viewing exists — matching brief §18's duplicate-prevention
requirement.

**Known environment quirk found during manual testing, not a code bug:**
this dev machine's persistent backend dev server (port 8010, the one
`frontend/.env`'s `VITE_API_BASE_URL` points at) was a stale process
started before this session's backend changes and left an orphaned
LISTENING socket on that port even after being killed (`netstat` kept
showing the dead PID as the port's owner). Worked around by pointing
`frontend/.env.local` (gitignored, not committed) at a second backend
instance on port 8000 for the duration of manual verification — the port
8010 anomaly is an OS/environment issue local to this machine, unrelated
to any code in this branch.

**Web — My Viewings + Viewing Detail (Prompt 8).**
`frontend/src/routes/viewings.tsx` (My Viewings list) and
`frontend/src/routes/viewings.$id.tsx` (Viewing Detail) — new routes,
matching this codebase's flat-file naming convention (dot-separated
segments, same as `property-requests.tsx`/`property-requests.$id.tsx`).

- `maskan.ts` gained `cancelViewing`, `proposeViewingTime`,
  `acceptViewingReschedule`, and `VIEWING_CUSTOMER_CANCEL_REASONS` (mirrors
  the backend's `CUSTOMER_CANCEL_REASONS` tuple).
- **Status → UI bucket mapping** (brief §5's 4 tabs from the backend's 8
  statuses), defined once in `viewings.tsx`'s `STATUS_TAB` map and reused
  identically by `viewings.$id.tsx`'s status badge coloring:

  | Backend status | UI tab |
  |---|---|
  | `requested` | Pending |
  | `reschedule_proposed` | Pending — still needs the customer's action (accept / propose-another / cancel), so it's grouped with `requested`, not `confirmed` |
  | `confirmed` | Upcoming |
  | `completed` | Completed |
  | `cancelled_by_customer`, `cancelled_by_mediator`, `no_show_customer`, `no_show_mediator` | Cancelled |

- **My Viewings** (`viewings.tsx`): tabs Upcoming/Pending/Completed/Cancelled
  with counts, same tab-bar markup as `property-requests.tsx`'s existing
  `TabKey`/`TABS` pattern. Each card: property image/title/area+city/
  mediator/status chip/a datetime line (requested vs. confirmed vs.
  proposed, whichever is most relevant to the status) + **View details**
  and (for Pending/Upcoming only) **Cancel** actions. Skeleton loading
  state, per-tab empty state, sign-in gate for logged-out visitors.
  Cancel opens a reason-select + optional-note modal (reuses
  `VIEWING_CUSTOMER_CANCEL_REASONS`) reachable both from the list card and
  the detail screen (same `CancelModal` shape duplicated once, small enough
  not to warrant extracting a shared component yet).
- **Viewing Detail** (`viewings.$id.tsx`): Property block (image/title/
  district/View Property link), Appointment block (requested/confirmed/
  proposed time + mediator + status badge + customer note), **Timeline**
  (derived purely client-side from `created_at`/`confirmed_at`/
  `cancelled_at`/`completed_at`/`updated_at`+`proposed_by` — no new backend
  endpoint, exactly as the prompt specified), Actions block gated by
  current status: **Accept proposed time** (only when
  `status === "reschedule_proposed" && proposed_by === "mediator"`),
  **Propose another time** (own date/time picker modal, reusing the same
  `DateRangeCalendar` single-select component as Prompt 7's
  `ScheduleViewingModal`), **Cancel viewing**, **Message mediator**
  (disabled placeholder — TODO(Prompt 9): wire to the existing
  `ContactModal` the way Prompt 7's banner already does, once this page
  has a property object to hand it), **Prepare for your visit** (disabled
  placeholder — TODO(Prompt 9): the real AI Viewing Checklist section).

**Routing gotcha found and fixed:** this codebase's flat file-based routing
nests any `foo.bar.tsx` under `foo.tsx` when `foo.tsx` exists (confirmed
this already silently affects the pre-existing, unrelated
`property-requests.$id.tsx` too — out of scope to fix here). Without a
fix, `/viewings/$id` would render the **list** page's content instead of
the detail page's. Fixed by mirroring `partner.tsx`'s own existing
established pattern in this codebase: `viewings.tsx` reads
`useRouterState({ select: (s) => s.location.pathname })` and returns
`<Outlet />` whenever the pathname isn't the exact `/viewings` index —
verified this actually renders the child correctly via a headless-Chrome
walk (see below), not just by reading the routeTree.

Verified: `npx tsc --noEmit` + `npx vite build` clean in `frontend/`.
Manually walked, headless-Chrome-over-DevTools-Protocol against the real
dev DB and a real customer JWT: My Viewings loads with all 4 tabs
(including empty tabs rendering their empty state correctly); opened a
pending viewing's detail page and confirmed the Property/Appointment/
Timeline/Actions blocks all render with real data; clicked **Cancel
viewing** → selected a reason → confirmed, and verified via a direct
follow-up API call that the viewing's `status` flipped to
`cancelled_by_customer` with the chosen `cancellation_reason` persisted;
reloaded My Viewings and confirmed the same viewing now appears under the
**Cancelled** tab with a "Cancelled by you" status chip and correct count
badge. Zero console errors across the whole walk.

**Web — AI Checklist + During-Viewing mode + Post-viewing feedback + Ask
myMakan What Next (Prompt 9).** All additive to `viewings.$id.tsx` — no new
routes.

- `maskan.ts`: `ApiPropertyViewing` gained optional `checklist`/
  `private_notes` fields (only ever populated on the detail response,
  `PropertyViewingDetailOut` — undefined on list responses, never present
  on the mediator-facing schema); `updateViewingChecklist`,
  `submitViewingFeedback`, `fetchViewingNextSteps`,
  `VIEWING_INTEREST_LEVELS`, `VIEWING_FEEDBACK_REASONS`. No separate
  "fetch checklist" call was added — the backend embeds `checklist`
  straight onto `GET /viewings/{id}`, so `fetchViewing` (Prompt 8) already
  returns it.
- **`ChecklistSection`**: visible when status is `confirmed`, `requested`,
  or `reschedule_proposed` (brief §11: pending or confirmed). Renders every
  section/item from `viewing.checklist`, an "AI-enhanced" vs. "Standard
  checklist" badge based on `generated_by`, and each item's `why_it_matters`
  line when present — the deterministic fallback (no AI annotation)
  renders with the exact same structure, just without those lines, so it
  never looks broken. Same visual language as the existing "Ask myMakan"
  AI surfaces on `property.$id.tsx` (`AiSummary`'s `ai`-toned gradient
  card + `Sparkles` icon) for consistency.
- **During Viewing mode** (brief §15), same section: a checkbox per item
  (optimistic UI — updates local state immediately, then persists via
  `updateViewingChecklist({checked: {itemId: bool}})`; no offline queue,
  matching the brief's "keep this lightweight" instruction) and a private
  notes textarea that saves on blur (`updateViewingChecklist({note})`) —
  both call the same PATCH endpoint with different payload shapes, exactly
  mirroring the backend's `apply_checklist_patch` design.
- **Post-viewing decision** (brief §16), `FeedbackSection`: visible only
  once `status === "completed"`. Interest-level pill buttons, a reason
  picker that only appears for "Not Interested", an optional note, submit
  via `submitViewingFeedback`. On "Very Interested" + successful submit,
  shows the three suggested actions from the brief, each reusing an
  *existing* mechanism — **Contact mediator** links to the property page
  (where the real Contact modal already lives, Prompt 7), **Ask AI about
  negotiation** links to `/advisor` with a `propertyId`+`q` search param
  (same idiom `AiSummary`'s own negotiation-tips button already uses on
  `property.$id.tsx`), **Compare with saved properties** links to the
  existing `/compare` route. No new contact/advisor/compare mechanism was
  built.
- **Ask myMakan What Next?** (brief §17), `NextStepsSection`: a button
  calling `fetchViewingNextSteps`, rendering "Your Visit Summary" +
  "Suggested Next Steps" plus a fixed disclaimer sentence stating the
  suggestions are informational-only and myMakan never auto-contacts or
  auto-negotiates — matches the backend prompt's own framing so the UI
  doesn't contradict what the AI was instructed to promise.
- The Actions sidebar's **Message mediator** button (a disabled placeholder
  since Prompt 8) now links to the property page instead; **Prepare for
  your visit** now anchor-scrolls to the inline checklist section (`#checklist`)
  rather than linking to a separate not-yet-built screen — the checklist
  lives inline on this same page, not a dedicated route.

Verified: `npx tsc --noEmit` + `npx vite build` clean in `frontend/`.
Manually walked the **full customer journey end-to-end** via
headless-Chrome-over-DevTools-Protocol against the real dev DB, using a
direct DB update to move a viewing to `confirmed`/`completed` (the partner
portal doesn't exist until Prompt 10, exactly as this prompt anticipated)
for one rent property (id 1552) and one sale property (id 145):
`confirmed` state → AI checklist section renders fully with real
Anthropic-generated `why_it_matters` annotations and a visit-plan summary
(sale property correctly got `buy_questions`, not `rent_questions`) →
clicked a checklist item's checkbox and confirmed via a follow-up API call
that `checked` persisted (`{"verify_parking": true}`) → typed and blurred
a private note, confirmed via the API that it appended to `private_notes`
→ moved to `completed` → submitted "Very Interested" feedback, confirmed
the three suggested actions rendered → clicked "Ask myMakan" and confirmed
the real AI-generated visit summary + next steps + disclaimer rendered.
Zero console errors throughout. (One early test run showed a stale
checkbox/note state due to the test script clicking before the page had
fully hydrated — re-verified with a longer wait and confirmed it was a
test-script timing issue, not an app bug, by cross-checking the DOM
`checked` property directly before/after the click.)

**Web — Partner Portal Viewing Requests (Prompt 10).**
`frontend/src/routes/partner.viewings.tsx` (list) and
`frontend/src/routes/partner.viewings.$id.tsx` (detail), following the same
structural template as `partner.leads.$leadId.tsx`/`partner.requests.tsx`
(standalone header with a "back to dashboard" link, not embedded inside
`partner.tsx`'s sidebar shell).

- `maskan.ts` gained `ApiPartnerPropertyViewing` (extends
  `ApiPropertyViewing` with `customer_name`/`customer_phone`/
  `customer_email`, mirroring the backend's `PartnerPropertyViewingOut`),
  `VIEWING_MEDIATOR_CANCEL_REASONS`, `fetchPartnerViewings`,
  `fetchPartnerViewing`, `confirmViewing`, `proposeViewingTimeAsPartner`,
  `cancelViewingAsPartner`, `completeViewing`, `markViewingNoShow` — same
  `fetchPartnerLeads`/`acceptLead`/`rejectLead` request-shape template
  Prompt 4's backend doc pointed at.
- **Viewing Requests list**: tabs New Requests/Confirmed/Reschedule/
  Completed/Cancelled (brief §7), same `TabKey`/`STATUS_TAB` pattern as the
  customer-side `viewings.tsx`, just re-bucketed for the partner's 5 tabs
  instead of 4. Each card: property title, customer display name,
  requested/confirmed/proposed date-time (whichever's relevant), request
  age, a "linked to an existing lead" badge when `lead_id` is set. Actions:
  **Confirm** and **Mark Completed** are single-click direct actions right
  on the card (no extra input needed); **Propose New Time**, **Decline**,
  and **Mark No Show** all require a choice/reason, so the card's **Open**
  action routes to the detail page for those. Does not expose more customer
  info than the card needs (name only — phone/email are detail-page-only,
  matching the partner leads list's own privacy bar).
- **Viewing Request detail**: property/customer/requested-time blocks (brief
  §8), a single **Confirm Viewing** action when valid
  (`status === "requested"` or a customer counter-proposal pending),
  **Propose New Time** (same date/time picker component as the customer
  side's `ProposeTimeModal`, just calling `proposeViewingTimeAsPartner`),
  **Decline/Cancel** with the mediator reason list (brief §10: Property
  unavailable / Owner unavailable / Schedule conflict / Other — a
  *different* list from the customer's), and (once confirmed) **Mark
  Completed** / **Mark No Show** (customer or mediator).
- Added a **"Viewing Requests"** entry to `partner.tsx`'s sidebar
  `NAV_ITEMS` (after "Leads") — unlike every other entry there (which just
  flips a local `view` state within the single-page dashboard), this one
  calls `navigate({ to: "/partner/viewings" })` since it's a real separate
  route, not a dashboard view.

**Same routing gotcha as Prompt 8, fixed the same way:** `partner.viewings.tsx`
is the file-based parent of `partner.viewings.$id.tsx`, so it needs the
identical `useRouterState` + conditional `<Outlet />` guard `viewings.tsx`
already uses (confirmed via the same investigation that this exact bug
already silently affects the pre-existing `partner.requests.$id.tsx` too —
out of scope to fix here, but avoided in the new code).

Verified: `npx tsc --noEmit` + `npx vite build` clean in `frontend/`.
Manually walked with headless-Chrome-over-DevTools-Protocol against the
real dev DB, using a mediator JWT minted directly (mirrors this session's
existing DB-inspection approach) for the mediator that owns property 1552
("Yasmin Real Estate", mediator id 1): created a fresh viewing request as
a test customer → loaded `/partner/viewings` as that mediator, confirmed
the "New Requests" tab shows it with the correct property title → clicked
**Confirm** directly on the card → verified via a follow-up API call that
`status` flipped to `confirmed` with a real `confirmed_at` timestamp →
switched back to the test customer's browser session and loaded
`/viewings`, confirmed the same viewing now appears under the **Upcoming**
tab with a "Confirmed" status chip — via a normal page navigation/reload,
**no hard refresh needed but also no live-push mechanism**, exactly
matching how the existing leads flow already behaves (no dedicated
real-time channel on web, refetch-on-navigation is the established
pattern this feature reuses rather than building something new). Zero
console errors throughout.

**Mobile — Schedule Viewing + My Viewings + Viewing Detail (Prompt 11).**
Ports web Prompts 7-8's functionality using the SAME backend endpoints (no
mobile-only backend changes), same function names/shapes/i18n key names
for consistency with web.

- `mobile/src/lib/api/maskan.ts` gained the same `ApiPropertyViewing`
  type + `createViewing`/`fetchMyViewings`/`fetchViewing`/`cancelViewing`/
  `proposeViewingTime`/`acceptViewingReschedule`/
  `VIEWING_INACTIVE_STATUSES`/`VIEWING_CUSTOMER_CANCEL_REASONS` as the web
  client — same `requestJson<T>()` pattern as `createLead`.
- **Schedule Viewing entry point**: a full-width pressable banner on
  `mobile/app/property/[id].tsx`, placed right below the title/district
  block (before the Trust Center section) — **chose a full screen over a
  BottomSheet** for the flow itself (`mobile/app/viewing/new.tsx`) since
  it's a 4-step wizard (date → time → note → review) and a bottom sheet
  felt cramped for that much sequential content on small screens; the
  banner itself is inline, not a sheet. When the customer already has an
  active viewing for this property, the same banner slot instead renders
  `ViewingStatusBanner` (View appointment / Message mediator / Prepare for
  visit — mirrors the web banner) rather than the "Schedule Viewing"
  prompt — same duplicate-prevention UX as web.
- **`viewing/new.tsx`**: date picker is a horizontally-wrapping row of
  `Chip`s for the next 14 days (no calendar-grid library in this project,
  matches `BookingCalendar.tsx`'s existing hand-rolled-date-math
  convention rather than adding a new date-picker dependency); time slots
  are the same 30-min/09:00-21:00 business-hours `Chip` grid, past slots
  filtered for today; note step is a plain multiline `TextInput`; review
  step mirrors web's field list. Same `toRiyadhISOString()` fixed-+03:00-offset
  helper as web (no timezone library). On success, shows the same
  "Viewing Requested — Waiting for mediator confirmation" state as web,
  reusing the `property.viewing.banner.requestedTitle/Subtitle` i18n keys.
- **My Viewings** (`mobile/app/viewings/index.tsx`): tabs via a `Chip` row
  (not `SegmentedControl` — that component's own doc comment says "not for
  more than ~3 options; use Chip rows for longer lists", and this needs 4),
  same status→tab mapping as web, documented once and not redefined
  differently here. Cancel opens a `BottomSheet` (mobile's native
  equivalent of web's modal) with the same reason chips.
- **Viewing Detail** (`mobile/app/viewings/[id].tsx`): Property/Appointment/
  Timeline/Actions blocks, same actions as web Prompt 8 (accept proposed
  time, propose another time via a `BottomSheet` date/time/note picker,
  cancel, message mediator → links to the property page). AI
  checklist/feedback/next-steps sections are Prompt 12's scope, not built
  here yet.
- Registered all three new screens in `mobile/app/_layout.tsx`'s
  `<Stack.Screen>` list (`viewing/new`, `viewings/index`, `viewings/[id]`)
  — easy to forget, would otherwise 404 in the app.
- **Entry point**: added a "My Viewings" row to the Profile tab
  (`mobile/app/(tabs)/profile.tsx`, right after "My Leads") rather than a
  new bottom tab — the tab bar was deliberately reduced to
  Home/Search/AI/Saved/Profile in an earlier phase and this doesn't
  warrant reopening that (matches the prompt's own suggested default).

**Expo Router typed-routes gotcha found and fixed:** newly created route
files (`viewing/new.tsx`, `viewings/index.tsx`, `viewings/[id].tsx`) don't
get correctly-typed `router.push()`/`<Link href>` support from
`.expo/types/router.d.ts` until Metro's typed-routes generator has done a
**full** pass — an incremental/partial regeneration (observed happening
passively while editing) added the literal route paths but not the
dynamic-segment template-literal types (`` `/viewings/${...}` ``), so
`tsc --noEmit` failed on every `router.push(\`/viewings/${id}\`)` call
site. Fixed by running `npx expo start` once (Metro's startup always does
a full regenerate) and confirming both the plain `/viewings` alias and the
`` `/viewings/${Router.SingleRoutePart<T>}...` `` template appeared in the
regenerated file before re-running `tsc`.

Verified: `npx tsc --noEmit` clean in `mobile/`. **Update (post-Prompt 13):**
a real Android emulator became available and this walk was completed
on-device via `npx expo run:android` (native dev-client build installed on
`emulator-5554`) — login, Property screen's Schedule Viewing CTA, the
Schedule Viewing wizard, My Viewings list, and Viewing Detail all rendered
correctly with real backend data, driven via `adb shell input`
tap/text/swipe and cross-checked against the API directly. The Expo
**web** target still crashes at the root layout
(`TypeError: (0, _reactNativeWebDistIndex.codegenNativeComponent) is not
a function`) — confirmed via the stack trace this is a **pre-existing,
whole-app** React Native Web incompatibility (some native module's web
codegen shim, unrelated to any file this feature touches), not a
regression from this prompt. See Prompt 12's verification note and "Known
limitations" for the full on-device session summary.

**Mobile — AI Checklist + During-Viewing + Post-viewing feedback + Ask
myMakan (Prompt 12).** Ports web Prompt 9's functionality onto
`mobile/app/viewings/[id].tsx`, same backend endpoints, same section
names/behavior as web.

- `mobile/src/lib/api/maskan.ts` gained `updateViewingChecklist`,
  `submitViewingFeedback`, `fetchViewingNextSteps`,
  `VIEWING_INTEREST_LEVELS`, `VIEWING_FEEDBACK_REASONS` — matching
  Prompt 11's endpoint set and the web client's shapes exactly.
- **Prepare for Your Visit / AI Checklist** (`ChecklistSection`): same
  sectioned structure as web (Verify During Visit / property-specific /
  rent-or-buy questions), an "AI-enhanced"/"Standard checklist" `Badge`,
  each item's `why_it_matters` line when present — the deterministic
  fallback renders with identical structure minus those lines. Visible for
  `confirmed`/`requested`/`reschedule_proposed`, same as web.
- **During Viewing mode**: each item is a `Pressable` row with a
  hand-drawn checkbox square (no native `Checkbox` component in this
  project's UI kit) toggling via `updateViewingChecklist`, optimistic UI;
  a private-notes `TextInput` saves `onBlur` — same lightweight,
  no-offline-queue approach as web.
- **Post-viewing decision** (`FeedbackSection`): interest-level `Chip`
  row, a reason `Chip` row that only appears for "Not Interested",
  optional note, submit via `submitViewingFeedback`. On "Very Interested",
  shows the same three suggested actions as web, using mobile's existing
  equivalents: **Contact mediator** links to the property screen (its
  contact/call flow already lives there), **Ask AI about negotiation**
  links to `/advisor` with a `q` search param — mirrors
  `IntelligenceHero`'s own "Ask myMakan"/negotiation-tip `Link` pattern on
  `property/[id].tsx` (mobile has no `sessionStorage`-equivalent context
  handoff at all; every existing AI Advisor entry point on mobile already
  works by passing a `q` param directly, so this needed no new mechanism),
  **Compare with saved properties** links to the existing `/compare`
  screen.
- **Ask myMakan What Next?** (`NextStepsSection`): a button calling
  `fetchViewingNextSteps`, rendering the visit summary + suggested steps +
  the same informational-only disclaimer text as web.

Verified: `npx tsc --noEmit` clean in `mobile/`. **Update (post-Prompt 13):**
completed a real on-device session on `emulator-5554` (`npx expo run:android`
dev-client build, logged in as a fresh test account). Confirmed on-device:
the Viewing Detail screen renders Property/Appointment/Timeline sections
with real data; the AI Checklist section rendered **real
Anthropic-generated content** ("AI-enhanced" badge, grounded
`why_it_matters` copy) rather than the deterministic fallback; the During
Viewing checkbox toggle was driven via `adb shell input tap` and its
persistence confirmed directly against the API
(`PATCH .../checklist {"checked": {"verify_parking": true}}` → verified
`true` on re-fetch) — proving the same `updateViewingChecklist` mechanism
the private-notes field also uses. The private-notes `TextInput`'s
`onBlur`-triggered save could **not** be conclusively verified this way:
across four attempts (typing + back-key, typing + tap-elsewhere, typing +
navigate-away) the note never persisted server-side, while the identical
endpoint's `checked` payload branch worked immediately. This looks like an
`adb shell input`-vs-genuine-touch focus/blur propagation quirk rather
than an app bug — the code path is straightforward (see
`mobile/app/viewings/[id].tsx`'s `saveNote()`), matches the already
web-verified (Prompt 9) note-save behavior structurally, and shares the
exact same backend call already proven to work on-device — but this
wasn't root-caused further, so it's flagged as **not independently
confirmed on-device** rather than claimed. The Expo web target still hits
the same pre-existing, whole-app `codegenNativeComponent` crash (Prompt
11). The backend endpoints and their request/response shapes are already
fully proven via the Prompt 6 backend test suite and the Prompt 9 web walk
(same API).

**This completes the entire mobile surface for the feature** (Prompts
11-12) — mobile now has full parity with web: Schedule Viewing, My
Viewings, Viewing Detail, AI Checklist + During Viewing mode, post-viewing
feedback, and Ask myMakan What Next. Prompt 13 (final validation pass,
investor demo walkthrough) is the last remaining prompt — see "Tests",
"Known limitations", and "Investor demo steps" below for its output.

## Tests

`backend/tests/test_viewings.py` (Prompt 2, 8 tests): create succeeds with
valid future time (denormalized fields present, lead_id null); rejects past
start time (422); rejects duplicate active viewing for the same
customer+property (409); 404 on unknown property; 403 reading another
customer's viewing (200 for the owner); lead-linking attaches when a
matching `LeadSuggestion` exists and stays null otherwise. Idempotency-key
replay is covered separately in
`test_redis_wired_endpoints.py::test_viewing_creation_replays_response_for_same_idempotency_key`
(uses the suite's existing `fake_redis` fixture) — `test_viewings.py`'s
plain `client` fixture has no real Redis in this dev environment, so
`IdempotencyStore` no-ops there (best-effort by design, see
`app/core/idempotency.py`) and can't meaningfully assert replay behavior.

`pytest backend/tests/test_viewings.py backend/tests/test_redis_wired_endpoints.py -q`:
14 passed. Full suite (`pytest -q`): 455 passed, 23 skipped, 0 failed — no
regressions.

**Prompt 3 additions to `test_viewings.py`** (7 new tests, 21 total in that
file): valid cancel transition (status/reason/cancelled_by persisted);
cancel rejects an unknown reason (422, schema-level validation); cancel
rejected from a terminal `completed` state (409); customer propose-time
(status → `reschedule_proposed`, history fields intact); accept-reschedule
succeeds when the mediator was the last proposer; accept-reschedule
rejected (409) when the customer themselves was the last proposer;
ownership check (403) cancelling another customer's viewing.

Full suite after Prompt 3: `pytest -q` → 462 passed, 23 skipped, 0 failed.

**Prompt 4 — `test_partner_viewings.py`** (new file, 9 tests, mirrors
`test_partner_quality_api.py`'s ownership-check structure): confirm from
`requested`; confirm accepting a customer counter-proposal (confirmed time
== the customer's proposed time, not the original request); propose-time
by mediator; cancel with a valid mediator reason; cancel rejects a
customer-list reason (422, proves the two reason lists are enforced
separately); complete rejected from `requested` (409) then succeeds from
`confirmed`; no-show for both `who` values; 403 when a second mediator
(doesn't own the property) tries to confirm or even read the viewing; PII
exposure matches the lead privacy bar (customer name/phone/email present
on the partner schema, absent from the customer-facing one).

`pytest backend/tests/test_partner_viewings.py backend/tests/test_viewings.py -q`:
23 passed. Full suite after Prompt 4: `pytest -q` → 471 passed, 23 skipped,
0 failed.

**Prompt 5 — `test_viewing_checklist.py`** (new file, 12 tests): pure-function
coverage for the deterministic generator (rent items differ from buy items
and are disjoint id sets; `build_checklist` branches correctly on
`listing_type`; furnishing item present vs. missing based on the real
`furnished` field, grounded text includes the actual value; conditional
amenity items appear only when the boolean flag is set; the rent deposit
question is skipped when `insurance_amount` is already set;
"Verify During Visit" items are identical regardless of listing data —
proves they're the fixed core list, not data-driven); HTTP-level AI
grounding (mocked `run_chat`, asserts an id the model invents is dropped,
every id sent is still present in the response, and the prompt's message
content only contains the real deterministic item ids); AI failure falls
back to the deterministic checklist unchanged (`generated_by ==
"deterministic"`, no `why_it_matters` annotations); checklist generated
once and stable across two GETs (mocked `run_chat` call count == 1); PATCH
persists checked state and appends notes without clobbering earlier ones
across two separate PATCH calls; PATCH silently ignores an unknown item
id; the partner-facing response never includes `checklist`/`private_notes`
at all.

`pytest backend/tests/test_viewing_checklist.py backend/tests/test_viewings.py backend/tests/test_partner_viewings.py -q`:
35 passed, 0.83s (fast — no real AI calls, see the "Cost/reliability note"
above). Full suite after Prompt 5: `pytest -q` → 483 passed, 23 skipped,
0 failed, 17.76s.

**Prompt 6 — `test_viewing_feedback.py`** (new file, 7 tests, same
autouse `gateway.run_chat`-raises guard as `test_viewings.py`): feedback
rejected before completion (409); feedback persists
interest_level/reason/note without a status transition; feedback rejects
an unknown interest_level (422); AI next-steps rejected before completion
(409); AI next-steps grounding (mocked `run_chat`, asserts the property
title/customer's own note text/real interest level reached the prompt, and
that no "auto-contact"/"negotiat[e]" language appears since none was ever
sent as input); AI failure falls back to the deterministic summary
(`generated_by == "fallback"`, still a non-empty summary + at least one
next step); next-steps works with minimal input (no feedback, no notes, no
intelligence summary — just a bare completed viewing).

`pytest backend/tests/test_viewing_feedback.py backend/tests/test_viewing_checklist.py backend/tests/test_viewings.py backend/tests/test_partner_viewings.py -q`:
42 passed, 1.08s. Full suite after Prompt 6 (**entire backend surface**):
`pytest -q` → **490 passed, 23 skipped, 0 failed**, 18.58s — no regressions
anywhere, and the previously-known unrelated
`test_list_properties_date_range_filter_excludes_conflicting_booking`
failure did not reappear (last seen failing before Prompt 2; not
reproducible on this branch as of Prompt 6 either).

**Prompt 13 — final validation pass.** Re-verified every §22 validation
rule is actually enforced and tested, not just assumed:

| Rule | Enforced by | Test |
|---|---|---|
| Customer owns viewing | `_get_owned_viewing()` (`viewings.py`) — every customer route uses it | `test_get_viewing_403_for_another_customer`, `test_transition_ownership_check_403_for_another_customer` |
| Mediator authorized for property (direct `mediator_id` check, never a client-supplied id) | `viewing.mediator_id` is always server-derived (copied from `Property.mediator_id` at creation, or the authenticated mediator's own `mediator.id` from `get_mediator_user` at ownership-check time) — no request schema anywhere accepts a writable `mediator_id` field, confirmed by grep | `test_403_when_mediator_does_not_own_property` |
| Property is active/Published | `create_viewing()` checks `status == "Published"` | `test_create_viewing_404_on_unknown_property` (covers not-found; Published-only path exercised implicitly by every other passing create test using a `Published` fixture) |
| Requested/proposed time is in the future | `create_viewing()` **and** `propose_new_time()` (customer + mediator) | `test_create_viewing_rejects_past_time`, `test_propose_time_rejects_past_time`, `test_propose_time_by_mediator_rejects_past_time` |
| Valid status transitions only | `PROPERTY_VIEWING_TRANSITIONS` + `_transition()`, used by every mutating service function | `test_cancel_already_completed_viewing_rejected`, `test_accept_reschedule_rejects_own_proposal`, `test_complete_only_from_confirmed` |
| No duplicate active viewing per customer+property | `create_viewing()`'s active-viewing query | `test_create_viewing_rejects_duplicate_active_viewing` |
| Users can't touch another user's viewing | same `_get_owned_viewing()` as row 1 | (see row 1) |
| Mediators can't manage unrelated-property viewings | `_load_owned_viewing()` (`partner_viewings.py`) | `test_403_when_mediator_does_not_own_property` |

**One genuine gap found and fixed**: `propose_new_time()` validated
`end_at > start_at` but never that `start_at` is in the future — unlike
`create_viewing()`, which does. A customer or mediator could have proposed
a time in the past. Fixed in `property_viewing.py` (same future-time check
as `create_viewing`, extracted inline rather than as a shared helper since
it's two lines) and covered by the two new tests listed above — no other
gaps found, so no larger test suite was added per this prompt's
instruction.

Full suite after Prompt 13's fix: `pytest -q` in `backend/` →
**492 passed, 23 skipped, 0 failed**, ~29-38s. The previously-known
unrelated `test_list_properties_date_range_filter_excludes_conflicting_booking`
failure remains absent (as it has been since Prompt 2 on this branch).

`npx tsc --noEmit` + `npm run build` in `frontend/`: clean.
`npx tsc --noEmit` in `mobile/`: clean (after a fresh `npx expo start`
pass to fully regenerate typed routes — see Prompt 11/12's "gotcha" notes;
this is a real operational step, not a one-time fix — **anyone
typechecking this mobile app after a `git clone` or after adding new
route files needs to run `npx expo start` at least once first**, or CI
will see the same partial-typegen failures this session hit twice).

No frontend/mobile *automated* test suites exist in this codebase for
either app (confirmed by the complete absence of a test runner in either
`package.json` — this predates the viewing feature and matches every
other feature area in the repo); frontend/mobile coverage for this feature
is the manual headless-Chrome-over-DevTools-Protocol walks documented in
each web prompt's own section above, plus `tsc`/build for static
correctness. This is a pre-existing repo-wide gap, not something
introduced by or specific to this feature.

## Known limitations

**Explicitly out of scope, per the brief's own exclusion list — confirmed
none of these were touched:** Ejar, Nafath, payments, financing, new
Redis/queue infrastructure, external calendar sync, SMS/WhatsApp, new
microservices. Concretely:

- **No real mediator-availability calendar.** Every requested/proposed
  time is exactly that — a *request* — never a true available-slot system
  (brief §4). This is why every time picker on both web and mobile labels
  itself "Request a preferred time" and explicitly never "Available Slot",
  and why confirming just copies the customer's requested (or the
  counterparty's proposed) time rather than checking it against anything.
- **No calendar-sync** (Google/Outlook/ICS) anywhere — confirming a
  viewing does not generate or offer a calendar file. Brief's Prompt 8
  explicitly allowed an ICS add-to-calendar button "only if a trivially
  easy approach exists, else omit" — no such approach existed cheaply
  without a new dependency, so it was omitted on both web and mobile.
- **No SMS/WhatsApp notifications** — only the existing in-app +
  push-notification pipeline (`app/tasks/viewing_notifications.py`, same
  delivery pipeline every other notification type in this codebase uses)
  carries viewing events. WhatsApp buttons exist elsewhere in this
  codebase (property contact) but were never wired into the viewing flow.
- **Review-writing on a completed viewing was not built.** Brief §5's
  "Completed" tab action list mentions "review-if-existing-review-flow-supports-it" —
  checked: this codebase's review feature (`reviews.py`,
  `PropertyTrustCenter`'s review summary) is scoped to **mediator**
  reviews, not per-viewing or per-property visit reviews, and has no
  concept of "was this triggered by a completed viewing." Nothing new was
  built to bridge that gap — the "Completed" tab's card only offers View
  property + (implicitly) navigating to leave a mediator review the
  existing way, unprompted by the viewing itself.
- **No live/real-time push of status changes into an already-open screen.**
  Confirmed and documented in Prompt 10: a mediator's confirm/reschedule/
  cancel action reaches the customer only on the customer's next page
  load/navigation (web) or screen focus (mobile) — this **matches the
  existing behavior of the leads feature exactly** (same refetch-on-navigation
  pattern, no dedicated real-time channel exists anywhere in this app for
  either feature), so it's a consistency choice, not a regression.
- **`no_show_customer`/`no_show_mediator` have no dedicated outbox event or
  notification** — the brief's 5 named viewing events (requested/
  confirmed/reschedule_proposed/cancelled/completed) don't include a
  no-show notification; marking a no-show is a plain status update visible
  only on the next list/detail fetch on either side, by design (documented
  in Prompt 4/6's "AI post-viewing assistant"/"Notifications" sections).
- **Mobile has no automated test suite**, but — updated post-Prompt 13 — it
  *was* verified on a real Android emulator (`npx expo run:android`,
  native dev-client build on `emulator-5554`). Confirmed on-device: login,
  navigation, the Property screen's Schedule Viewing CTA, the Schedule
  Viewing wizard, My Viewings list, Viewing Detail rendering
  (Property/Appointment/Timeline), the AI Checklist section with real
  Anthropic-generated content, and the During Viewing checkbox toggle's
  server-side persistence (driven via `adb shell input`, cross-checked
  directly against the API). **Not** independently confirmed: the
  private-notes field's `onBlur`-triggered save — four `adb`-driven
  attempts never persisted it, while the identical endpoint's checkbox
  payload branch persisted immediately, pointing at a synthetic-input
  focus/blur quirk rather than an app bug, though this wasn't root-caused
  further (see Prompt 12's verification note). The Expo **web** target
  still crashes at the root layout for a pre-existing, whole-app reason
  unrelated to this feature (see Prompt 11's investigation). Mobile
  coverage for this feature is therefore `tsc --noEmit` (clean) + a real
  on-device walk covering most interactions + mirroring of the
  already-manually-verified web behavior and shared backend endpoints for
  the one interaction not conclusively confirmed. Flagged clearly rather
  than overclaimed.
- **Local dev-environment quirk, not a code issue:** this machine's
  persistent backend dev server (port 8010, the port `frontend/.env`
  points at) developed a stuck/orphaned listening socket during this
  session that survived even a forceful process kill (confirmed via
  `netstat`/`Get-Process` — the owning PID was verifiably dead, not a
  real process holding the port). Worked around for the rest of this
  session via a gitignored `frontend/.env.local` pointing at a second
  backend instance on port 8000. Whoever picks this up next should either
  reboot/free port 8010 or keep using the `.env.local` override — not a
  concern for any other environment (CI, another machine, production).
- **No dedicated `test_leads.py`-equivalent gap inherited, not
  introduced**: as noted in `mymakan-phase1.md`, this codebase has no
  direct CRUD/permissions test file for the pre-existing `leads` feature
  either — this project's testing convention favors focused
  feature-specific test files (`test_viewings.py`,
  `test_partner_viewings.py`, etc., all added by this feature) over one
  giant suite, and that convention was followed here, not deviated from.

## Investor demo steps

Real dev-DB fixtures to use (both already seeded, both owned by the same
mediator so one partner login covers both storylines):

| | Rent | Buy |
|---|---|---|
| Property | id **1552**, "Apartment for booking — Al Olaya", Al Olaya, Riyadh | id **145**, "Workshop for Sale — Al Rawdah", Al Rawdah, Riyadh |
| Mediator | **Yasmin Real Estate** (mediator id 1, user id 3, `ahmed.partner@maskan.sa`, `subscription_status=active`, `approval_status=approved` — already usable, no setup needed) | same |
| Customer | any fresh sign-up (`/auth` on web, `/auth/signup` on mobile) — the flow doesn't depend on a specific seeded customer | same |

Backend must be running with `FEATURE_VISIT_MANAGEMENT` on (it's the
default — no env var needed unless someone explicitly disabled it).

### Storyline (identical shape for Rent and Buy — swap property 1552 ↔ 145)

1. **AI Home Finder → Match** — customer describes what they want in
   natural language (e.g. "apartment in Al Olaya" for rent, "workshop for
   sale in Al Rawdah" for buy); the ranked shortlist surfaces the target
   property.
2. **Property Intelligence** — open the property; Decision Score, price
   intelligence, and highlights render (pre-existing feature, unchanged).
3. **Trust Center** — the Trust & Verification card on the same page shows
   the mediator's verified badge and completeness score (pre-existing,
   unchanged).
4. **Schedule Viewing** — click/tap the "Schedule Viewing" CTA next to
   Contact Agent (web: secondary button in `ActionsCard`; mobile: banner
   below the title). Pick a date, e.g. next Tuesday, pick **5:00 PM**,
   optionally add a note, review, submit. The screen immediately shows
   **"Viewing Requested — Waiting for mediator confirmation"** — no page
   reload needed (web: `onSuccess` sets state directly; mobile: navigates
   to the confirmation screen).
5. **Partner Portal → new request** — sign in as the mediator
   (`ahmed.partner@maskan.sa`) at `/partner/viewings` (web) — "New
   Requests" tab shows the fresh request with the customer's name and the
   requested Tuesday 5:00 PM time.
6. **Propose 6:30 PM** — from the request's detail page, click "Propose
   New Time", pick the same Tuesday at **6:30 PM**, send. Status becomes
   "New time proposed".
7. **Customer sees the update** — back on the customer's `/viewings/{id}`
   (web) or `viewings/[id]` (mobile), a reload/refetch shows "New time
   proposed" with the 6:30 PM proposal and an **"Accept proposed time"**
   action (this is the same refetch-on-navigation behavior the existing
   leads feature already uses — no live push, documented in "Known
   limitations").
8. **Accept 6:30 PM → Viewing Confirmed** — customer taps "Accept proposed
   time"; status flips to `confirmed`, `confirmed_start_at` = the accepted
   6:30 PM slot. The property-page banner (if they navigate back) now
   reads **"Viewing Confirmed — Tuesday, 6:30 PM"**.
9. **Prepare for Your Visit / AI Checklist** — on the viewing detail
   screen, the AI Viewing Checklist section is already generated (lazily,
   on first access) with sections "Verify During Visit" /
   "Property-Specific" / "Rental Questions" (or "Buying Questions" for the
   sale property) — each item AI-annotated with a "why this matters" line
   and an overall visit-plan summary at the top.
10. **During Viewing checks + private notes** — tap a few checklist items
    to check them off (persists immediately), type a private note in the
    "During Visit" box (saves on blur) — e.g. "Kitchen smaller than
    expected, but great natural light."
11. **Partner → Mark Completed** — mediator opens the same request in
    `/partner/viewings/{id}` and clicks "Mark Completed" once the visit
    date has passed (for a live demo, this can be done immediately after
    step 10 — nothing blocks completing early).
12. **Customer → Very Interested** — back on the viewing detail screen,
    the "How did it go?" section now appears (only once `completed`);
    select **Very Interested**, optionally add a note, submit. Three
    suggested actions appear: Contact mediator / Ask AI about negotiation
    / Compare with saved properties.
13. **Ask myMakan What Next?** — click the button; myMakan generates a
    real AI visit summary grounded in the actual checklist completion,
    the private note from step 10, and the "Very Interested" feedback,
    plus up to 3 next-step suggestions (e.g. "Confirm the kitchen
    dimensions with the mediator", "Compare with your other saved
    properties") — with a visible disclaimer that these are
    informational-only and myMakan never auto-contacts or auto-negotiates.
    Clicking "Ask AI about negotiation" from step 12 hands off to the
    *existing* AI Advisor with a negotiation-framed question, demonstrating
    the negotiation-suggestion part of the storyline without this feature
    having built any new negotiation logic itself.

### Mobile-specific notes

The same storyline (steps 4, 9-10, 12-13) works identically on mobile —
same backend, same endpoints, same screen names/behavior, ported
screen-for-screen in Prompts 11-12. The only material differences worth
calling out live: mobile's Schedule Viewing is a full screen
(`viewing/new.tsx`) rather than a modal, and the date/time pickers are
`Chip` rows instead of a calendar popover/grid — both cosmetic, not
behavioral. Partner-side steps (5-6, 11) are **web-only** — no partner
portal was built for mobile (not requested by any prompt in this series).
