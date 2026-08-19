# myMakan AI Negotiation & Offer Management — Implementation Tracking

Companion doc to `MYMAKAN_NEGOTIATION_PROMPTS.md`. Created by Prompt 1. Each
later prompt reads this doc first, fills in its section(s), and leaves
everything else untouched unless it discovers the existing content is wrong.

## Feature completed

**Backend complete as of Prompt 6 of 13 — the entire backend surface for
this feature is done.** Customer-side create/list/detail/counter-again/
accept/withdraw (Prompts 2-3), partner-side list/detail/counter/accept/
reject (Prompt 4), the deterministic negotiation-signal classifier + "Ask
myMakan" AI guidance + the deterministic "myMakan Summary" (Prompt 5), and
(Prompt 6): the "Draft Message" action grounded in an in-progress
negotiation's real numbers (reusing the existing
`POST /properties/{id}/ai-summary?variant=negotiation_message` endpoint, no
new AI route), the deterministic Agreement Summary embedded on
`GET /negotiations/{id}` once accepted, and notification copy polished to
match the brief's exact example strings.

**Web customer-side frontend complete as of Prompt 9 of 13** — Make an Offer
(Prompt 7), Negotiation Detail with timeline/counter/accept/withdraw/Ask
myMakan (Prompt 8), and My Negotiations + the Offer Agreed state + Agreement
Summary (Prompt 9). **Web partner portal complete as of Prompt 10** — Offers &
Negotiations inbox + detail with Accept/Counter/Reject/Message Customer.
**Mobile (Expo) complete as of Prompt 11** — the same customer-side surface
Prompts 7-9 built for web, ported to mobile using the same backend endpoints
(partner portal is web-only, per that prompt's explicit scope). **Polish pass
complete as of Prompt 12 (customer + partner UI now fully complete, web +
mobile)** — notification deep-links wired for real (a real bug fixed, see
below), the negotiation-strength signal badge now also on the base
`PropertyNegotiationOut`/`PartnerNegotiationOut` schemas so list/inbox cards
show it (not just detail screens), a small backend addition
(`to_negotiation_list_out()`/`to_partner_negotiation_list_out()`), and a
money-typography upgrade to the Make an Offer Review step on both web and
mobile.

**Prompt 13 (final validation/docs) — DONE, feature complete.** Full backend
suite clean (578 passed, 23 skipped, 0 failed — the 2 previously-known
pre-existing `test_outbox.py` failures are gone too, see "Tests" below), all
12 §25 validation rules re-verified with one genuine test-coverage gap found
and closed, §26 privacy sweep confirmed clean, `frontend/`'s `tsc --noEmit`
+ `vite build` and `mobile/`'s `tsc --noEmit` all clean, and every remaining
TODO section of this doc (this one included) filled in. **This is the end of
the 13-prompt AI Negotiation & Offer Management feature — nothing further is
planned.**

## Existing functionality reused

Two companion features this depends on were already fully built before this
prompt, and are reused rather than reimplemented:

1. **Negotiation math** — `app/services/negotiation_intelligence.py`'s
   `negotiation_insight(prop, price_intelligence) -> NegotiationInsight |
   None` already computes asking price / market midpoint / discussion range
   / a hedged approach sentence, already exposed via
   `GET /properties/{id}/intelligence`, and already rendered as
   `NegotiationInsightCard` on Property Detail (web + mobile) with a working
   "Draft message" flow via the `PROPERTY_NEGOTIATION_MESSAGE` AI prompt
   (`app/core/ai/prompts.py`, see
   `docs/implementation/mymakan-property-intelligence.md`'s "Backend —
   Prompt 9 addition" and web/mobile Prompt 9 sections).

   **Decision (do not re-litigate later): this feature never duplicates
   fair-range math.** `PropertyNegotiationDetailOut.negotiation_insight`
   (see "Models" below) is a read-only echo of the existing
   `NegotiationInsight` dataclass — a later prompt's negotiation detail
   endpoint calls `negotiation_insight()` directly (same price-intelligence
   plumbing `GET /properties/{id}/intelligence` already uses) and serializes
   the result onto the response. No new price/midpoint/range calculation is
   introduced anywhere in this feature. Same reasoning for AI drafting: a
   later prompt's "Draft counter-offer message" action is expected to reuse
   `PROPERTY_NEGOTIATION_MESSAGE` (possibly parameterized with the current
   offer amount), not a new prompt template — final call left to whichever
   prompt builds that endpoint, but the intent is explicit here.

2. **Viewings** — `PropertyViewing` (`app/models/property_viewing.py`) is
   fully built with a `"completed"` terminal status and `lead_id` linking.
   `PropertyNegotiation.viewing_id` (nullable, `SET NULL`) lets a later
   prompt link a negotiation back to the viewing that preceded it, but this
   is never required — a customer can open a negotiation without having
   scheduled a viewing first. No viewing logic is reimplemented here.

## Models

`backend/app/models/property_negotiation.py` — two tables, mirroring
`PropertyViewing`'s conventions (single flat row per negotiation, plain
string `status` column, explicit transitions dict, no DB enum types):

### `PropertyNegotiation` (table `property_negotiations`)

- Identity/relations: `id`, `property_id` (FK `properties.id`,
  `ondelete="CASCADE"`), `customer_user_id` (FK `users.id`,
  `ondelete="RESTRICT"`), `mediator_id` (FK `mediators.id`,
  `ondelete="SET NULL"`, nullable, copied from `Property.mediator_id` at
  creation time — same convention as `PropertyViewing.mediator_id`),
  `lead_id` (FK `leads.id`, `ondelete="SET NULL"`, nullable — see "Lead
  integration" below), `viewing_id` (FK `property_viewings.id`,
  `ondelete="SET NULL"`, nullable — see "Viewing integration" below).
- `transaction_type` — `String(20)`, copied from `Property.listing_type` at
  creation time and **never read live** via a relationship. This is
  deliberate: if a mediator later edits the listing's `listing_type` (e.g.
  converts a rent listing to sale), an already-open negotiation must keep
  referring to the transaction type it was actually opened under —
  otherwise its `current_offer_amount`/`original_listing_amount` would be
  interpreted against the wrong kind of price.
- `status` — plain `String(30)` column (mirrors `Property.status`'s and
  `PropertyViewing.status`'s un-enumed convention), default `"submitted"`.
  See "Status flow" below for the full value table.
- `current_offer_amount`, `original_listing_amount` — both `Numeric(12, 2)`.
  `original_listing_amount` is a snapshot of
  `Property.monthly_rent`/`sale_price` (whichever applies to
  `transaction_type`) taken at creation time, same "copy, don't read live"
  rationale as `transaction_type`.
- Timestamps: `created_at`, `updated_at` (auto), `accepted_at`,
  `rejected_at`, `closed_at` (all nullable).
- `cancellation_reason` (`String(255)`, nullable), `cancelled_by`
  (`String(20)`, nullable — `"customer"` | `"mediator"`, mirroring
  `PropertyViewing.cancelled_by`'s convention). **Added in Prompt 3** — these
  two columns were missed in Prompt 1's original field list; a follow-up
  migration (`c2d3e4f5a6b7`, chained onto Prompt 1's `05cf5fee7bd3`) adds
  them. `withdraw_negotiation()` sets both; `cancelled_by` exists now for
  symmetry with the mediator-side reject transition Prompt 4 will add. No
  dedicated `withdrawn_at`/`cancelled_at` timestamp column was added —
  `updated_at`'s auto-onupdate is treated as sufficient for this
  feature-first build, matching every other plain status flip in this
  service.

Indexes: `(customer_user_id, status)`, `(mediator_id, status)` (mirroring
`PropertyViewing`'s index convention), plus `(property_id,
customer_user_id)` — what a later prompt's duplicate-active-negotiation
check will query (same shape as `PropertyViewing`'s equivalent index / the
§18 duplicate-active-viewing check).

`PROPERTY_NEGOTIATION_STATUSES = ("submitted", "countered", "accepted",
"rejected", "withdrawn", "closed")`. No separate `draft` status is
persisted — see "Status flow" below. No `expired` status either: skipped
entirely per the prompt's instruction not to build an expiry cron for a
feature-first demo unless a concrete need shows up in a later prompt.
`closed` exists specifically to cover any terminal wrap-up state a later
prompt might need on top of an already-`accepted` negotiation (e.g. once a
deal is fully finalized outside this app's own payment/contract scope,
which is explicitly out of scope for the whole feature).

`PROPERTY_NEGOTIATION_TRANSITIONS` — plain `{current_status:
{allowed_next_statuses}}` dict (mirrors `PROPERTY_VIEWING_TRANSITIONS`'s
shape exactly, not a state-machine library):

| From | Allowed next |
|---|---|
| `submitted` | `countered`, `accepted`, `rejected`, `withdrawn` |
| `countered` | `countered` (re-counter, either side), `accepted`, `rejected`, `withdrawn` |
| `accepted` | `closed` |
| *(terminal: `rejected`, `withdrawn`, `closed`)* | *(none)* |

Note: `countered` is a single negotiation-level status covering **both** a
mediator counter and a customer counter-offer — which side acted last is
read off the latest `NegotiationOffer.offer_type`, not encoded as a separate
negotiation-level status (kept deliberately minimal, per the brief's "avoid
complex state machines").

### `NegotiationOffer` (table `negotiation_offers`)

One row per individual offer/counter placed on a negotiation — this table
**is** the offer history / timeline (see "no separate timeline schema"
below).

- `id`, `negotiation_id` (FK `property_negotiations.id`,
  `ondelete="CASCADE"`), `offered_by_user_id` (FK `users.id`,
  `ondelete="SET NULL"`, nullable — the acting user, customer or the
  mediator's own user account, whichever placed this specific row).
- `amount` — `Numeric(12, 2)`. `message` — `Text`, nullable (free-form note
  attached to this specific offer).
- `offer_type` — `String(30)`, one of `NEGOTIATION_OFFER_TYPES =
  ("customer_offer", "mediator_counter", "customer_counter")`.
- `status` — `String(20)`, default `"pending"`, one of
  `NEGOTIATION_OFFER_STATUSES = ("pending", "accepted", "rejected",
  "superseded")`. `superseded` is set when a newer offer/counter is placed
  on the same negotiation — this is what backs "only the latest active
  offer can be accepted" (a later prompt's service layer is responsible for
  actually flipping older `pending` rows to `superseded` when a new one
  lands; this prompt only models the column).
- `expires_at` — `DateTime`, nullable. Present per the brief's "if used" but
  **not enforced by any background job** in this feature-first build — see
  "Known limitations".
- `created_at`.

Index: `(negotiation_id, created_at)` — the ordering a later prompt's offer
history / timeline query will use.

**Bug fixed in Prompt 3:** `PropertyNegotiation.offers`'s relationship
`order_by` was `"NegotiationOffer.created_at"` alone, with no tiebreaker.
Under this test suite's savepoint-based isolation (`tests/conftest.py`),
every row committed within one test shares the same real outer Postgres
transaction, and `created_at`'s `func.now()` server_default resolves to
that transaction's start time for ALL of them — so multiple offers placed
within a single test (e.g. a multi-round counter exchange) can tie on
`created_at`, making the offer-history order non-deterministic (surfaced as
an intermittent failure in the new "offer history intact after multiple
rounds" test). Fixed by adding `NegotiationOffer.id` as a secondary sort
key (`order_by="NegotiationOffer.created_at, NegotiationOffer.id"`) — `id`
is monotonic and always breaks the tie in insertion order. `_latest_offer()`
(new in this prompt, in `property_negotiation.py`) already queried with
this same `created_at desc, id desc` tiebreaker from the start.

Migration:
`backend/alembic/versions/05cf5fee7bd3_add_property_negotiations.py`,
chained onto `b1c2d3e4f5a6` (the head at Prompt 1 research time — the
`property_viewings` migration). Verified `alembic upgrade head` /
`downgrade -1` / `upgrade head` all apply cleanly.

**Prompt 3 follow-up migration:**
`backend/alembic/versions/c2d3e4f5a6b7_add_negotiation_cancellation_fields.py`,
chained onto `05cf5fee7bd3`, adds `cancellation_reason`/`cancelled_by` (see
above). Verified `alembic upgrade head` / `downgrade -1` / `upgrade head`
all apply cleanly against the local Postgres dev DB.

Schemas: `backend/app/schemas/property_negotiation.py` —
`NegotiationOfferCreate` (amount, message), `NegotiationOfferOut` (all
`NegotiationOffer` columns), `PropertyNegotiationOut` (all
`PropertyNegotiation` columns plus denormalized
`property_title`/`property_image_url`/`property_area`/`property_district`/
`property_listing_amount`/`mediator_agent_name`, mirroring how
`PropertyViewingOut`/`PropertyViewingDetailOut` denormalize — populated by
the service/route layer from loaded relationships, not by pydantic alone,
same as the viewings feature), `PropertyNegotiationDetailOut` (extends
`PropertyNegotiationOut`, adds the full ordered `offers: list[
NegotiationOfferOut]` — the timeline itself — plus a read-only
`negotiation_insight: NegotiationInsightOut | None` echoing the reused
`NegotiationInsight` dataclass). **No separate timeline-shape schema** — a
later prompt's UI computes any display timeline client-side from the
`offers` list + the status timestamps on `PropertyNegotiationOut`, the same
decision the viewings feature made for its own timeline (derived from
`created_at`/`confirmed_at`/`cancelled_at`/`completed_at`).

## APIs

**Complete backend transition surface — Prompt 2 added customer-side
create/list/detail; Prompt 3 added the customer-side counter-again/accept/
withdraw actions; Prompt 4 (this prompt) adds the partner-side list/detail/
counter/accept/reject actions.** No AI guidance yet (later prompt). Customer
routes live in `backend/app/api/routes/negotiations.py`,
gated per-request behind `FEATURE_NEGOTIATIONS` via a `_require_enabled`
dependency (mirrors `viewings.py`'s pattern — main.py's registration-time
gate only takes effect on process restart, so this is what lets the flag be
toggled/tested at runtime too).

**Mounting quirk (deliberate):** unlike every other router in `main.py`'s
`_ROUTERS` list, `negotiations.router` is mounted with an **empty** path
segment (`("", ["negotiations"])`) rather than a fixed prefix — because this
router's endpoints deliberately span two different URL roots
(`/properties/{property_id}/negotiations...` and `/negotiations...`), each
route spells out its own full path and the router only needs the bare
`/api`/`/api/v1` prefix `main.py` already applies to every entry.

- `POST /api/v1/properties/{property_id}/negotiations` — creates a
  negotiation via `property_negotiation.create_negotiation()`. Accepts an
  `Idempotency-Key` header exactly like `POST /leads/`/`POST /viewings` do
  (same `IdempotencyStore` mechanism, scope `"negotiation-create"`). Domain
  errors (`NegotiationDomainError`) map to 404 (property not found/not
  Published), 422 (amount ≤ 0, no listing price to negotiate against, or an
  invalid/untrusted `viewing_id`), 409 (duplicate active negotiation for
  this customer+property).
- `GET /api/v1/negotiations` — the caller's own negotiations, optional
  `?status=` filter, ordered by `updated_at` desc.
- `GET /api/v1/negotiations/{id}` — 404 if not found, 403 if
  `negotiation.customer_user_id != current_user.id`. Returns
  `PropertyNegotiationDetailOut`: full offer history (`offers`) plus a
  `negotiation_insight` computed **fresh** on every call (see "Property
  Intelligence integration" below) — never a stored/stale copy.
- `GET /api/v1/properties/{property_id}/negotiations/active` — the caller's
  active negotiation for this property (status not in `{accepted, rejected,
  withdrawn, closed}`) if one exists, else 404. This is what a later
  frontend prompt's "Make an Offer" vs "View Negotiation" entry-point
  decision (brief §3) is expected to call before deciding which CTA to
  show. **Decision (route-count-creep call, made in this prompt):**
  implemented as its own dedicated route rather than folding into an
  `?active=true` query param on `GET /negotiations` — the caller here only
  ever has a `property_id` in hand (rendered from Property Detail, before
  any negotiation necessarily exists), and a plain 404 reads more naturally
  for a direct single-resource lookup than it would as a filtered-list
  response shape.

**Added in Prompt 3** (customer-side action routes, all in
`negotiations.py`, all gated behind the same `_require_enabled` +
ownership-check pattern via a shared `_get_own_negotiation()` helper — 404
if the negotiation doesn't exist, 403 if it isn't the caller's):

- `POST /api/v1/negotiations/{id}/offer` — customer's "Counter Again"
  action. Calls `property_negotiation.submit_counter(..., offer_type=
  "customer_counter")`. 409 if the negotiation isn't currently
  `submitted`/`countered` (e.g. already `accepted`/`withdrawn`), 422 for a
  non-positive amount.
- `POST /api/v1/negotiations/{id}/accept` — customer accepting the
  mediator's latest counter. Calls `property_negotiation.accept_offer(...,
  actor_role="customer")`. 409 if there's no pending offer to accept, OR if
  the latest pending offer was placed by this same customer (self-accept
  blocked — see "Status flow" below).
- `POST /api/v1/negotiations/{id}/withdraw` — body `{"reason": str}`. Calls
  `property_negotiation.withdraw_negotiation(...)`. 409 if the negotiation
  isn't currently `submitted`/`countered`.

`submit_counter()` and `accept_offer()` are both written to back **both**
sides of the exchange (`offer_type`/`actor_role` parameters) even though
Prompt 3 only wired the customer-facing routes above — Prompt 4's
mediator-side "Counter Offer"/"Accept Offer" actions (below) call the exact
same service functions with the mediator's actor/offer_type instead of
adding parallel functions.

**Added in Prompt 4** (partner-side routes, new file
`backend/app/api/routes/partner_negotiations.py`, prefix
`/partner/negotiations`, mounted in `main.py` right after
`partner_viewings.router`, gated behind `FEATURE_NEGOTIATIONS` via the same
`_require_enabled` pattern as `negotiations.py`, every endpoint using
`Depends(get_mediator_user)` + a `_load_owned_negotiation()` helper mirroring
`partner_viewings.py`'s `_load_owned_viewing()` exactly — 404 if not found,
403 "Not your listing" if `negotiation.mediator_id != mediator.id`):

- `GET /api/v1/partner/negotiations` — the mediator's own negotiations across
  all their properties, optional `status_filter` query param, ordered by
  `updated_at` desc. Returns `PartnerNegotiationOut` (list items — no offer
  history).
- `GET /api/v1/partner/negotiations/{id}` — returns
  `PartnerNegotiationDetailOut` (full offer history + fresh
  `negotiation_insight`, same shape the customer's `GET /negotiations/{id}`
  returns). See "Partner privacy bar" below for why this doesn't leak more
  customer PII than the existing partner lead detail view.
- `POST /api/v1/partner/negotiations/{id}/counter` — mediator's "Counter
  Offer" action. Calls `submit_counter(..., offer_type="mediator_counter")`
  (same Prompt 3 function the customer's "Counter Again" route calls). 409 if
  the negotiation isn't currently `submitted`/`countered`, 422 for a
  non-positive amount.
- `POST /api/v1/partner/negotiations/{id}/accept` — mediator accepting the
  customer's latest offer/counter. Calls `accept_offer(...,
  actor_role="mediator")`. 409 if there's no pending offer to accept, OR if
  the latest pending offer was placed by this same mediator's user account
  (self-accept blocked, mirrors the customer-side rule).
- `POST /api/v1/partner/negotiations/{id}/reject` — new
  `reject_negotiation(db, mediator_user, negotiation, reason) ->
  PropertyNegotiation` (in `property_negotiation.py`, new in this prompt, no
  customer-side equivalent). Valid from `submitted`/`countered`, sets
  `status = "rejected"`, `rejected_at`, `cancellation_reason`,
  `cancelled_by = "mediator"`. Emits `NEGOTIATION_REJECTED`. Reason is free
  text (`NegotiationRejectRequest.reason: str`, no backend enum validation —
  same "backend accepts any string" decision `NegotiationWithdrawRequest`
  already made, see "Status flow" below); the frontend is expected to offer
  the closed list from brief §11: `"Offer too low"` / `"Property no longer
  available"` / `"Owner declined"` / `"Other"`.

**Added in Prompt 5** (`backend/app/api/routes/negotiations.py`):

- `POST /api/v1/negotiations/{id}/ai-guidance` — "Ask myMakan". Body
  `{question?: str, language: "en"|"ar"}` (validated against `("en", "ar")`,
  422 on anything else). Gated behind `FEATURE_NEGOTIATIONS` (same
  `_require_enabled` dependency) AND rate-limited via
  `rate_limit_dependency("negotiation_ai_guidance", limit=20,
  window_seconds=600, by_user=True)` — the same `rate_limit_dependency`
  every other on-request AI endpoint in `app/api/routes/ai.py` uses, not a
  new mechanism. 403 if the negotiation isn't the caller's (via
  `_get_own_negotiation`). Calls `negotiation_service.
  price_intelligence_and_insight()` (new shared helper, see "AI behavior"
  below) then `negotiation_ai.generate_guidance()`. Response:
  `{guidance: str, generated_by: "ai"|"fallback"}`.
- `GET /api/v1/negotiations/{id}` gained an optional `?language=` query
  param (default `"en"`) — it only affects the new `summary_text` field on
  `PropertyNegotiationDetailOut` (see "AI behavior" below), which is
  deterministic (no AI call), so accepting it costs nothing extra and needs
  no rate limiting, unlike the AI-guidance action above.

**Added in Prompt 12** (list-endpoint badge parity): `NegotiationSignalOut`
was previously declared only on `PropertyNegotiationDetailOut`/
`PartnerNegotiationDetailOut`, so `GET /negotiations`/`GET
/partner/negotiations` (the LIST endpoints backing the My Negotiations /
partner inbox cards) never carried a `negotiation_signal` — those UIs could
only show plain numbers, not the same strength badge the detail screens
render. Fixed by moving `negotiation_signal: NegotiationSignalOut | None`
onto the base `PropertyNegotiationOut` (inherited by `PartnerNegotiationOut`
and both Detail variants — the duplicate re-declarations on the Detail
schemas were removed as now-redundant) and adding two small service
functions, `property_negotiation.to_negotiation_list_out(db, negotiation)` /
`to_partner_negotiation_list_out(db, negotiation)`, that wrap the existing
`to_negotiation_out()`/`to_partner_negotiation_out()` and additionally
compute the signal via the same `price_intelligence_and_insight()` +
`compute_negotiation_signal()` pair `to_negotiation_detail_out()` already
uses. `list_my_negotiations`/`list_partner_negotiations`
(`negotiations.py`/`partner_negotiations.py`) now call the `_list_out()`
variant; every other call site (`create_negotiation`, the counter/accept/
withdraw/reject action routes, `GET .../negotiations/active`) still calls the
plain `to_negotiation_out()`/`to_partner_negotiation_out()` — those responses
never render a badge (their callers always re-fetch the detail endpoint
afterward, see "Screens changed" — Prompt 8's note on this), so they don't
pay for an extra price-intelligence computation they don't use. Verified via
`pytest backend/tests/test_negotiations.py
backend/tests/test_partner_negotiations.py
backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py
-q`: 85 passed, no regression (the field addition is purely additive/
nullable).

**Partner privacy bar (brief §8/§26):** `PartnerNegotiationOut` (extends
`PropertyNegotiationOut`) and `PartnerNegotiationDetailOut` (extends
`PartnerNegotiationOut`, adds `offers`/`negotiation_insight`) both add
denormalized `customer_name`/`customer_phone`/`customer_email` fields —
this matches, but deliberately does not exceed, the existing privacy bar an
assigned mediator already gets for their own lead via
`LeadSummaryOut`/`LeadDetailOut` (`backend/app/schemas/lead.py`), which
expose the customer's full name/phone/email directly once a lead is
assigned. Ownership (`negotiation.mediator_id == the requesting mediator's
own id`, enforced by `_load_owned_negotiation()`) is the gate here, same as
lead assignment gates lead visibility there. This exactly mirrors
`partner_viewings.py`'s `PartnerPropertyViewingOut`/`to_partner_viewing_out()`
precedent (`backend/app/schemas/property_viewing.py`,
`backend/app/services/property_viewing.py`). Populated by two new
service-layer functions in `property_negotiation.py` —
`to_partner_negotiation_out()` (wraps `to_negotiation_out()`) and
`to_partner_negotiation_detail_out()` (wraps `to_negotiation_detail_out()`)
— via a shared `_with_customer_contact()` helper. Neither the offer history
nor `negotiation_insight` carries any customer contact info, so the detail
variant stays within the same bar as the summary variant. Verified by
`test_partner_negotiations.py`'s
`test_partner_negotiation_exposes_customer_contact_matching_lead_privacy_bar`
(asserts the customer-facing `PropertyNegotiationOut`/
`PropertyNegotiationDetailOut` schemas declare no customer contact fields at
all) and `test_partner_negotiation_list_does_not_leak_other_customers`.

Response denormalization (`property_negotiation.to_negotiation_out()`,
mirrors `property_viewing.py`'s `to_viewing_out()`) populates
`property_title`/`property_image_url`/`property_area`/`property_district`/
`property_listing_amount`/`mediator_agent_name` from the loaded
`Property`/`Mediator` relationships. **Note on `property_area` vs
`property_district`:** `Property` has no separate `district` column — this
codebase already treats "district" as a synonym for `Property.area`
elsewhere (e.g. `HomeFinderCriteria.districts` is matched against
`prop.area` in `app/services/home_finder_scoring.py`), so both denormalized
fields on `PropertyNegotiationOut` echo the same `prop.area` value rather
than fabricating a second, more granular field that doesn't exist yet.

Service layer: `backend/app/services/property_negotiation.py`.
`create_negotiation()` mirrors `leads.py`'s `create_lead()` /
`property_viewing.py`'s `create_viewing()` transaction shape exactly: build
the `PropertyNegotiation` row, `db.flush()` (assigns its id without
committing), build the first `NegotiationOffer` row
(`offer_type="customer_offer"`, `status="pending"`, `offered_by_user_id` =
the customer), `record_event(..., EventType.NEGOTIATION_SUBMITTED, ...)` in
the SAME transaction, then `db.commit()` + `db.refresh()`.
`NegotiationDomainError(status_code, detail)` is the route-layer-translated
exception class (same shape as `ViewingDomainError`).

## Status flow

**No dedicated `draft` status is ever persisted.** A `PropertyNegotiation`
row is only created once the customer actually submits their first offer —
`status` starts at `submitted` and the first `NegotiationOffer` row
(`offer_type="customer_offer"`) is created in the same transaction. The
"Enter Amount -> Review" steps a customer walks through *before* that
submission are frontend-only state (component state / a local wizard step,
never written to the database) — per the brief's "do not create unnecessary
complexity" instruction. This mirrors how `PropertyViewing` never persists
an in-progress "scheduling" state either.

See the `PROPERTY_NEGOTIATION_TRANSITIONS` table in "Models" above for the
full transition lookup. The transition-enforcing service functions mirror
`app/services/property_viewing.py`'s `cancel_viewing`/`propose_new_time`/
`accept_reschedule` pattern — a shared `_transition(negotiation,
new_status)` helper in `property_negotiation.py` looks the move up in
`PROPERTY_NEGOTIATION_TRANSITIONS` and raises `NegotiationDomainError(409,
...)` on an unlisted move.

**Implemented in Prompt 3** — three functions in
`backend/app/services/property_negotiation.py`, all in
`backend/app/api/routes/negotiations.py` behind the customer-facing routes
listed in "APIs" above:

| Action | Function | From | To | Notes |
|---|---|---|---|---|
| Customer "Counter Again" | `submit_counter(..., offer_type="customer_counter")` | `submitted`, `countered` | `countered` | Supersedes the prior `pending` offer, inserts a new `pending` row, updates `current_offer_amount`. |
| Mediator "Counter Offer" *(Prompt 4, done)* | `submit_counter(..., offer_type="mediator_counter")` | `submitted`, `countered` | `countered` | Same function, mediator actor/offer_type, wired via `POST /partner/negotiations/{id}/counter`. |
| Customer accepts mediator's counter | `accept_offer(..., actor_role="customer")` | `submitted`, `countered` | `accepted` | Only when the latest `NegotiationOffer` is `pending` AND was placed by someone other than the accepting user. |
| Mediator accepts customer's counter *(Prompt 4, done)* | `accept_offer(..., actor_role="mediator")` | `submitted`, `countered` | `accepted` | Same function/rule, mediator actor, wired via `POST /partner/negotiations/{id}/accept`. |
| Customer withdraws | `withdraw_negotiation(...)` | `submitted`, `countered` | `withdrawn` | Customer-only; persists `cancellation_reason` + `cancelled_by="customer"`. |
| Mediator rejects *(Prompt 4, done)* | `reject_negotiation(...)` | `submitted`, `countered` | `rejected` | Mediator-only, no customer-side equivalent; sets `rejected_at` + `cancellation_reason`/`cancelled_by="mediator"`, emits `NEGOTIATION_REJECTED`, wired via `POST /partner/negotiations/{id}/reject`. |

**Self-accept-blocked rule (brief §11's "only the latest valid counter, by
the OTHER party"):** `accept_offer()` looks up the negotiation's single
most-recently-created `NegotiationOffer` row (regardless of who placed it)
and rejects with 409 unless BOTH: (a) that row's `status == "pending"`, and
(b) `offered_by_user_id != accepting actor's user id`. This is checked
against the actual acting user, not `offer_type` — a customer can never
accept their own `customer_offer`/`customer_counter` row, and (once Prompt 4
wires the mediator route) a mediator can never accept their own
`mediator_counter` row. Both `submit_counter()` and `accept_offer()` are
written generically (an `offer_type`/`actor_role` parameter) so the exact
same functions back both the customer-side routes built in this prompt and
the mediator-side routes Prompt 4 adds — no parallel implementation.

**Withdrawal/rejection reason values (brief §11):** stored as free text on
`cancellation_reason` — no enum column on the backend (over-engineering
avoided per the brief). The frontend is expected to offer a closed list:
customer withdrawal — `"Changed mind"` / `"Found another property"` /
`"Budget changed"` / `"Other"`; mediator rejection (Prompt 4) — `"Offer too
low"` / `"Property no longer available"` / `"Owner declined"` / `"Other"`.
The backend accepts any string.

## Property Intelligence integration

**Decision (made in Prompt 1, do not re-litigate later):** this feature
reuses `negotiation_insight()` and `PROPERTY_NEGOTIATION_MESSAGE` rather
than duplicating fair-range math or AI drafting. See "Existing functionality
reused" above for the full rationale.

**Implemented in this prompt:** `GET /negotiations/{id}`
(`property_negotiation.to_negotiation_detail_out()`) computes the
`negotiation_insight` field **fresh on every call** — it calls
`price_intelligence.buy_price_intelligence()`/`rent_price_intelligence()`
(picked by `prop.listing_type`, same branch `GET
/properties/{id}/intelligence` uses) and then
`negotiation_intelligence.negotiation_insight(prop, price_intel)`, mapping
the resulting dataclass (or `None`, when the underlying Price Intelligence
doesn't have `sufficient_data`) onto the response. Nothing about this is
persisted on the `PropertyNegotiation` row. **Resolved in Prompt 6:** the
"Draft counter-offer message" action reuses `PROPERTY_NEGOTIATION_MESSAGE`
via the existing `POST /properties/{id}/ai-summary?variant=
negotiation_message` route, now optionally grounded in a real negotiation —
see "AI behavior — Draft Message" above.

## Viewing integration

`PropertyNegotiation.viewing_id` (FK `property_viewings.id`, `ondelete="SET
NULL"`, nullable) lets a negotiation reference the `PropertyViewing` it grew
out of — e.g. a customer who viewed a property and then wants to negotiate.
**Never required**: a customer can open a negotiation on a property they
never scheduled a viewing for.

**Decision (made in this prompt):** linking is **explicit, client-supplied,
server-verified** — `PropertyNegotiationCreate.viewing_id` is an optional
field on `POST /properties/{property_id}/negotiations`'s request body (e.g.
sent when the customer starts a negotiation from a completed viewing's
detail screen), never inferred automatically the way lead-linking is (see
"Lead integration" below). The client-supplied id is **never trusted at
face value** — `create_negotiation()` loads the `PropertyViewing` row and
rejects (`NegotiationDomainError`, 422) unless ALL of: it exists, its
`customer_user_id` matches the calling customer, its `property_id` matches
the path's `property_id`, and its `status == "completed"`. Any mismatch
(wrong owner, wrong property, wrong status) is rejected outright rather than
silently falling back to `viewing_id = None` — an id a client supplied on
purpose that fails validation is more likely a bug worth surfacing than a
case to paper over.

## Lead integration

**Decision (made in this prompt, mirrors the viewings feature exactly, do
not re-litigate later):** attach `PropertyNegotiation.lead_id` only via an
existing `LeadSuggestion(lead_id, property_id)` match — i.e. only when a
`LeadSuggestion` row already links this customer's `Lead` to this exact
property (join `LeadSuggestion` -> `Lead` on `Lead.customer_user_id ==
customer.id`). **Never auto-create a `Lead` from a negotiation.** A `Lead`
(`backend/app/models/lead.py`) represents an area-wide search — it has no
`property_id` column, only `area_name`/`city` — synthesizing one from a
single-property negotiation would misrepresent its scope and pollute
mediator lead-matching, exactly the same reasoning
`docs/implementation/mymakan-viewings.md`'s "Lead integration" section gives
for `PropertyViewing.lead_id`.

**Implemented in this prompt:** `create_negotiation()` calls
`property_viewing._find_linked_lead_id(db, customer_user, property_id)`
directly — the identical helper `create_viewing()` already uses, imported
and reused rather than reimplemented (same query, same "existing
`LeadSuggestion` match only, never auto-create" behavior).

## AI behavior (guidance + draft message)

**Implemented in Prompt 5.** Two new services (`backend/app/services/
negotiation_signals.py`, `backend/app/services/negotiation_ai.py`) plus a
new prompt (`NEGOTIATION_GUIDANCE`, `backend/app/core/ai/prompts.py`). Same
reuse discipline as "Property Intelligence integration" above: no second
copy of the fair-range math, no second copy of the price-fairness deviation
thresholds — both are imported from the existing modules.

### Negotiation Signals (`negotiation_signals.py`) — deterministic, no LLM

`compute_negotiation_signal(offer_amount, price_intelligence) ->
NegotiationSignal` (`NegotiationSignal(signal: str, label: str)`) classifies
one offer amount into exactly one of six values (brief §14's exact names —
`NEGOTIATION_SIGNALS` tuple): `within_market_range`, `below_market_range`,
`above_market_range`, `close_to_asking_price`, `significant_discount_
requested`, `limited_comparable_data`. `label` is a one-line deterministic
string that already includes the numeric basis, e.g. "SAR 9,350 is within
the estimated SAR 9,300-9,400 market range."

**Never fabricates a signal from insufficient data:** returns
`limited_comparable_data` whenever `price_intelligence` is `None`,
`price_intelligence.sufficient_data` is `False`, or (defensively) any field
a market-relative signal needs (asking price, fair-range low/high) is
missing even though `sufficient_data` claims `True`.

**Reuses `price_intelligence.py`'s own fractional deviation thresholds
directly via import** (`_EXCELLENT_VALUE_MAX = -0.15`, `_GOOD_VALUE_MAX =
-0.05` — the same constants `_classify()` uses for the "Excellent Value" /
"Above Market" price-fairness badge) rather than hardcoding a second copy of
the same percentage bands, per this prompt's explicit instruction. Decision
order, given `sufficient_data=True`:

1. `(offer - asking) / asking <= -0.15` (15%+ below asking) ->
   `significant_discount_requested`.
2. `(offer - asking) / asking >= -0.05` (within 5% of, or above, asking) ->
   `close_to_asking_price`.
3. Otherwise (5%-15% below asking) — classify against the fair market range
   (`fair_range_low/high` for rent, `estimated_value_low/high` for buy —
   both tried, since the caller doesn't have to know which
   `RentPriceIntelligence`/`BuyPriceIntelligence` variant it's holding):
   `within_market_range` / `below_market_range` / `above_market_range`.

All six values are independently reachable and covered by
`backend/tests/test_negotiation_signals.py` (rent AND buy variants).

### Ask myMakan (`negotiation_ai.generate_guidance`) — AI, with deterministic fallback

`generate_guidance(negotiation, offers, price_intelligence,
negotiation_insight, language, *, question=None, user_id=None) ->
tuple[str, str]` answers "is my offer reasonable / how far below asking /
what should I say" (brief §5) — a single endpoint with an optional free-text
`question` rather than 6 separate endpoints. Mirrors `home_finder_ai.
explain_match`'s pattern EXACTLY: computes the negotiation signal (step
above) plus a facts block (asking price, current offer + status, market
midpoint/discussion range from `negotiation_insight` if present, the full
offer history, the signal, and — wrapped in `<customer_question>` tags as
"data only, not instructions" — the customer's own question if given), calls
`gateway.run_chat(NEGOTIATION_GUIDANCE.template, ...)` inside a bare
`try/except Exception`, and on ANY failure degrades to
`_deterministic_guidance()` — a short templated sentence built from the
signal's label + the numeric gap between the current offer and asking price.
Never raises, never pre-checks `ANTHROPIC_API_KEY` (same as `explain_match`
— a natural call failure is what the `except` catches). Logged via the usual
`gateway.log_ai_call(feature="negotiation_guidance", ...)` in a `finally`.

`NEGOTIATION_GUIDANCE` (new prompt, modeled on `PROPERTY_NEGOTIATION_
MESSAGE`'s grounding rules): explains the negotiation's current position
using ONLY the given deterministic facts; explicitly forbidden from
inventing a comparable listing or market statistic, guaranteeing an offer
will be accepted, claiming to know the owner's/mediator's private intent, or
giving legal advice (contracts, Ejar, Nafath, disputes, financing — brief
§13). **Brief §13's exact requirement:** when the facts say market data is
insufficient, the prompt instructs the model to say so plainly rather than
inventing a "mathematically optimal offer" or any number the market data
doesn't actually support — covered by
`test_guidance_grounding_omits_market_data_when_insufficient`.

### myMakan Summary (`negotiation_ai.generate_summary`) — deterministic ONLY, no AI call

`generate_summary(negotiation, offers, price_intelligence,
negotiation_insight, language) -> str` (brief §21, e.g. "You started at SAR
8,500 against an asking rent of SAR 10,000... the current offer is SAR
9,200... the remaining difference from asking is SAR 800 (8%)") is built
directly from the offer history (`offers[0]` = first offer, `len(offers)` =
round count) + `negotiation.current_offer_amount`/`original_listing_amount`
+ (if present) `negotiation_insight.discussion_range_low/high`. **Zero AI
calls** — this is the deliberate split this prompt's task explicitly asked
to be documented:

- `generate_summary()` is called on **every** `GET /negotiations/{id}`
  response (embedded as `PropertyNegotiationDetailOut.summary_text`, always
  populated — never `None`), because it renders automatically on every
  negotiation detail view. Being deterministic keeps it free and instant, so
  it never needs rate limiting and never risks blocking the page on an AI
  round trip.
- `generate_guidance()` is an AI call, only made on request (`POST
  /negotiations/{id}/ai-guidance`), and IS rate-limited
  (`rate_limit_dependency`, same as every other on-request AI endpoint) —
  exactly because it costs a real model call, unlike the summary.

`property_negotiation.py` gained a small shared helper,
`price_intelligence_and_insight(db, prop) -> (price_intelligence |
None, NegotiationInsight | None)`, factored out of
`to_negotiation_detail_out()` so both that function and the new
`POST .../ai-guidance` route compute the same pair the same way (one
`buy_price_intelligence()`/`rent_price_intelligence()` call plus
`negotiation_intelligence.negotiation_insight()`, fresh every time — same
"never persist/read a stale copy" rule as before) without duplicating the
branch-on-`listing_type` logic.

### Language

Both `generate_guidance()` and `generate_summary()` take a plain `language:
str` ("en" | "ar") — `NegotiationAIGuidanceRequest.language` is validated
against exactly those two values (422 otherwise) on the AI-guidance route;
`GET /negotiations/{id}`'s optional `?language=` query param (defaulting
"en") is NOT validated the same way since it only ever selects between two
internally-written deterministic template branches, not a value fed to an
AI call.

Tests: `backend/tests/test_negotiation_signals.py` (all 6 signal values
reachable, rent + buy variants, threshold-boundary cases, `sufficient_
data=False` and missing-fields cases both degrade to `limited_comparable_
data`, and an explicit check that the module imports — not
redefines — `price_intelligence.py`'s threshold constants) and
`backend/tests/test_negotiation_ai.py` (AI grounding — mocked `run_chat`,
asserts only real facts reach the prompt and the customer's question is
wrapped as data-not-instructions; AI failure degrades to deterministic
guidance without raising; Arabic requested and returned for both the AI path
and the deterministic fallback; summary is deterministic, stable across
repeated calls with identical inputs, and asserted to NEVER call `run_chat`
at all; plus a small HTTP-level section covering the new route's 200/403/422
paths and the embedded `summary_text` field on `GET /negotiations/{id}`).

### Draft Message (`property_intelligence_ai.summarize_property_intelligence`) — negotiation-grounded (Prompt 6)

**Decision (do not re-litigate later): still no second AI endpoint.**
`POST /properties/{property_id}/ai-summary?variant=negotiation_message`
(`backend/app/api/routes/properties.py`, unchanged route path/method) gained
an optional `negotiation_id: int | None` body field
(`PropertyAiSummaryRequest`). The underlying
`property_intelligence_ai.summarize_property_intelligence()` (see that
module's docstring for the full split) gained two additional OPTIONAL
keyword-only arguments, `negotiation: PropertyNegotiation | None` and
`offer_history: list[NegotiationOffer] | None`, used only when
`variant="negotiation_message"`:

- **When `negotiation_id` is omitted** (the pre-existing call path, used
  directly from Property Detail before any negotiation exists): completely
  unchanged behavior — drafts a generic first-contact message grounded in
  `negotiation_intelligence`'s discussion range (Prompt 9 of the Property
  Intelligence feature; see that feature's tracking doc).
- **When `negotiation_id` is supplied:** the route loads the
  `PropertyNegotiation` row and 404s unless it both belongs to the
  requesting (authenticated — 401 if unauthenticated) customer AND
  references this same `property_id` — an id supplied on purpose that fails
  validation is surfaced, never silently ignored, same posture
  `create_negotiation()`'s `viewing_id` check already takes. On success, the
  loaded negotiation + its full `offers` history are passed through, and the
  draft is grounded in THAT negotiation's actual numbers instead of the
  generic discussion range — e.g. "I'd like to offer SAR 68,500" for a fresh
  negotiation (only the customer's own initial offer on record) vs.
  "Following your counter of SAR 70,000, I'd like to propose SAR 69,500"
  once the mediator has countered (the facts block explicitly marks the
  latest offer as "a REPLY to that counter, not a first-contact message"
  when it's a `mediator_counter` row). The pre-negotiation 422 guard ("No
  negotiation insight available for this listing") is skipped in this case
  — a real negotiation's own snapshot amounts are enough to ground a draft
  even when Property Intelligence itself lacks sufficient comparable data
  for that property.
- **Deterministic fallback** (AI unavailable/fails), when negotiation-
  grounded: replying to a mediator counter proposes the midpoint between the
  customer's own last real offer and the mediator's real counter — a
  transparent average of two numbers already in the offer history, never an
  invented one; otherwise it references the customer's own actual current
  offer amount. Never a generic "would you consider X-Y" sentence once a
  negotiation is in play.

**Hard requirement for Prompts 7-9 (written down here so the frontend work
doesn't skip it):** the drafted message — from EITHER call path — must
always be returned into an EDITABLE text field the customer reviews and can
change before sending. It is NEVER auto-sent on the customer's behalf. This
backend has no notion of "sending" a message at all; the requirement is
enforced entirely at the frontend layer.

Tests: `backend/tests/test_negotiation_ai.py`'s "Message drafting" section —
a fresh negotiation (only the initial offer) references the real submitted
amount and does not fabricate a mediator counter that doesn't exist yet; a
mid-negotiation draft (mediator has countered) is grounded in the actual
counter amount + the customer's own earlier real offer, with the facts
block explicitly marked as a reply; the deterministic grounded fallback
proposes the transparent midpoint of two real offer-history amounts only;
and an explicit check that omitting `negotiation`/`offer_history` leaves the
pre-existing no-negotiation call path's behavior unchanged (still grounds
only in `negotiation_intelligence`, no negotiation-specific facts leak in).

## Agreement Summary (Prompt 6, brief §22)

**Decision (this prompt):** a small deterministic helper,
`build_agreement_summary(negotiation, offers, prop) -> dict | None`, added
directly to `backend/app/services/property_negotiation.py` (a sibling
function, not a new `negotiation_agreement.py` file — it's a small pure
function that reuses data this module already loads for every other
negotiation response, so a separate file would only add an import for no
real separation of concerns). No AI call, no new persisted columns.

Returns `None` unless `negotiation.status == "accepted"` — never fabricates
a summary ahead of an actual acceptance. When accepted, returns:
`property_id`/`property_title` (from `prop`), `customer_name` (from
`negotiation.customer`), `mediator_agent_name` (from `negotiation.mediator`),
`transaction_type`, `original_listing_amount`, `final_agreed_amount` (read
off the `NegotiationOffer` row actually marked `status == "accepted"` —
falling back to `negotiation.current_offer_amount` only defensively, since
`accept_offer()` always sets that row's status in the same transaction that
flips the negotiation to `"accepted"`), `agreed_at` (`negotiation.
accepted_at`), and `negotiation_reference` — a display-only id
(`NEG-000123`, zero-padded to 6 digits) derived from the negotiation's own
primary key, not a stored column.

Wired onto `to_negotiation_detail_out()` (`property_negotiation.py`) as
`PropertyNegotiationDetailOut.agreement_summary` — populated on every
`GET /negotiations/{id}` call once the negotiation is accepted, `null`
otherwise. **Customer-side only for now** (`PartnerNegotiationDetailOut`
does not declare this field, so it's silently dropped by pydantic even
though `to_partner_negotiation_detail_out()` wraps the same underlying dict)
— the brief's Agreement Summary screen (§22) wasn't specified as a
partner-side screen in this prompt's scope; a later prompt can add the field
to `PartnerNegotiationDetailOut` too if the partner UI ends up needing it,
with zero backend logic changes required (the dict already carries the
key).

Tests: `backend/tests/test_negotiations.py`'s "Agreement Summary" section —
`agreement_summary` is `null` both before any offer exchange and while
`countered`; correctly populated (all fields, including
`final_agreed_amount` reading the ACCEPTED offer's amount rather than the
negotiation's original amount) once accepted via the real accept flow; and
a unit-level check (no DB) that `build_agreement_summary()` itself returns
`None` for a non-accepted negotiation.

## Notifications

Event/notification pattern mirrors the existing lead/viewing flow exactly —
see `backend/app/core/outbox.py` (`EventType` dot-namespaced strings) +
`record_event(db, ...)` called in the same transaction as the mutating
write, and `backend/app/models/notification.py`'s underscore-style
`NOTIFICATION_TYPES` tuple.

Added in this prompt (block `# ── Negotiation & Offer Management ──` in
`outbox.py`, names match brief §19 exactly):

- `EventType.NEGOTIATION_SUBMITTED = "negotiation.offer_submitted"`
- `EventType.NEGOTIATION_COUNTERED = "negotiation.counter_received"`
- `EventType.NEGOTIATION_ACCEPTED = "negotiation.accepted"`
- `EventType.NEGOTIATION_REJECTED = "negotiation.rejected"`
- `EventType.NEGOTIATION_WITHDRAWN = "negotiation.withdrawn"`

Matching `NOTIFICATION_TYPES` entries: `negotiation_offer_submitted`,
`negotiation_counter_received`, `negotiation_accepted`,
`negotiation_rejected`, `negotiation_withdrawn`.

**Prompt 2 implemented `NEGOTIATION_SUBMITTED`** (notifies the property's
mediator). `create_negotiation()` calls `record_event(db,
event_type=EventType.NEGOTIATION_SUBMITTED, ...)` in the same transaction as
the negotiation + first offer row, with `payload["actor_user_id"] =
customer_user.id` so the handler never self-notifies the customer who just
submitted. The handler lives in `backend/app/tasks/negotiation_notifications.py`,
mirroring `viewing_notifications.py` exactly: `_TITLES`, `_render`,
`@register_handler(EventType.NEGOTIATION_SUBMITTED)`, `_enqueue()` (hands
off to Celery via `app.core.jobs.enqueue`), `_recipients_for_event()`
(resolves the mediator's `user_id` from `payload["mediator_id"]`, excludes
the actor), and the same dedupe-key (`f"{event_type}:{aggregate_id}:
{user_id}"`) pre-check + `_deliver()` pipeline every other notification type
uses. Registered at import time via `app.main`'s `import
app.tasks.negotiation_notifications  # noqa: F401` line.

**Prompt 3 adds `NEGOTIATION_COUNTERED`, `NEGOTIATION_ACCEPTED`,
`NEGOTIATION_WITHDRAWN`** — same file, extending `_TITLES`, `_render()`, and
`_recipients_for_event()`, plus a `@register_handler`/`_enqueue()` pair per
event type. Because `submit_counter()`/`accept_offer()` both back either
side of the exchange, `_recipients_for_event()` resolves who to notify from
the event payload rather than the event type alone:

- `NEGOTIATION_COUNTERED` — notifies the mediator when
  `payload["offer_type"] == "customer_counter"`, else (Prompt 4's
  `"mediator_counter"`) notifies the customer.
- `NEGOTIATION_ACCEPTED` — notifies the mediator when
  `payload["accepted_by"] == "customer"`, else (Prompt 4) notifies the
  customer.
- `NEGOTIATION_WITHDRAWN` — customer-only action, always notifies the
  mediator; `_render()`'s body includes the free-text `reason`.

The existing self-notify exclusion (`payload["actor_user_id"]`) and dedupe
pre-check apply unchanged. Note (pre-existing convention, not a Prompt 3
change): `deep_link` is hardcoded to
`mymakan://partner/negotiations/{id}` for every recipient regardless of
role, same as `viewing_notifications.py` already does for viewing
notifications — left as-is rather than fixed out-of-scope here.

**Prompt 4 adds `NEGOTIATION_REJECTED`** — same file, same pattern:
`_TITLES`/`_render()` gain a `negotiation_rejected` entry (`_render()`'s body
includes the free-text `reason`, same shape as `NEGOTIATION_WITHDRAWN`'s),
plus a `@register_handler(EventType.NEGOTIATION_REJECTED)`/`_enqueue()` pair.
Unlike `NEGOTIATION_COUNTERED`/`NEGOTIATION_ACCEPTED`,
`reject_negotiation()` is mediator-only with no customer-side equivalent, so
`_recipients_for_event()` always resolves the customer as the recipient
(same unconditional shape as `NEGOTIATION_WITHDRAWN`'s mediator-only ->
always-notify-mediator branch, just the other direction). The existing
self-notify exclusion and dedupe pre-check apply unchanged; `deep_link`
stays the same hardcoded `mymakan://partner/negotiations/{id}` pattern.

**Prompt 6 polishes `_TITLES`/`_render()`'s copy to match brief §19's exact
example strings** (recipient resolution / dedupe / delivery pipeline all
unchanged — copy-only): `negotiation_offer_submitted`'s title changed from
"New offer submitted" to brief §19's exact "New offer received", body
changed to brief §19's exact "SAR X offer received for {property title}."
(plus a short "Review it to respond." call-to-action, matching this
codebase's existing 2-sentence body convention).
`negotiation_counter_received`'s title changed from "New counter-offer" to
brief §19's exact "New counter offer"; its body now branches on
`payload["offer_type"]` (already available — `_recipients_for_event()` was
already reading it) — the mediator -> customer direction
(`offer_type="mediator_counter"`) uses brief §19's exact "The mediator
proposed SAR X for the apartment in {district}." (two new helpers,
`_property_type_label()` reading `Property.property_type` and
`_district_label()` reading `Property.area` — same "area IS district"
convention `property_negotiation.py`'s `to_negotiation_out()` already
documents), falling back to the generic `{property_title}` phrasing when
either is unavailable; the customer -> mediator direction
(`offer_type="customer_counter"`) has no dedicated brief example string, so
it mirrors the same sentence shape with symmetric "The customer proposed
SAR X for {property title}." wording. `negotiation_accepted`/
`negotiation_withdrawn`/`negotiation_rejected` copy is untouched (no brief
example string given for these, and the existing copy was already
reasonably close to that style).

**Deep-link payload (brief §19):** `deep_link` stays the same
`mymakan://partner/negotiations/{id}` string every recipient already got
(unchanged) — this already IS the "deep-link payload the frontend can route
on" the brief asks for: the negotiation id is embedded directly in the URL
path, the exact same shape `viewing_notifications.py`'s
`mymakan://partner/viewings/{id}` uses. No code change was needed here, just
confirmed it already satisfies the requirement.

Tests: `backend/tests/test_negotiations.py`'s "Notification content"
section calls `negotiation_notifications._render()` directly (no DB/Celery
required) and asserts the rendered title/body strings match the brief's
exact example copy for `negotiation_offer_submitted` and both directions of
`negotiation_counter_received`, in both English and Arabic.

## Screens changed

**Backend complete as of Prompt 6. Prompt 7 (this prompt) is the first
frontend prompt — web only, Property Detail's entry point + the Make an
Offer flow.** Everything else below is still TODO, filled in by Prompts
8-13:

- **Property Detail (`frontend/src/routes/property.$id.tsx`) — DONE (Prompt
  7):**
  - "Make an Offer" / "View Negotiation" CTA added to `ActionsCard`, next to
    the existing Contact Landlord / Schedule Viewing buttons. Hidden
    entirely when the property isn't `Published` (raw backend status,
    captured separately from the mapped UI `Property.status` which has no
    `"Published"` literal of its own — see the `isPublished` state and its
    comment in `PropertyDetail`). Backed by a new effect that calls
    `fetchActiveNegotiation()` (404 = no active negotiation, the expected
    common case, soft-failed the same way `fetchAreaIntelligence`/
    `fetchMyViewings` already are) — "View Negotiation" shown instead of
    "Make an Offer" when one exists.
  - New `MakeOfferModal` component (same file): a 4-step modal — Offer
    Intelligence (reuses the already-fetched `intelligence.
    negotiation_intelligence`, the exact data `NegotiationInsightCard`
    renders — no second fetch; shows the brief §4 "Limited market data —
    make an offer based on your own preference" copy when
    `price_intelligence.sufficient_data` is false or there's no
    negotiation_intelligence at all) → Enter Amount → optional Message
    (**Draft with AI** reuses the same `POST /properties/{id}/ai-summary?
    variant=negotiation_message` call `NegotiationInsightCard`'s own "Draft
    message" action already makes — editable textarea, never auto-sent,
    per the backend doc's Prompt 7-9 hard requirement) → Review → Submit
    (`createNegotiation`). On success shows an inline confirmation state
    (mirrors `ContactModal`'s own `sent` state) linking into
    `/negotiations/$id`.
  - **`/negotiations/$id` doesn't exist as a route file yet** (Prompt 8
    builds it next) — both the "View Negotiation" CTA and the modal's
    post-submit confirmation link to it via a plain `<a href="/negotiations/
    {id}">` rather than TanStack's typed `<Link>`, specifically so `tsc`/
    the route tree stay clean until Prompt 8 adds the route; swapping to
    `<Link to="/negotiations/$id">` then is a trivial follow-up.
  - Retargeted the existing "Ask AI about negotiation" action on a
    completed viewing's detail screen (`frontend/src/routes/
    viewings.$id.tsx`, was a deep link to `/advisor`) to instead navigate to
    `/property/$id` and open the Make an Offer flow pre-filled with
    `viewing_id` — via a `sessionStorage` handoff
    (`maskan_offer_viewing_id`) using the exact same
    write-once-before-navigating/read-once-and-clear idiom
    `storeAdvisorCtx`/`consumeHomeFinderCriteria` already establish in
    `property.$id.tsx` (see `consumeOfferHandoff`). Button copy changed from
    "Ask AI about negotiation" to "Make an offer" since it no longer opens
    an AI chat.
  - `frontend/src/lib/api/maskan.ts` gained `createNegotiation`,
    `fetchMyNegotiations`, `fetchNegotiation`, `fetchActiveNegotiation` (new
    section "AI Negotiation & Offer Management (Prompt 7)", same
    `requestJson` pattern as the viewings block) plus the matching
    `ApiPropertyNegotiation`/`ApiNegotiationOffer`/`ApiPropertyNegotiationDetail`/
    `ApiAgreementSummary` types. **Field-type gotcha found during manual
    verification (worth flagging for Prompt 8+):** the backend declares
    `current_offer_amount`/`original_listing_amount`/`property_listing_amount`/
    offer `amount`/agreement-summary amount fields as `Decimal`, which
    pydantic v2 serializes to a JSON **string** (e.g. `"13500.00"`), unlike
    `Property.monthly_rent`/`sale_price` which are plain `float` and
    serialize as real JSON numbers — confirmed against a live dev-server
    response. The new TS types declare these fields `string`, not `number`;
    always wrap in `Number(...)` before formatting/arithmetic (see
    `MakeOfferModal`'s confirmation copy for the pattern). Counter/accept/
    withdraw/ai-guidance API helpers were deliberately NOT added here — they
    belong to Prompt 8's Negotiation Detail screen.
  - New i18n keys: `property.actions.makeOffer`/`viewNegotiation` and the
    full `property.negotiation.modal.*` namespace in both `en.ts`/`ar.ts`
    (RTL-safe — plain flexbox/text, no hardcoded direction).
  - **Bug caught and fixed during manual verification, not just
    code-review:** the modal's render was originally gated on `showMakeOffer
    && isPublished && !activeNegotiation`. Since a successful submit's
    `onSuccess` callback sets `activeNegotiation` in the parent, that last
    clause caused the modal to unmount itself — wiping out the confirmation
    screen — the instant submission succeeded, before the customer ever saw
    it. Fixed by gating on `showMakeOffer` alone (the "no active negotiation
    yet" precondition is already enforced by the CTA only offering "Make an
    Offer" when none exists). Also fixed: the Offer Intelligence step's
    fallback listing-price hint (used when `negotiation_intelligence` is
    unavailable) originally read `property.price` directly, which for rent
    listings is the *annual* figure the page displays as "Annual rent" —
    unit-inconsistent with what `create_negotiation()` actually compares the
    offer against (`Property.monthly_rent`). Fixed to divide by 12 for rent,
    matching the same conversion `ActionsCard`'s own "~SAR X/month" hint
    already uses.
- **Negotiation Detail (customer) — DONE (Prompt 8):** new route
  `frontend/src/routes/negotiations.$id.tsx`, structural sibling of
  `viewings.$id.tsx` (same skeleton/auth-gate/two-column layout, sticky
  actions aside, timeline-from-timestamps pattern).
  - Property block (image/title/district/listing price/View Property),
    mirroring `viewingDetail.propertyBlock` exactly.
  - Offer-vs-listing comparison card: `current_offer_amount` /
    `original_listing_amount` in large money typography, a
    below/above-listing delta line (amount + %), and a status badge
    (`submitted`/`countered`/`accepted`/`rejected`/`withdrawn`/`closed`).
  - **Negotiation strength signal badge — now a real backend field (gap
    closed post-Prompt-8):** Prompt 8's original pass found that
    `GET /negotiations/{id}` didn't embed
    `negotiation_signals.compute_negotiation_signal()`'s output anywhere, so
    `negotiations.$id.tsx` shipped with a client-side approximation
    (`computeSignal()`) as a documented, deliberate deviation. This was
    closed immediately afterward, before Prompts 9-13 could each duplicate
    the same approximation on their own surfaces: `to_negotiation_detail_out()`
    (`backend/app/services/property_negotiation.py`) now calls
    `compute_negotiation_signal(negotiation.current_offer_amount,
    price_intel)` directly (it already has `price_intel` in scope for
    `negotiation_insight`/`summary_text`) and embeds the result as
    `negotiation_signal: {signal, label}` on both
    `PropertyNegotiationDetailOut` and `PartnerNegotiationDetailOut`
    (`NegotiationSignalOut` schema). `negotiations.$id.tsx` was updated to
    read `negotiation.negotiation_signal.signal` directly and
    `computeSignal()` was deleted — no more client-side re-derivation. All
    85 backend tests plus `tsc --noEmit`/`vite build` verified clean after
    the change. Prompts 9-13 (My Negotiations list, partner portal, mobile,
    polish pass) should read this same field rather than re-inventing a
    classifier.
  - myMakan Summary card renders `summary_text` verbatim (always populated,
    no AI call — see "AI behavior" above).
  - Timeline (`NegotiationTimeline`): one entry per `offers[]` row (labeled
    by `offer_type` — Your offer / Mediator's counter / Your counter-offer),
    plus a synthesized `Accepted`/`Rejected`/`Withdrawn` entry from
    `accepted_at`/`rejected_at`/`updated_at` (no `withdrawn_at` column exists
    — see "Known limitations") when the negotiation is in that terminal
    status. Matches brief §12's exact shape (label + amount + time per row).
  - Actions (sticky aside): **Accept** only shown when the single latest
    offer (`offers[offers.length - 1]`) is a `pending` `mediator_counter` —
    mirrors the backend's own self-accept-blocked rule so the button is never
    offered somewhere it would just 409; **Counter Again** / **Withdraw**
    shown whenever `status` is `submitted`/`countered`; **Ask myMakan**
    always available (toggles `AskMyMakanPanel` inline in the main column);
    once `status === "accepted"`, counter/withdraw are hidden and a **View
    Agreement Summary** button links to `/negotiations/{id}/agreement` via a
    plain `<a>` (not `<Link>` — that route doesn't exist yet, Prompt 9 builds
    it, same "plain `<a>` until the route file exists" idiom Prompt 7 used
    for `/negotiations/$id` itself).
  - **Ask myMakan panel** (`AskMyMakanPanel`): optional free-text question +
    `fetchNegotiationGuidance()`. Per brief §13, always shows a standing
    disclaimer ("not a mathematically optimal offer...") under the AI
    response, plus an extra emphasized warning line specifically when the
    computed signal is `limited_comparable_data` (low confidence).
  - **Counter Again** (`CounterModal`): amount + optional message, same
    **Draft with AI** action as Prompt 7's `MakeOfferModal`, but now calling
    `fetchPropertyAiSummary(propertyId, lang, "negotiation_message",
    negotiation.id)` — the extended signature (see `maskan.ts` changes
    below) so the draft grounds in this negotiation's real offer history via
    the Prompt 6 `negotiation_id` body field, not the generic pre-negotiation
    discussion range. On submit: `submitCounterOffer()` then a full
    `fetchNegotiation()` re-fetch (the action route only returns
    `PropertyNegotiationOut`, not the detail shape with `offers`/
    `summary_text` — re-fetching is simpler and more correct than trying to
    merge a partial response into local state).
  - **Withdraw** (`WithdrawModal`): reason `<select>` from brief §11's
    closed customer list (`NEGOTIATION_CUSTOMER_WITHDRAW_REASONS` — "Changed
    mind" / "Found another property" / "Budget changed" / "Other") + an
    optional free-text note. The backend only accepts a single `reason: str`
    (no separate note field), so the UI folds the note into it
    (`"{reason}: {note}"` when a note is entered) before calling
    `withdrawNegotiation()`.
  - `frontend/src/lib/api/maskan.ts` gained `submitCounterOffer`,
    `acceptNegotiation`, `withdrawNegotiation`,
    `NEGOTIATION_CUSTOMER_WITHDRAW_REASONS`, `fetchNegotiationGuidance` (new
    "Negotiation Detail actions (Prompt 8)" section) — all four mutating
    actions return only `ApiPropertyNegotiation` (no offers/summary_text),
    matching each route's `response_model=PropertyNegotiationOut` in
    `negotiations.py`; callers always re-fetch via `fetchNegotiation()`
    afterward. `fetchPropertyAiSummary()` gained a 4th optional
    `negotiationId` parameter (adds `negotiation_id` to the request body only
    when provided — the pre-existing Property Detail call path from Prompt 7
    is unchanged when omitted).
  - New i18n keys: top-level `negotiationDetail.*` namespace in both
    `en.ts`/`ar.ts` (mirrors `viewingDetail.*`'s structure/placement) — RTL
    reviewed (plain flexbox/logical-property classes throughout, same
    convention every other screen in this codebase uses; no hardcoded
    `left`/`right`).
  - **Verification (Prompt 8):** `npx tsc --noEmit` and `npx vite build`
    both clean (new `negotiations._id-*.mjs` SSR chunk generated,
    `routeTree.gen.ts` correctly picked up `/negotiations/$id`). **No browser
    automation tool (Playwright/MCP) was available in this session** — the
    port-8010 backend already running was a stale process that predated this
    feature (its `/openapi.json` had zero `negotiat*` paths) and could not be
    killed from this session (its PID was invisible to `Get-Process`/
    `taskkill`, consistent with it running outside this sandbox's process
    namespace); it was left alone and untouched. Verified instead by: (1)
    starting a fresh backend from the current working tree on a scratch port
    (8011) and a fresh `vite dev` frontend on another scratch port (5180,
    temporary `frontend/.env.local` pointing at it, deleted afterward) and
    confirming `GET /negotiations/$id` SSRs to a 200 with the correct
    `<title>`; (2) driving the exact same HTTP call sequence the new UI code
    makes, end to end, against a real signed-up test customer + a real
    Published rent property: create an offer (`POST
    /properties/{id}/negotiations`, Prompt 7's flow) -> `GET
    /negotiations/{id}` (confirmed `summary_text`/`offers`/
    `negotiation_insight` shape) -> `POST .../ai-guidance` (Ask myMakan,
    returned a real grounded AI reply) -> `POST /properties/{id}/ai-summary`
    with `negotiation_id` (Counter Again's Draft with AI, returned a message
    grounded in the real offer) -> `POST .../offer` (Counter Again) -> `GET
    /negotiations/{id}` again, confirming the offer list grew from 1 to 2
    rows (`customer_offer` superseded, `customer_counter` pending),
    `current_offer_amount` updated, and `summary_text` re-rendered to
    reflect the 2-round history -> `POST .../withdraw` (Withdraw action).
    All test data (the negotiation, its offers, the test user, its
    notifications/outbox rows) was deleted from the dev DB afterward; the
    scratch backend/frontend processes were killed and the temporary
    `.env.local` removed. **What this does and doesn't prove:** it confirms
    the new `maskan.ts` functions' request/response shapes match the live
    backend exactly and that the route compiles/mounts/SSRs without error —
    it does NOT confirm the rendered DOM/CSS/click-handlers in an actual
    browser tab (no tool available to do that in this session).
- **My Negotiations (customer) + Offer Agreed + Agreement Summary — DONE
  (Prompt 9, web customer-side now complete):**
  - **New route `frontend/src/routes/negotiations.tsx`** — structural sibling
    of `viewings.tsx`, same `useRouterState` + `pathname !== "/negotiations"`
    → `<Outlet/>` guard (required now that `negotiations.$id.tsx` and the new
    `negotiations.$id_.agreement.tsx` both nest under it).
  - **Tab mapping (brief §20), documented here as the single source of
    truth** — `STATUS_TAB` in `negotiations.tsx`:
    | Backend status | UI tab |
    |---|---|
    | `submitted`, `countered` | **Active** — still in play, either side can act |
    | `accepted` | **Accepted** — its own "Offer Agreed" state (see below) |
    | `rejected`, `withdrawn`, `closed` | **Closed** — terminal, no further action |

    Fetches the caller's full `GET /negotiations` list once (no `?status=`
    filter) and buckets client-side, same pattern `viewings.tsx` uses for its
    4-tab split — gives instant, always-in-sync tab counts without a
    per-tab re-fetch.
  - **Cards**: property image/title/district, listing amount vs. current
    offer (both `Number(...)`'d per the Decimal-serializes-as-string gotcha
    Prompt 7 documented), a status badge reusing `negotiationDetail.status.*`
    (no duplicate status-label i18n namespace), last activity
    (`updated_at`), mediator name. **Actions**: Open (`Link` to
    `/negotiations/$id`) / Ask myMakan (`Link` to `/negotiations/$id?ask=1`,
    see below) / Message Mediator (`Link` to `/lead/$leadId`, **only
    rendered when `negotiation.lead_id != null`** — brief §12/§18's "reuse
    the existing lead-message thread, don't build a second chat" instruction
    taken literally: since `lead_id` is only ever attached via an existing
    `LeadSuggestion` match (see "Lead integration" above) and is genuinely
    `null` on most negotiations, there is no lead thread to link to for
    those, so the action is hidden rather than pointing at nothing or
    inventing a new messaging surface).
  - **"Ask myMakan" deep link**: rather than duplicating the AI-guidance
    panel's UI on the list page, the card's "Ask myMakan" action links into
    `negotiations.$id.tsx` with a new optional `?ask=1` search param.
    `negotiations.$id.tsx` gained a small, additive `validateSearch: (s) =>
    ({ ask: ... })` on its `Route` definition (previously had none) and
    `showAsk`'s initial `useState` now reads it
    (`useState(() => ask === true)`) — the panel opens pre-expanded on
    arrival instead of requiring a second click. Zero changes to the panel
    itself.
  - Skeleton loading (3 card-shaped `Skeleton`s, matches `viewings.tsx`),
    per-tab `EmptyState` copy, and a dedicated error/retry `EmptyState`
    (`fetchMyNegotiations()` failure sets an `error` flag with a `Retry`
    button calling the same `load()` — `viewings.tsx`'s own list page
    silently swallows fetch errors with `.catch(() => {})`; this page does
    not, per this prompt's explicit "error/retry states" requirement).
  - **Reachable from the customer account area**: `frontend/src/components/
    maskan/TopNav.tsx`'s `useNavLinks()` gained `MY_NEGOTIATIONS_LINK`
    (`nav.myNegotiations` → `/negotiations`), appended to the persistent nav
    row exactly like the existing `MY_LEADS_LINK`, shown only when signed in.
    `NavAuthButton.tsx`'s account dropdown gained a matching "My negotiations"
    entry (`navAuth.myNegotiations`, `Handshake` icon) right after "My
    leads". **Note on "My Viewings" precedent**: while researching where to
    add this sibling entry, `/viewings` (the list page) turned out to have NO
    persistent-nav or dropdown entry anywhere in the app at all — only
    `/viewings/$id` is reachable, from `ViewingStatusBanner` on Property
    Detail when an active viewing exists. This is a pre-existing gap
    unrelated to this feature (left untouched, out of scope) — "My
    Negotiations" was still added as a sibling of "My Leads" (which IS
    linked from both places), matching the prompt's literal instruction.
  - **Offer Agreed state (brief §10)** — new section on
    `negotiations.$id.tsx`, rendered directly in the main column (right after
    the Property block, before the Offer-vs-Listing card) whenever
    `negotiation.status === "accepted"`: a success-toned card with the
    agreed amount (`agreement_summary.final_agreed_amount`, defensively
    falling back to `current_offer_amount` if `agreement_summary` hasn't
    loaded) in large money typography, and the disclaimer sentence **verbatim
    per the brief**: *"This records the commercial agreement in myMakan. It
    is not the legal rental/purchase contract."* — stored once as
    `negotiationDetail.agreed.disclaimer` and read by BOTH this card and the
    standalone Agreement Summary page (below) via the same i18n key, so the
    two screens can never say something different. The sticky actions aside's
    pre-existing `accepted`-branch (Prompt 8 left it as a placeholder plain
    `<a href>`, since the agreement route didn't exist yet) is now a real
    typed `<Link to="/negotiations/$id/agreement">`, plus two new buttons:
    **Message Mediator** (typed `Link` to `/lead/$leadId`, same
    `lead_id != null` gate as the list card) and **Continue Transaction**
    (typed `Link` to `/transaction/$id`, the new placeholder route below).
  - **New route `frontend/src/routes/negotiations.$id_.agreement.tsx`** —
    the Offer Agreement Summary screen (brief §22). **Filename/routing
    decision**: named with a trailing underscore after `$id`
    (`negotiations.$id_.agreement.tsx`), TanStack Router's flat-routes
    "escape nesting" marker — this codebase already uses the identical
    convention for `admin_.notifications.tsx` etc. The resulting URL is
    still `/negotiations/$id/agreement`, but the route does NOT use
    `negotiations.$id.tsx` as its layout (verified in the generated
    `routeTree.gen.ts`: both `NegotiationsIdRoute` and
    `NegotiationsIdAgreementRoute` are direct children of `NegotiationsRoute`
    — neither nests under the other). This means the already-verified,
    683-line `negotiations.$id.tsx` from Prompt 8 needed **zero** structural
    changes (no `Outlet`/pathname-guard retrofit) to gain this child route —
    it still nests under the new `negotiations.tsx` list route, whose
    `Outlet` guard already lets any other `/negotiations/*` path through
    unmodified. Renders the backend's `agreement_summary` (already embedded
    on `GET /negotiations/{id}` since Prompt 6, `null` unless
    `status === "accepted"` — this page shows an explanatory
    "hasn't reached an agreement yet" state rather than crashing if a
    customer navigates here directly for a non-accepted negotiation): all
    `AgreementSummary` fields (property/customer/mediator/transaction
    type/original listing/final agreed amount/agreed date/`NEG-000NNN`
    reference), the same disclaimer sentence repeated verbatim (shared i18n
    key, see above), and the same Message Mediator / Continue Transaction
    actions. **Download/share omitted**, per the prompt's explicit
    allowance ("skip unless trivial — it isn't here").
  - **New route `frontend/src/routes/transaction.$id.tsx`** — the "Continue
    Transaction" placeholder (brief §10 explicitly allows a stand-in this
    session). A standalone route (`/transaction/$id`, not nested under
    `/negotiations`), a plain "Coming soon" `EmptyState` with a link back to
    the negotiation. **Carries zero payment/contract/Ejar/Nafath logic** —
    matches "Known limitations" above; nothing beyond this placeholder page
    exists anywhere in the feature.
  - `frontend/src/lib/api/maskan.ts`: no new functions needed — `negotiations.
    tsx` reuses `fetchMyNegotiations()` (Prompt 7) and the agreement page
    reuses `fetchNegotiation()` (Prompt 7/8), since `agreement_summary` has
    been embedded on the detail response since Prompt 6.
  - New i18n keys (both `en.ts`/`ar.ts`, RTL-checked — plain flexbox/logical
    properties throughout, no hardcoded `left`/`right`): `nav.myNegotiations`
    / `navAuth.myNegotiations`; the full `myNegotiations.*` namespace (mirrors
    `myViewings.*`'s structure); `negotiationDetail.agreed.*` (new, extends
    the existing namespace); the full `negotiationAgreement.*` namespace; the
    full `transactionPage.*` namespace.
  - **Verification (Prompt 9):** `npx tsc --noEmit` and `npx vite build` both
    clean (new SSR chunks generated: `negotiations-*.mjs`,
    `negotiations._id_.agreement-*.mjs`, `transaction._id-*.mjs`;
    `negotiations._id-*.mjs` regenerated for the modified detail route;
    `routeTree.gen.ts` confirmed the nesting described above). Unlike Prompt
    8's session, a genuinely live dev stack was available and used for real
    verification: `npx vite dev` (frontend, port 8082) and a FastAPI backend
    (port 8010) were already running against the local Postgres dev DB — but
    the port-8010 backend turned out to be another instance of the exact
    same stale-process issue Prompt 8 already documented (its `/openapi.json`
    had zero `negotiat*` paths, confirmed by polling it three times a few
    seconds apart with identical stale results), so — per this session's
    explicit instruction to prefer scratch ports over fighting for stale
    ones — a fresh backend was started from the current working tree on
    port 8011 (confirmed via `/openapi.json` to have all negotiation +
    partner-negotiation routes) and a fresh `vite dev` frontend on port 5181
    (temporary `frontend/.env.local` pointing at it, deleted afterward).
    Verified against port 8011 + a real Postgres dev DB, end to end: (1) SSR
    `<title>` + 200 status confirmed for all four routes touched by this
    prompt (`/negotiations`, `/negotiations/{id}`,
    `/negotiations/{id}/agreement`, `/transaction/{id}`, plus the
    `?ask=1` variant); (2) signed up a real test customer AND a real test
    mediator, registered + mock-subscribed the mediator, created a real
    Published rent property as that mediator (`POST /properties/partner/`
    defaults new listings to `"Pending Approval"` — approved via one direct
    `UPDATE properties SET status='Published'`, the "quick DB update" this
    prompt's own instructions anticipated needing since Prompt 10's partner
    admin-approval UI isn't in scope); (3) customer created a real
    negotiation (`POST /properties/{id}/negotiations`) and confirmed `GET
    /negotiations` (list) and `GET /negotiations/{id}` (detail, pre-accept)
    match the exact shapes `negotiations.tsx`/`negotiations.$id.tsx` expect,
    including a real `negotiation_signal`/`negotiation_insight`/
    `summary_text`, `agreement_summary: null`; (4) **the mediator accepted
    the customer's offer via the REAL partner API**
    (`POST /partner/negotiations/{id}/accept`, no DB hack needed for this
    step since Prompt 4's partner routes are fully built) and `GET
    /negotiations/{id}` was re-fetched, confirming `status: "accepted"` and a
    fully-populated `agreement_summary` matching
    `negotiations.$id_.agreement.tsx`'s field usage exactly
    (`property_id`/`property_title`/`customer_name`/`mediator_agent_name`/
    `transaction_type`/`original_listing_amount`/`final_agreed_amount`/
    `agreed_at`/`negotiation_reference`, e.g. `"NEG-000899"`); (5) a second
    negotiation was created and withdrawn
    (`POST /negotiations/{id}/withdraw`) to confirm the list correctly
    returns mixed statuses (`accepted` + `withdrawn`) for the tab-bucketing
    logic to split across Accepted/Closed. All test data (both negotiations
    + their offers, the outbox/notification rows, the test property, the
    test mediator, both test users) was deleted from the dev DB afterward;
    the scratch backend (port 8011) and frontend (port 5181) processes were
    killed and the temporary `.env.local` removed. The original port-8082/
    8010 dev processes were left running, untouched. **What this does and
    doesn't prove**: confirms the real backend contract end-to-end (including
    a real partner-side accept, not a DB-side status flip) matches every
    field this prompt's new/changed components read, and that every route
    SSRs without error — it does NOT confirm the rendered DOM/CSS/
    click-handlers in an actual browser tab (still no Playwright/browser
    automation tool available in this session).
- **Partner Negotiations list/detail — DONE (Prompt 10, web partner portal now
  complete):** mirrors `partner.viewings.tsx`/`partner.viewings.$id.tsx`'s own
  structure (tabs/status-filtered list + detail, same
  `useRouterState`+conditional-`<Outlet/>` sibling-route guard) against the
  `/partner/negotiations...` routes from backend Prompt 4.
  - **New route `frontend/src/routes/partner.negotiations.tsx`** — 5 tabs per
    brief §7 (New Offers / Countered / Accepted / Rejected / Closed).
    `STATUS_TAB` maps the backend's 6 statuses onto these 5:
    `submitted`→New Offers, `countered`→Countered, `accepted`→Accepted,
    `rejected`→Rejected, and BOTH `withdrawn`/`closed`→Closed (no dedicated
    "Withdrawn" tab exists in the brief's 5-tab list, so a customer-withdrawn
    negotiation folds into the same terminal "Closed" bucket `closed` itself
    uses — documented here as the single source of truth, same convention
    `negotiations.tsx`'s own `STATUS_TAB` table documents for the customer
    side). Fetches `fetchPartnerNegotiations()` once (no `status_filter`) and
    buckets client-side, matching every other tabbed list in this codebase.
  - **Cards**: property title/image, `customer_name`, listing amount vs.
    current offer (both `Number(...)`'d per the Decimal-as-string gotcha),
    a below/above-listing delta line (reuses
    `negotiationDetail.offerBlock.belowListing/aboveListing` — no duplicate
    i18n copy), a negotiation status badge (reuses
    `negotiationDetail.status.*`, same "no duplicate status-label i18n
    namespace" decision Prompt 9 made), submitted-time relative age, and
    **viewing-linked/lead-linked indicators**. **Scope decision on "viewing
    status if linked / lead status if linked" (brief §7):**
    `PartnerNegotiationOut` denormalizes `viewing_id`/`lead_id` but not the
    linked viewing's/lead's own status — showing the actual linked-record
    status would mean a second N+1 fetch per card (or a backend change out of
    this prompt's scope), so the cards show a boolean "Linked to a
    viewing"/"Linked to an existing lead" indicator instead, the same
    boundary `partnerViewings.tsx`'s own card already accepted for its
    `leadLinked` pill (presence only, not the lead's own status).
  - **Actions**: Open (always) / **Accept** (quick one-click action, shown
    ONLY when `status === "submitted"` — at that point the latest offer is
    guaranteed to be the customer's own, so accepting can never trip the
    backend's self-accept-blocked rule; best-effort try/catch, matching
    `partnerViewings.tsx`'s own `handleQuickConfirm`/`handleQuickComplete`
    convention exactly — "quick action for the unambiguous case, full error
    handling lives on the detail page") / **Counter** and **Reject** (both
    `submitted`/`countered`) — rather than duplicating modal UI on the list
    page, these `Link` into the detail route with a new `?action=counter` /
    `?action=reject` search param that auto-opens the matching modal on
    arrival, the exact same deep-link idiom the customer-side My Negotiations
    list's `?ask=1` action already established (Prompt 9) instead of
    re-inventing a second pattern.
  - **New route `frontend/src/routes/partner.negotiations.$id.tsx`** — brief
    §8's four blocks:
    - **Property block**: image/title/district/listing price/View Property,
      mirrors `negotiationDetail.propertyBlock`/`partnerViewings.detail`'s
      Property block.
    - **Customer block**: `customer_name`/`customer_phone`/`customer_email`
      only (tel:/mailto: links) — deliberately no more than
      `partner.viewings.$id.tsx`'s own Customer block already exposes for a
      viewing (no `customer_note`-equivalent field exists on a negotiation),
      per this prompt's explicit "only info the existing partner lead view
      already exposes" instruction.
    - **Offer block**: current offer amount, a below/above-listing delta line
      (same reused i18n keys as the list card), the **latest** offer's
      `message` (falls back to "No message included." when empty) and
      `created_at` as "submitted time" — deliberately the latest offer's own
      fields, not the negotiation's original `created_at`, so this block
      always describes the offer actually awaiting the mediator's response
      right now, not the negotiation's very first offer.
    - **Market Context**: reuses `GET /properties/{id}/intelligence`
      (`fetchPropertyIntelligence()`, already used by Property Detail) rather
      than a new endpoint — fetched as a second, soft-failed request once the
      negotiation loads (same `.catch()` idiom `fetchAreaIntelligence`/
      `fetchMyViewings` already use). Shows the estimated range
      (`price_intelligence.fair_range_low/high` for rent,
      `estimated_value_low/high` for buy — both tried, mirrors
      `negotiations.$id.tsx`'s own signal-label logic), `comparable_summary.
      count`, and `data_confidence.level`/`reason`; falls back to an
      "insufficient data" message when `sufficient_data` is `False` (true for
      a freshly-created test property with no comparables, confirmed during
      manual verification below) rather than fabricating a range. **Does NOT
      show** `personalized_fit`/`smart_questions`/`things_to_verify` or
      anything customer-viewing-specific — per this prompt's explicit "do not
      show private customer viewing notes" instruction, only the three fields
      brief §8 actually asks for are rendered.
    - **Actions** (sticky aside): **Accept** — mirrors the customer detail
      page's `canAccept` logic exactly but inverted: shown only when the
      single latest offer (`offers[offers.length-1]`) is `pending` AND its
      `offer_type !== "mediator_counter"` (i.e. the customer placed it),
      which is exactly the backend's self-accept-blocked rule, so the button
      is never offered somewhere it would just 409. **Counter**/**Reject**
      (modals, described below) shown whenever `status` is
      `submitted`/`countered`; when `action=counter`/`action=reject` arrived
      via the list's deep link, the matching modal's `useState` initializer
      reads it and opens pre-expanded, same idiom the customer side's `?ask=1`
      uses for `showAsk`. **Message Customer** — typed `Link` to
      `/partner/leads/$leadId`, only rendered when `negotiation.lead_id !=
      null` (reuses the existing lead-message thread — same instruction
      Prompt 9 followed for the customer side's own "Message Mediator"
      action, no second chat surface built). **View Property** — `Link` to
      `/property/$id`.
    - **CounterModal**: amount + optional message, calls
      `counterNegotiationAsPartner()`. **No "Draft with AI" action** on this
      modal (unlike the customer side's `CounterModal`) — this prompt's task
      only lists Accept/Counter/Reject/Message Customer as partner actions,
      with no AI-drafting instruction for the mediator side, so none was
      added; the backend's `negotiation_id`-grounded draft endpoint (Prompt 6)
      remains customer-only for now.
    - **RejectModal**: reason `<select>` from brief §11's mediator list
      (`NEGOTIATION_MEDIATOR_REJECT_REASONS` — "Offer too low" / "Property no
      longer available" / "Owner declined" / "Other") + an optional free-text
      note folded into the single `reason` string the backend accepts, same
      `"{reason}: {note}"` idiom the customer side's `WithdrawModal` already
      established.
  - `frontend/src/lib/api/maskan.ts` gained `fetchPartnerNegotiations`,
    `fetchPartnerNegotiation`, `counterNegotiationAsPartner`,
    `acceptNegotiationAsPartner`, `NEGOTIATION_MEDIATOR_REJECT_REASONS`,
    `rejectNegotiationAsPartner` (new "Partner portal negotiations (Prompt
    10)" section) plus `ApiPartnerNegotiation`/`ApiPartnerNegotiationDetail`
    types — both extend the customer-facing `ApiPropertyNegotiation`/-detail
    types with the denormalized `customer_name`/`customer_phone`/
    `customer_email` fields, mirroring `ApiPartnerPropertyViewing`'s own
    extend-the-customer-type shape exactly.
    `ApiPartnerNegotiationDetail` deliberately does NOT declare
    `summary_text`/`agreement_summary` — `PartnerNegotiationDetailOut` (the
    backend schema) doesn't send them either (see "APIs"/"Agreement Summary"
    above — Agreement Summary stayed customer-side-only as of Prompt 6), so
    declaring them here would be a type that lies about the wire shape.
  - **`frontend/src/routes/partner.tsx` changes**: added a `Handshake`-icon
    "Offers & Negotiations" entry to `NAV_ITEMS`
    (`t("partnerNegotiations.heading")`, `navigate({ to:
    "/partner/negotiations" })`), positioned right after the existing
    "Viewing Requests" entry — copied field-for-field from that entry's own
    shape (separate route, not a `view` switch, `active: false`). **No
    routing-guard code change was needed**: `partner.tsx`'s existing sibling
    guard (`if (pathname !== "/partner") return <Outlet />;`, line ~267) is
    already written generically against ANY pathname other than the exact
    `/partner` dashboard route — it already deferred to `<Outlet/>` for
    `/partner/viewings`, `/partner/viewings/$id`, `/partner/leads/$leadId`,
    etc. without per-route enumeration, so the two new
    `/partner/negotiations` / `/partner/negotiations/$id` routes are covered
    by the exact same line with zero edits.
  - New i18n keys: full `partnerNegotiations.*` namespace (both `en.ts`/
    `ar.ts`), mirroring `partnerViewings.*`'s structure/placement (inserted
    immediately after it in both files). RTL-safe — plain flexbox/logical
    properties throughout, no hardcoded `left`/`right`, consistent with every
    other screen in this codebase.
  - **Customer side reflects a partner action promptly — confirmed, no new
    mechanism built (Task item 4):** this codebase has NO existing
    polling/refetch-on-focus/`visibilitychange` mechanism anywhere in the
    negotiations OR viewings features (confirmed by inspecting
    `negotiations.tsx`/`negotiations.$id.tsx`/`viewings.tsx` — all re-fetch
    only on mount via a `useEffect([user, authLoading])`, no interval/focus
    listener; the only `setInterval`-based polling anywhere in the frontend
    is `partner.leads.$leadId.tsx`'s 10-second lead-message poll, which is
    specific to that chat thread, not a general negotiation-status refresh).
    The existing, established norm for both viewings and negotiations is:
    the customer sees a partner action once they navigate to (or reload) the
    relevant screen — confirmed working end-to-end in this prompt's manual
    verification below (partner accepts via the real API, then a fresh
    `GET /negotiations/{id}` as the customer immediately reflects
    `status: "countered"`/`"accepted"` and the updated `current_offer_amount`
    — no code change was needed or made on the customer side to achieve
    this, since `negotiations.$id.tsx`'s existing `loadNegotiation()`
    already does a fresh fetch on every mount).
  - **Verification (Prompt 10):** `npx vite build` and `npx tsc --noEmit`
    both clean (new SSR chunks generated:
    `partner.negotiations-*.mjs`, `partner.negotiations._id-*.mjs`;
    `routeTree.gen.ts` confirmed `PartnerNegotiationsIdRoute` nests under
    `PartnerNegotiationsRoute`, mirroring the customer-side nesting). A fresh
    backend was started from the current working tree on scratch port 8012
    (confirmed via `/openapi.json` to have all `/partner/negotiations...`
    routes mounted) and a fresh `vite dev` frontend on scratch port 5182
    (temporary `frontend/.env.local` pointing at it, deleted afterward). SSR
    `<title>` + 200 status confirmed for both new routes
    (`/partner/negotiations`, `/partner/negotiations/{id}`). **No
    Playwright/browser automation tool was available in this session**
    (same limitation Prompts 8-9 documented) — the actual business logic was
    instead verified by driving the exact HTTP call sequence the new
    `maskan.ts` functions make, end to end, against a real signed-up test
    customer + a real signed-up/mock-subscribed test mediator + a real
    Published rent property (approved via one direct `UPDATE properties SET
    status='Published'`, same "quick DB update" precedent Prompt 9 used since
    the partner admin-approval UI is still out of scope): (1) customer
    creates an offer (`POST /properties/{id}/negotiations`); (2)
    `GET /partner/negotiations` confirmed the new offer appears with
    `customer_name`/`current_offer_amount`/`property_title` populated exactly
    as the new list card reads them; (3) `GET /partner/negotiations/{id}`
    confirmed the detail shape matches `ApiPartnerNegotiationDetail` exactly
    (`offers`, `negotiation_signal`, `negotiation_insight` present;
    `summary_text`/`agreement_summary` deliberately ABSENT, matching the
    schema); (4) mediator counters (`POST .../counter`) — customer's own
    `GET /negotiations/{id}` immediately reflected the new `status:
    "countered"`/`current_offer_amount` with no customer-side code changes,
    confirming Task item 4; (5) customer counters back
    (`POST /negotiations/{id}/offer`); (6) mediator accepts
    (`POST .../accept`) — confirmed `status: "accepted"`; (7) a second
    negotiation was created, countered by the mediator, then a mediator
    self-accept attempt on their own counter was confirmed to 409 (proving
    the detail page's `canAccept` gating logic matches a real backend
    rejection, not just an assumption) before rejecting it instead
    (`POST .../reject`), confirming `status: "rejected"` and
    `cancellation_reason` persisted correctly; (8) `status_filter=accepted`/
    `status_filter=rejected` on `GET /partner/negotiations` confirmed the
    tab-bucketing data lines up. Also confirmed `GET
    /properties/{id}/intelligence` for the test property returned
    `sufficient_data: false` (no comparables yet), exercising the Market
    Context card's "insufficient data" fallback branch specifically. All test
    data (both negotiations + their 5 offers combined, the outbox rows, the
    test property, the test mediator + its mock payment row, both test
    users) was deleted from the dev DB afterward, verified via row-count
    queries before/after (all counts returned to 0); the scratch backend
    (port 8012) and frontend (port 5182) processes were killed and the
    temporary `.env.local` removed. **What this does and doesn't prove**:
    confirms the real backend contract end-to-end for every new `maskan.ts`
    function, that the self-accept-block/accept/counter/reject transitions
    all behave exactly as the UI's conditional rendering assumes, and that
    both routes SSR without error — it does NOT confirm the rendered
    DOM/CSS/click-handlers in an actual browser tab (still no
    Playwright/browser automation tool available in this session, same
    limitation as Prompts 8-9).
- Push/in-app notification handling for all five event types, deep-linking
  via `mymakan://partner/negotiations/{id}` into the right detail screen —
  still TODO (Prompt 12, per that prompt's "notifications deep-links" scope).
- **Mobile (Expo customer-side) — DONE (Prompt 11):** ports Prompts 7-9's web
  functionality using the exact same backend endpoints (no mobile-only
  backend changes). Partner portal is explicitly out of scope for mobile per
  this prompt's own instructions (partner portal stays web-only).
  - `mobile/src/lib/api/maskan.ts` gained a new "AI Negotiation & Offer
    Management (Prompt 11)" section (inserted right after the Visit &
    Viewing Management block) with `createNegotiation`/`fetchMyNegotiations`/
    `fetchNegotiation`/`fetchActiveNegotiation`/`submitCounterOffer`/
    `acceptNegotiation`/`NEGOTIATION_CUSTOMER_WITHDRAW_REASONS`/
    `withdrawNegotiation`/`fetchNegotiationGuidance`, mirroring
    `frontend/src/lib/api/maskan.ts`'s function names/shapes exactly,
    including the same `ApiNegotiationOffer`/`ApiPropertyNegotiation`/
    `ApiAgreementSummary`/`ApiNegotiationSignal`/`ApiPropertyNegotiationDetail`
    types and the same Decimal-serializes-as-string gotcha (amount fields
    typed `string`, always wrapped in `Number(...)`). Reuses the mobile
    client's pre-existing `ApiNegotiationInsight` type (already declared for
    `NegotiationInsightCard`) rather than redeclaring it — same reuse
    decision the web client made. `fetchPropertyAiSummary()` gained the same
    optional 4th `negotiationId` parameter web's Prompt 8 added (adds
    `negotiation_id` to the request body only when provided; the pre-existing
    Property Detail draft-message call path is unchanged when omitted).
  - **Make an Offer — new standalone screen `mobile/app/negotiation/new.tsx`**
    (a full screen, not a `BottomSheet`, per this prompt's explicit either/or
    choice — mobile's existing multi-step flows, e.g.
    `mobile/app/viewing/new.tsx`, are already full screens with a `Stack`
    step index, not modals, so this stays consistent with that convention
    rather than introducing a one-off wizard sheet). Same 4 steps as web's
    `MakeOfferModal` (Offer Intelligence → Enter Amount → Message → Review),
    same "Limited market data — make an offer based on your own preference"
    fallback when `price_intelligence.sufficient_data` is false, same
    Draft-with-AI action (`fetchPropertyAiSummary(..., "negotiation_message")`)
    into an editable, never-auto-sent text field, same rent-listing `/12`
    listing-price-hint conversion Prompt 7's web fix documented. Reached via
    `propertyId` (+ optional `viewingId`) route params — simpler than web's
    `sessionStorage` handoff idiom, since expo-router passes real params
    directly across a full-screen navigation instead of round-tripping
    through a shared parent route's local state.
  - **`mobile/app/property/[id].tsx`** gained the same "Make an Offer" /
    "View Negotiation" CTA web's `ActionsCard` has: a new `isPublished` state
    (captured off the raw `ApiProperty.status` in `load()`, same "raw backend
    status, not the mapped UI status" convention the web client uses) and a
    new `activeNegotiation` state (fetched via `fetchActiveNegotiation()`,
    404 soft-failed to `null`, same idiom the existing `myActiveViewing`
    effect already uses). The CTA Pressable sits directly below the existing
    schedule-viewing Pressable, gated on `isPublished && user` (mirrors that
    sibling Pressable's own `user &&` gate), and shows "View Negotiation"
    (routes to `/negotiations/{id}`) instead of "Make an Offer" (routes to
    `/negotiation/new`) whenever an active negotiation already exists.
  - **Retargeted "Ask AI about negotiation"** hook on a completed viewing's
    detail screen (`mobile/app/viewings/[id].tsx`'s
    `suggestedActions.askNegotiation` button, previously a deep link to
    `/advisor`) to instead open the Make an Offer flow pre-filled with
    `propertyId` + `viewingId`, same retargeting web Prompt 7 did for the
    equivalent web hook. Button copy changed from "Ask AI about negotiation"
    to "Make an offer" (both `en.ts`/`ar.ts`), matching web's identical copy
    change since the button no longer opens an AI chat.
  - **My Negotiations — new screen `mobile/app/negotiations/index.tsx`**,
    structural sibling of `mobile/app/viewings/index.tsx` (tabbed list, same
    `STATUS_TAB` 3-tab mapping documented in web's "Screens changed" above —
    `submitted`/`countered` → Active, `accepted` → Accepted,
    `rejected`/`withdrawn`/`closed` → Closed). Cards show property
    image/title/district, a status badge, listing amount vs. current offer
    (both `Number(...)`'d), last activity, mediator name, and three actions:
    Open, Ask myMakan (navigates to the detail screen with `ask: "1"` in the
    route params — mobile's equivalent of web's `?ask=1` search param, read
    back via `useLocalSearchParams` on the detail screen), and Message
    Mediator (`Link` to `/lead/{leadId}`, only rendered when
    `negotiation.lead_id != null`, same gate web's card uses). Reachable from
    Profile: a new "My Negotiations" row in `mobile/app/(tabs)/profile.tsx`,
    placed directly after the existing "My Viewings" row (same placement
    precedent, `Handshake` icon, `nav.myNegotiations` key).
  - **Negotiation Detail — new screen `mobile/app/negotiations/[id].tsx`**,
    structural sibling of `mobile/app/viewings/[id].tsx`. Renders: the
    property block; an Offer-vs-listing comparison card with a status badge
    and below/above-listing delta line; the negotiation strength signal
    badge + label read directly off the backend's real
    `negotiation.negotiation_signal.signal` field (never re-derived
    client-side, per this task's explicit instruction); the deterministic
    myMakan Summary (`summary_text`, always populated); a timeline built from
    `offers[]` + the synthesized accepted/rejected/withdrawn terminal event
    (same derivation web's `NegotiationTimeline` uses); a toggleable Ask
    myMakan panel (`fetchNegotiationGuidance()`, with the standing disclaimer
    plus the extra low-confidence warning when the signal is
    `limited_comparable_data`, per brief §13); and a sticky-equivalent
    Actions block — Accept (only when the single latest offer is a pending
    `mediator_counter`, mirroring the backend's self-accept-blocked rule so
    the button is never offered somewhere it would just 409), Counter Again
    and Withdraw (both `BottomSheet`s, since mobile has no native `<select>`
    — reason pickers use the `Chip` component instead of a dropdown, same
    convention `mobile/app/viewings/index.tsx`'s own `CancelSheet` already
    established), Ask myMakan (toggles the panel), View Property, and —
    once accepted — Message Mediator (if `lead_id != null`) and Continue
    Transaction.
  - **Offer Agreed + Agreement Summary — rendered INLINE on this same detail
    screen** (task item 5), not as a separate route the way web's
    `negotiations.$id_.agreement.tsx` is. **Decision (this prompt):** the
    prompt's own wording — "Offer Agreed + Agreement Summary states **on the
    detail screen**" — reads as both states living on one screen, and mobile
    has no established precedent for a second dynamic segment nested under
    an already-dynamic `[id]` route (`negotiations/[id]/agreement` would
    require a file *and* a folder sharing the same `[id]` name, an untested
    pattern in this codebase), so inlining avoided that risk entirely with
    zero loss of functionality — the backend already embeds
    `agreement_summary` on the same `GET /negotiations/{id}` response used to
    render everything else on this screen, so no second fetch is needed
    either. When `negotiation.status === "accepted"`, a success-toned section
    shows the agreed amount + the disclaimer sentence **verbatim, per the
    brief**: *"This records the commercial agreement in myMakan. It is not
    the legal rental/purchase contract."* (`negotiationDetail.agreed.disclaimer`,
    the exact same key/string web uses), followed immediately by the full
    Agreement Summary field list (property/customer/mediator/transaction
    type/original listing/final agreed amount/agreed date/`NEG-000NNN`
    reference) reading `negotiation.agreement_summary`, under a new
    `negotiationDetail.agreementSummary.*` sub-namespace (the mobile
    equivalent of web's standalone `negotiationAgreement.*` namespace, kept
    as a child of `negotiationDetail` instead of top-level since it's no
    longer a separate screen). "Continue Transaction" links to
    `/transaction/{id}` — same placeholder route web has.
  - **New placeholder screen `mobile/app/transaction/[id].tsx`** — mirrors
    web's `transaction.$id.tsx` exactly: an `EmptyState` "Coming soon" card
    with a link back to the negotiation. Carries zero payment/contract/Ejar/
    Nafath logic, same as web (see "Known limitations").
  - **Registered in `mobile/app/_layout.tsx`'s `<Stack.Screen>` list**:
    `negotiation/new`, `negotiations/index`, `negotiations/[id]`,
    `transaction/[id]` (all `headerShown: true, title: ""`, same convention
    every other consumer screen in that list uses).
  - New i18n keys (both `en.ts`/`ar.ts`): `nav.myNegotiations`;
    `property.actions.makeOffer`/`viewNegotiation`; the full
    `property.negotiation.modal.*` namespace (sibling of the existing
    `property.viewing.*` namespace, mirrors web's
    `property.negotiation.modal.*` keys exactly); the full top-level
    `negotiationDetail.*` namespace (mirrors web's, plus the mobile-only
    `agreementSummary.*` sub-namespace described above in place of web's
    separate `negotiationAgreement.*` namespace); `myNegotiations.*`; and
    `transactionPage.*`.
  - **Verification (Prompt 11):** `npx tsc --noEmit` in `mobile/` is clean
    (exit code 0). **Environment note surfaced during verification:**
    `.expo/types/router.d.ts` (Expo Router's generated typed-routes file) was
    stale — it predated even the *existing* `/viewings` screens, so `tsc`
    initially failed on pre-existing `router.push(`/viewings/${id}`)` calls
    in files this prompt never touched (`mobile/app/viewings/index.tsx`,
    `mobile/app/(tabs)/profile.tsx`, etc.), not just the new
    `/negotiations`/`/negotiation`/`/transaction` routes this prompt added.
    Fixed by running `npx expo start` briefly (which regenerates that file as
    a side effect of starting the Metro bundler) and stopping it once
    `.expo/types/router.d.ts` picked up every route file on disk; re-running
    `npx tsc --noEmit` afterward was clean with zero errors, confirming the
    fix was the stale-types file and not an actual type error in either the
    pre-existing or new code. **No Android emulator, iOS simulator, or
    physical device was available in this sandboxed session** — checked
    explicitly (`adb devices`, `xcrun simctl list devices`, an `emulator`
    binary, and `ANDROID_HOME`/`ANDROID_SDK_ROOT` env vars all absent/empty)
    rather than assumed. Per this prompt's own fallback instruction, the
    verification bar used instead was: `npx tsc --noEmit` clean (above) plus
    the `npx expo start` run above doubling as the Metro-bundler smoke check
    — it printed "Starting Metro Bundler" / "Waiting on
    http://localhost:8099" with no bundling errors before being stopped. **No
    manual on-device walkthrough (property → Make an Offer → My Negotiations
    → detail → Ask myMakan → counter) was performed or claimed** — there was
    no device/emulator/simulator to run it on.
- **Polish pass — DONE (Prompt 12, customer + partner UI now fully complete,
  web + mobile).** Read-only research first (per this prompt's own
  instructions), then four scoped changes:
  1. **Notification deep-links — a real bug fixed, not just wired up.**
     Researching "how viewing notifications already deep-link" (the prompt's
     own stated precedent to mirror) found they didn't actually work either:
     `frontend/src/lib/notificationDisplay.ts::deepLinkToPath()` and
     `mobile/src/lib/deepLink.ts::deepLinkToRoute()` both only ever matched
     the `myhome://` scheme, but `viewing_notifications.py` and
     `negotiation_notifications.py` (backend) emit `mymakan://` — a scheme
     that was never added to either resolver, almost certainly a casualty of
     the myMakan rebrand commit only updating half the places. Tapping/
     clicking ANY viewing or negotiation notification silently did nothing
     (both resolvers returned `null` for every one of them, falling back to
     "mark read on click" with no navigation). Neither resolver had a
     `viewings/`/`negotiations/` path branch at all either (only `property/`,
     `saved-searches/`, `lead/`, `property-requests/`). Fixed in both
     resolvers: (a) the scheme regex now accepts `myhome://` OR `mymakan://`
     (leads/saved-searches/property-requests still emit `myhome://` — left
     untouched, out of scope to touch five already-shipped backend renderers
     for a scheme-name mismatch); (b) added `viewings/{id}` and
     `negotiations/{id}` path handling. Both `viewing_notifications.py` and
     `negotiation_notifications.py` hardcode the SAME partner-prefixed
     `mymakan://partner/{viewings,negotiations}/{id}` deep link for every
     recipient regardless of role (documented, deliberately left as-is, in
     both those files' own module docstrings) — resolved per-viewer `scope`
     on web (`scope === "partner" ? /partner/negotiations/{id} :
     /negotiations/{id}`, exact same idiom the pre-existing `lead/` branch
     already used for the identical customer-vs-mediator split) and always to
     the customer route on mobile (no partner portal exists there at all, see
     "Mobile" above — confirmed by grepping `mobile/app/` for any `partner/`
     screen: none exist outside `agent/[id].tsx`/`lead/*`). No backend change
     — no new mechanism, exactly as instructed.
  2. **Negotiation strength signal badge — now on all four surfaces, not
     just the two detail screens.** `negotiations.$id.tsx` (web customer
     detail) and `mobile/app/negotiations/[id].tsx` (mobile detail) already
     read `negotiation.negotiation_signal.signal` directly (confirmed during
     this prompt's read-only research, per the parent task's explicit
     pointer) — untouched beyond a refactor (below). The two gaps were the
     **list cards**: `negotiations.tsx` (My Negotiations) and
     `partner.negotiations.tsx` (partner inbox) rendered a status badge but
     no strength badge, and `partner.negotiations.$id.tsx` (partner detail)
     never rendered one at all despite `PartnerNegotiationDetailOut` already
     carrying the field since Prompt 8's follow-up. Closed by: the backend
     addition above (list endpoints now carry `negotiation_signal` too), a
     new shared constants module per platform —
     `frontend/src/lib/negotiationSignal.ts` /
     `mobile/src/lib/negotiationSignal.ts` (`NEGOTIATION_SIGNAL_TONE`/
     `NEGOTIATION_SIGNAL_I18N_KEY`, identical mapping on both platforms) —
     extracted from what was previously an inline `SIGNAL_TONE`/
     `SIGNAL_I18N_KEY` pair duplicated only in the two detail screens, now
     imported by all four (six, counting the extraction itself) surfaces so
     the color/label mapping can't drift apart across copies; and a small
     `<Badge>` added to each of the three previously-missing surfaces,
     reusing the existing `negotiationDetail.signal.tag.*` i18n keys (no new
     i18n strings needed for this task).
  3. **General sweep (loading/empty/error/RTL) — two genuine gaps found and
     fixed, everything else already matched established precedent:**
     - `partner.negotiations.tsx` (partner inbox list) had NO error state at
       all — `fetchPartnerNegotiations()` failure was swallowed
       (`.catch(() => {})`), same as `partner.viewings.tsx`'s own list
       (a different feature's pre-existing convention, not a regression this
       feature introduced) — but the customer-side `negotiations.tsx`
       deliberately added an error/retry state back in Prompt 9 specifically
       per that prompt's own "error/retry states" requirement, so the two
       sibling surfaces had drifted apart. Added a matching error/retry
       `EmptyState` (new `partnerNegotiations.loadError`/`.retry` i18n keys),
       mirroring `negotiations.tsx`'s existing pattern exactly.
     - `property.$id.tsx`'s `MakeOfferModal`, submitted-confirmation state:
       the "View Negotiation" link was still a plain `<a href>` (Prompt 7 had
       explicitly left this as a documented, trivial follow-up, since
       `/negotiations/$id` didn't exist as a route file yet at that time) —
       now a typed `<Link to="/negotiations/$id">`, the route having existed
       since Prompt 8.
     - Everything else checked (both detail screens' plain-text/no-retry
       error states, both list screens' skeletons, every screen's RTL
       rendering) already matched this codebase's established, consistent
       conventions — see "RTL/manual verification" below for exactly what
       was checked and how.
  4. **Money typography / "one obvious next action" (brief §23/§27) — the
     Make an Offer flow's Review step was genuinely plain numbers with no
     visual hierarchy** (two unstyled `Row`/`ReviewRow` items, "Your offer"
     and "Listing price," no comparison), unlike the Negotiation Detail
     screen (already large `font-display` money + a below/above-listing
     delta line with an icon, since Prompt 8 — confirmed adequate, untouched).
     Upgraded the Review step's offer-vs-listing block on BOTH platforms to
     mirror the Detail screen's existing comparison-card treatment exactly
     (large bold money side-by-side + a colored below/above-listing delta
     line with a `TrendingDown`/`TrendingUp` icon, reusing the same
     `negotiationDetail.offerBlock.belowListing`/`.aboveListing` i18n keys —
     no new strings): `frontend/src/routes/property.$id.tsx`'s
     `MakeOfferModal` (web) and `mobile/app/negotiation/new.tsx` (mobile,
     removed the now-fully-unused `ReviewRow` helper it replaced).

  **Files changed:**
  - Backend: `backend/app/schemas/property_negotiation.py`,
    `backend/app/services/property_negotiation.py`,
    `backend/app/api/routes/negotiations.py`,
    `backend/app/api/routes/partner_negotiations.py` (all — see "APIs"
    above for the exact change).
  - Web: `frontend/src/lib/api/maskan.ts` (types),
    `frontend/src/lib/negotiationSignal.ts` (new),
    `frontend/src/lib/notificationDisplay.ts`,
    `frontend/src/routes/negotiations.$id.tsx`,
    `frontend/src/routes/negotiations.tsx`,
    `frontend/src/routes/partner.negotiations.tsx`,
    `frontend/src/routes/partner.negotiations.$id.tsx`,
    `frontend/src/routes/property.$id.tsx`,
    `frontend/src/lib/i18n/en.ts`/`ar.ts` (`partnerNegotiations.loadError`/
    `.retry` only — every other badge/link change reused existing keys).
  - Mobile: `mobile/src/lib/api/maskan.ts` (types),
    `mobile/src/lib/negotiationSignal.ts` (new),
    `mobile/src/lib/deepLink.ts`,
    `mobile/app/negotiations/[id].tsx`,
    `mobile/app/negotiations/index.tsx`,
    `mobile/app/negotiation/new.tsx`.

  **Verification:** `pytest backend/tests/test_negotiations.py
  backend/tests/test_partner_negotiations.py
  backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py
  -q`: 85 passed, no regression. `frontend/`: `npx tsc --noEmit` clean, `npx
  vite build` clean (all existing negotiation SSR chunks regenerated
  successfully; the only build output lines matching "error" are the
  pre-existing, unrelated "use client" directive-ignored warnings from
  third-party packages that appear on every build of this project, not new
  errors). `mobile/`: `npx tsc --noEmit` clean — required regenerating the
  stale `.expo/types/router.d.ts` first (same one-time fix Prompt 11 already
  documented needing; briefly ran `npx expo start --port 8099` on a scratch
  port, confirmed via `grep -c negotiations .expo/types/router.d.ts` that it
  picked up the route files, then let the harness's own timeout stop it —
  confirmed no lingering process via `netstat -ano | grep 8099` returning
  nothing afterward).

  **RTL/manual verification — same environment constraints as every prior
  frontend prompt in this feature (documented above): no browser automation
  tool and no Android/iOS emulator/simulator/device were available in this
  session.** Given that, verification was: (1) a full `grep` sweep of every
  negotiation-related route/screen file (web: `negotiations.tsx`,
  `negotiations.$id.tsx`, `negotiations.$id_.agreement.tsx`,
  `partner.negotiations.tsx`, `partner.negotiations.$id.tsx`,
  `transaction.$id.tsx`; mobile: `negotiations/index.tsx`,
  `negotiations/[id].tsx`, `negotiation/new.tsx`, `transaction/[id].tsx`) for
  hardcoded LTR-only classes (`ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/
  `text-left`/`text-right`) — zero matches; every screen already uses logical
  properties (`ms-`/`me-`/`ps-`/`pe-`/`gap-`) and flexbox/grid throughout,
  consistent with this codebase's established convention, and every back-
  arrow icon already carries `rtl:rotate-180` (web). (2) Confirmed mobile's
  RTL strategy is a single global `I18nManager.forceRTL()` toggle
  (`mobile/src/lib/i18n/context.tsx`), not a per-screen concern — React
  Native mirrors `flex-row` layouts automatically once that's set, so the new
  badge rows/comparison cards added in this prompt (plain `flex-row`/`gap-`,
  no manual left/right positioning) inherit correct RTL behavior for free,
  same as every other screen in the app. (3) Money amounts everywhere
  (including the two new comparison cards) go through the same
  `formatSAR()`/literal `"SAR "` prefix convention every other screen in this
  feature already uses — untouched, so Arabic rendering is exactly as correct
  or incorrect as the rest of the (already-shipped, already RTL-reviewed)
  feature. **What this does NOT prove**: no one visually loaded any of these
  screens in an actual Arabic-locale browser tab or a real RTL device/
  simulator this session — the same limitation every prior frontend prompt in
  this feature (7 through 11) explicitly documented and worked around the
  same way.

  **Test-data/process cleanup:** no scratch backend or frontend dev server
  was started this session (unlike Prompts 8-10, this prompt needed no live
  end-to-end HTTP verification — the backend change is purely additive/
  nullable and already covered by the existing pytest suite, and no new UI
  flow needed a real browser). The only process started was the one-shot
  `npx expo start --port 8099` above, confirmed stopped (port free) before
  finishing. No test rows were created in the dev database.
- **Prompt 13 (final validation) — no UI/screen code changed at all,
  validation-only.** `npx tsc --noEmit` (frontend, clean, zero errors) and
  `npx vite build` (frontend, clean — "built in 19.55s", no error lines
  besides the same pre-existing "use client" directive-ignored warnings from
  third-party packages every prior prompt's build already produced) were
  re-run against the current working tree exactly as it stood after Prompt
  12, confirming no drift. `npx tsc --noEmit` (mobile, clean, zero errors) —
  did **not** need the one-time `.expo/types/router.d.ts` regeneration
  Prompts 11/12 both needed, since that stale-types issue was already fixed
  as a side effect of Prompt 12's own verification run. No scratch dev
  server, emulator, or test DB rows were used for this check — a static
  type-check + production build against the existing (unchanged) UI code is
  the correct, sufficient bar for a prompt that touches zero frontend/mobile
  files.

## Tests

`backend/tests/test_negotiations.py` (Prompt 2, 17 tests): create succeeds
with a valid amount (first `NegotiationOffer` row created alongside,
denormalized fields present); rejects zero/negative amount (422); rejects a
duplicate active negotiation for the same customer+property (409); 404 on
unknown property; 403 reading another customer's negotiation (200 for the
owner, `offers` present in the detail response); 404 on an unknown
negotiation id; `GET .../negotiations/active` 404s when none exists and
returns it when one does; `GET /negotiations` list ordering (`updated_at`
desc); lead-linking attaches when a matching `LeadSuggestion` exists and
stays null otherwise; viewing-linking attaches only when the viewing is
genuinely `completed` and belongs to this customer+property (422 otherwise
— covers both "wrong status" and "wrong owner" cases);
`original_listing_amount` snapshots the property's price at creation time
and does NOT change when the listing price is edited afterward;
idempotency-key replay returns the same negotiation without creating a
duplicate (local `fake_redis` fixture copied into this file — fixtures
aren't shared across test files without a conftest.py entry, same reasoning
`test_viewings.py`'s comment gives for why its own idempotency coverage
lives in `test_redis_wired_endpoints.py` instead).

Prompt 2: `pytest backend/tests/test_negotiations.py -q`: 17 passed. Also
re-ran
`pytest backend/tests/test_viewings.py backend/tests/test_redis_wired_endpoints.py -q`
(22 passed) to confirm reusing `property_viewing._find_linked_lead_id()` and
the new router mount didn't regress the viewings feature.

**Prompt 3 additions (11 new tests)**: counter-again updates
`current_offer_amount` and supersedes the prior pending offer (asserts both
rows exist, old one `superseded`, new one `pending`); counter on another
customer's negotiation is 403; accept blocked when the latest offer was
placed by the same actor trying to accept it — covers both the customer's
own initial offer and the customer's own counter-offer as the "latest" row
(self-accept blocked, both cases 409); accept succeeds on the other party's
latest pending offer (a `mediator_counter` row fabricated at the ORM level,
since no mediator-side route exists yet — see the test file's
`_make_mediator_counter()` helper docstring for why); accept on another
customer's negotiation is 403; accepting/countering an already-`accepted`
negotiation is 409 (invalid-transition rejection); withdraw persists
`cancellation_reason`/`cancelled_by` and blocks all further transitions
(counter/accept/withdraw all 409 afterward); withdraw on another customer's
negotiation is 403; offer history remains intact (no rows deleted) after
multiple counter rounds spanning both `customer_counter` and
`mediator_counter` types — verified both via the detail endpoint's `offers`
list and a direct table count.

`pytest backend/tests/test_negotiations.py -q`: 28 passed (17 + 11 new).
Also re-ran `pytest backend/tests/test_viewings.py
backend/tests/test_redis_wired_endpoints.py -q` (22 passed, no regression)
and the full suite (`pytest -q`): 518 passed, 23 skipped, 2 failed. The 2
failures are in `test_outbox.py`
(`test_publisher_marks_event_published`/
`test_publisher_does_not_reprocess_already_published_events`) and are
**pre-existing, unrelated to this prompt** — they reproduce identically when
`test_outbox.py` is run alone, caused by leftover unpublished
`viewing.requested` outbox rows already present in the shared local
Postgres dev DB (this project's tests run against real Postgres, not an
isolated test DB — see `tests/conftest.py`'s docstring) from an earlier,
non-rolled-back session. Not touched or introduced by this prompt's
changes.

**Prompt 4 additions**: new file `backend/tests/test_partner_negotiations.py`
(16 tests), mirroring `test_partner_viewings.py`'s ownership-check structure
— negotiations are created through the real customer-side endpoint
(`_create_negotiation()`), not fabricated at the ORM level, since a real
mediator-side route now exists to counter/accept/reject them: counter from
`submitted` and from `countered` (mediator counters, customer counters back,
mediator counters again — status stays `countered`, `current_offer_amount`
updates each time); counter on a terminal (already-`rejected`) negotiation
is 409; counter rejects a non-positive amount (422); mediator accepts the
customer's initial offer; mediator is blocked (409) from accepting their own
counter (self-accept rule, mirrors the customer-side test); mediator accepts
after the customer counters back (the OTHER party's latest pending offer);
reject with a mediator reason from both `submitted` and `countered`, asserts
`status`/`cancellation_reason`/`cancelled_by="mediator"`/`rejected_at`; reject
on an already-`rejected` negotiation is 409; 403 on counter/accept/reject/get
when the mediator doesn't own the property (a second mediator's property);
404 for an unknown negotiation id; list scoped to the mediator's own
properties' negotiations only (a second mediator's negotiation never
appears); `status_filter` query param; PII exposure check
(`test_partner_negotiation_exposes_customer_contact_matching_lead_privacy_bar`
— asserts `customer_name`/`customer_phone`/`customer_email` are present and
correct on the partner detail response, AND that the customer-facing
`PropertyNegotiationOut`/`PropertyNegotiationDetailOut` schemas declare no
such fields at all); list-level cross-customer isolation check (two
different customers' negotiations on the same mediator's properties don't
mix up their `customer_name` in the list response).

`pytest backend/tests/test_partner_negotiations.py backend/tests/test_negotiations.py -q`:
44 passed (16 new + 28 from Prompts 2-3, no regression). Also re-ran `pytest
backend/tests/test_partner_viewings.py backend/tests/test_viewings.py
backend/tests/test_redis_wired_endpoints.py -q` (32 passed, no regression)
and the full suite (`pytest -q`): 534 passed, 23 skipped, 2 failed — the same
2 pre-existing `test_outbox.py` failures described above, still unrelated to
this prompt (534 = 518 + 16 new).

**Prompt 5 additions**: two new files.
`backend/tests/test_negotiation_signals.py` (14 tests) — every value in
`NEGOTIATION_SIGNALS` reachable for both the rent (`fair_range_low/high`)
and buy (`estimated_value_low/high`) `price_intelligence` variants, the
threshold-boundary cases spelled out in "AI behavior" above, `sufficient_
data=False` and `price_intelligence=None` both degrading to `limited_
comparable_data`, a case where `sufficient_data=True` but the fair-range
fields are still missing (must not silently invent a market-range signal),
and an explicit assertion that `negotiation_signals._EXCELLENT_VALUE_MAX`/
`_GOOD_VALUE_MAX` ARE `price_intelligence`'s own constants (`is`, not just
`==`) — proving the thresholds are imported, not a second hardcoded copy.
`backend/tests/test_negotiation_ai.py` (16 tests) — service-level tests
build `PropertyNegotiation`/`NegotiationOffer`/`RentPriceIntelligence`/
`NegotiationInsight` objects directly (no DB needed, mirrors
`test_property_intelligence_ai.py`'s style): AI grounding (mocked
`run_chat`, asserts the asking price/current offer/market range/offer
history amounts all reach the prompt, the question is wrapped in
`<customer_question>` tags, and no fabricated number leaks in); grounding
when market data is insufficient (facts state so explicitly, in text the
prompt can act on); AI failure (`RuntimeError`/`ValueError`) falls back to
deterministic guidance without raising, in both English and Arabic;
`generate_summary()` asserted to NEVER call `run_chat` at all (an
`AssertionError`-raising fake would fail the test if it were called) and to
be stable across two calls with identical inputs; a terminal-status summary
case; a no-market-insight summary case. A small HTTP-level section at the
bottom (5 tests) exercises the real route: `GET /negotiations/{id}` embeds a
non-empty `summary_text` without ever touching the AI gateway;
`POST /negotiations/{id}/ai-guidance` returns `{guidance, generated_by:
"ai"}` on a mocked successful call, `{generated_by: "fallback"}` when the
mocked call raises, 403 for another customer's negotiation, and 422 for an
unsupported `language` value.

`pytest backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py -q`:
30 passed. Also re-ran `pytest backend/tests/test_negotiations.py
backend/tests/test_partner_negotiations.py -q` (44 passed, no regression —
confirms the `to_negotiation_detail_out()`/`PropertyNegotiationDetailOut`
changes didn't break the existing detail-response shape) and the full suite
(`pytest -q`): 564 passed, 23 skipped, 2 failed — the same 2 pre-existing,
unrelated `test_outbox.py` failures described above (564 = 534 + 30 new).

**Prompt 6 additions (11 new tests, final backend prompt):**
`backend/tests/test_negotiation_ai.py` gained a "Message drafting" section
(4 tests) — a fresh negotiation's draft references the real submitted offer
amount and doesn't fabricate a mediator counter that doesn't exist; a
mid-negotiation draft (mediator has countered) is grounded in the actual
counter amount + the customer's own earlier real offer, marked explicitly
as a reply; the deterministic grounded fallback proposes only the
transparent midpoint of two real offer-history amounts (never invents a
number); and the pre-existing no-negotiation call path is confirmed
unchanged when `negotiation`/`offer_history` are omitted.
`backend/tests/test_negotiations.py` gained two new sections (7 tests):
"Agreement Summary" (`agreement_summary` is `null` before/during an offer
exchange, correctly populated with all fields — including
`final_agreed_amount` reading the ACCEPTED offer's amount, not the
negotiation's snapshot amount — once accepted via the real accept flow, and
a unit-level `build_agreement_summary()` None-check with no DB) and
"Notification content" (direct `negotiation_notifications._render()` calls
assert the rendered title/body strings match brief §19's exact example copy
for `negotiation_offer_submitted` and both directions of
`negotiation_counter_received`, in English and Arabic, plus a documentation
check that the deep-link shape matches `viewing_notifications.py`'s
convention).

Also re-verified `backend/tests/test_property_intelligence_ai.py` (9
passed, unchanged) — confirms extending
`summarize_property_intelligence()`'s signature with the new optional
`negotiation`/`offer_history` keyword args didn't regress the pre-existing
no-negotiation "negotiation_message" variant tests from the Property
Intelligence feature's own Prompt 9.

`pytest backend/tests/test_negotiations.py backend/tests/test_partner_negotiations.py
backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py -q`:
85 passed (74 + 11 new). Full suite (`pytest -q`): 575 passed, 23 skipped, 2
failed — the same 2 pre-existing, unrelated `test_outbox.py` failures
described above (575 = 564 + 11 new); the previously-noted
`test_list_properties_date_range_filter_excludes_conflicting_booking`
failure did not reproduce in this run.

**This completes the entire backend surface for the AI Negotiation & Offer
Management feature.** Prompts 7-13 (frontend/mobile) remain.

**Prompt 13 (final validation sweep, 1 new gap test) — every §25 validation
rule re-verified against the actual current code + test files (not assumed
from this doc's prose), each traced to its enforcing function and its
covering test:**

| # | Rule | Enforced in | Covered by |
|---|---|---|---|
| 1 | Property must be `Published` to negotiate | `create_negotiation()` | `test_create_negotiation_404_on_unknown_property` (covers the unknown-id case; the "exists but not Published" case has no dedicated test, matching the exact same pre-existing gap in the sibling `property_viewing.py`/`test_viewings.py` — a pre-existing codebase convention, not something this prompt introduced or was asked to fix) |
| 2 | Customer ownership (403 on another customer's negotiation) | `negotiations.py`'s `_get_own_negotiation` | `test_get_negotiation_403_for_another_customer`, `test_counter_on_another_customers_negotiation_is_403`, `test_accept_on_another_customers_negotiation_is_403`, `test_withdraw_on_another_customers_negotiation_is_403` |
| 3 | Mediator authorization — direct `negotiation.mediator_id == mediator.id` DB check, never a client-supplied id | `partner_negotiations.py`'s `_load_owned_negotiation` | `test_403_when_mediator_does_not_own_property` |
| 4 | Transaction type derived server-side, never client-supplied | `PropertyNegotiationCreate` has no `transaction_type` field at all; `create_negotiation()` sets it from `prop.listing_type` | Structurally guaranteed (no field to override) — implicit in every create test |
| 5 | Offer amount `> 0` on both create and counter | `create_negotiation()` / `submit_counter()` (shared by customer + mediator counter routes) | `test_create_negotiation_rejects_zero_amount`, `test_create_negotiation_rejects_negative_amount`, `test_partner_negotiations.py::test_counter_rejects_non_positive_amount` |
| 6 | Only valid status transitions allowed (409 otherwise) | `_transition()` against `PROPERTY_NEGOTIATION_TRANSITIONS` | `test_accept_already_accepted_negotiation_is_409`, `test_counter_on_accepted_negotiation_is_409`, `test_partner_negotiations.py::test_counter_on_terminal_negotiation_is_409`, `test_reject_already_rejected_negotiation_is_409` |
| 7 | Only the latest offer, by the OTHER party, can be accepted (self-accept blocked) | `accept_offer()` | `test_accept_blocked_when_latest_offer_placed_by_same_actor`, `test_accept_blocked_after_customer_counters_their_own_counter`, `test_partner_negotiations.py::test_mediator_cannot_accept_own_counter` |
| 8 | No duplicate active negotiation per customer/property | `create_negotiation()`'s active-negotiation query | `test_create_negotiation_rejects_duplicate_active_negotiation` |
| 9 | Accepted negotiation cannot receive further counters | `_transition()` (`accepted` has no `countered` entry) | `test_counter_on_accepted_negotiation_is_409` |
| 10 | Terminal (`rejected`/`withdrawn`/`closed`) negotiation is fully immutable | `_transition()` (no entries for any terminal status) | `test_withdraw_persists_reason_and_blocks_further_transitions`, `test_reject_already_rejected_negotiation_is_409` |
| 11 | Customer token rejected on mediator-only routes, and vice versa | `deps.py`'s `get_mediator_user` (requires an owned `Mediator` row) vs. `get_current_user` — structurally different dependencies | **Was untested — genuine gap, closed this prompt**: new `test_partner_negotiations.py::test_customer_token_rejected_on_partner_only_routes` asserts a plain customer (no `Mediator` row) gets 403 on all five partner routes (list/detail/counter/accept/reject) |
| 12 | Mediator cannot manage/see another mediator's negotiations (list-level, not just detail) | `list_partner_negotiations()` filters `mediator_id == mediator.id` | `test_list_scoped_to_own_properties_negotiations` |

Only rule 11 had a genuine test-coverage gap (the *behavior* was already
correctly enforced by `get_mediator_user`'s structural dependency — a
customer has no `Mediator` row to look up — but nothing had ever asserted
this against a real customer token before). One focused test added,
`backend/tests/test_partner_negotiations.py::test_customer_token_rejected_on_partner_only_routes`
(17 tests in that file now, up from 16).

**§26 privacy sweep (grep/read, not assumed):** confirmed clean.
`PropertyNegotiationOut`/`PropertyNegotiationDetailOut` (customer-facing)
declare zero `customer_name`/`customer_phone`/`customer_email` fields — those
exist only on the mediator-facing `PartnerNegotiationOut`/
`PartnerNegotiationDetailOut`, gated by `_load_owned_negotiation`'s ownership
check. `viewing_id`/`lead_id` are plain `int | None` — no nested
`PropertyViewing`/`Lead` object (and therefore no `customer_note`/private
viewing fields) is ever serialized onto a negotiation response. Every
negotiation's `offers` list is scoped by its own `negotiation_id` FK, so one
customer's offer history can never mix in another customer's offers on the
same property. `negotiation_ai.py`/`negotiation_signals.py` ground
themselves only in the current negotiation's own offer amounts + Price
Intelligence numbers — no other feature's AI conversation content is
referenced anywhere in either file.
`list_partner_negotiations`/`list_my_negotiations` both filter at the query
level by the requester's own id, confirmed by the pre-existing
`test_partner_negotiation_list_does_not_leak_other_customers` and
`test_list_scoped_to_own_properties_negotiations`.

Full suite after the gap test:
`pytest backend/tests/test_negotiations.py backend/tests/test_partner_negotiations.py
backend/tests/test_negotiation_signals.py backend/tests/test_negotiation_ai.py -q`:
86 passed (85 + 1 new), no regression. `pytest -q` (full backend suite):
**578 passed, 23 skipped, 0 failed.** The 2 previously-known pre-existing
`test_outbox.py` failures are now also gone — this prompt located and
deleted the 14 specific leftover unpublished `outbox_events` rows actually
causing them (7× `negotiation.offer_submitted`, 2× `negotiation.withdrawn`,
1× `negotiation.counter_received`, 1× `negotiation.accepted`, 2×
`viewing.requested`, 1× `property.created` — their `aggregate_id`s and
timestamps line up exactly with Prompts 9/10's own documented scratch
verification ids from `2026-08-17`/`2026-08-18`, confirming they were inert
leftovers from those sessions' manual HTTP verification, not evidence of a
real bug), verified via a direct read-only query first, then a scoped
`DELETE ... WHERE id = ANY(:ids) AND published_at IS NULL` against only
those 14 ids (re-confirmed 0 unpublished rows remained afterward). This was
optional cleanup per this prompt's own instructions, not a code fix — the
`test_outbox.py` test file itself was not touched.
`test_list_properties_date_range_filter_excludes_conflicting_booking`
(the other previously-known intermittent failure) did not reproduce either.

## Known limitations

- `NegotiationOffer.expires_at` is a real column but **nothing enforces
  it** — no background job/cron marks an expired offer `superseded` or
  moves a negotiation to a terminal status on expiry. Present per the
  brief's "if used" instruction, deliberately left inert for this
  feature-first, investor-demo build (per the explicit "don't build an
  expiry cron" instruction in this prompt).
- No `draft`/`expired` negotiation status exists (see "Status flow" /
  "Models" above) — an in-progress "Enter Amount -> Review" flow is entirely
  frontend state until the customer actually submits, and expiry isn't
  modeled at all yet.
- Explicitly out of scope for the whole feature (per the original brief,
  reiterated here since this doc is the single source of truth for the
  feature's boundaries): payments, reservation payment, Ejar, Nafath,
  contract generation, legal signing, financing, mortgage, escrow, new
  Redis/queue/microservice infra, external integrations, a second
  messaging/chat platform (this feature is expected to reuse `LeadMessage`
  for any free-form conversation a later prompt adds, not build a new one).
- **Resolved in Prompt 4:** partner-side endpoints now exist — a mediator can
  counter/accept/reject a negotiation via `backend/app/api/routes/
  partner_negotiations.py`. The entire backend transition surface (create,
  counter-again/counter, accept, withdraw/reject) is done as of this prompt;
  only AI guidance and frontend/mobile remain.
- No dedicated `withdrawn_at` timestamp column exists on `PropertyNegotiation`
  (only `accepted_at`/`rejected_at`/`closed_at`) — a withdrawal's timing is
  inferred from `updated_at` only. Mediator rejection, by contrast, DOES set
  `rejected_at` (Prompt 4) since that column already existed.
- **(Prompt 5)** `negotiation_ai.generate_guidance()`'s AI reply is trusted
  as free-form text once returned — same trust level `home_finder_ai.
  explain_match`/`property_intelligence_ai.summarize_property_intelligence`
  already operate at (see their own "Known limitation" notes). There is no
  numeric-hallucination validator checking the model's reply against the
  facts it was given; the prompt instructs it not to invent numbers, but
  nothing downstream enforces that. Adding one would be new infra beyond
  this prompt's scope.
- **(Prompt 13, explicitly called out per this prompt's own instruction)**
  `NegotiationOffer.expires_at` is a real column with **no enforcement job**
  — restated here as its own bullet even though it's already covered above,
  since the brief specifically asked for it to be explicit: no cron/
  background job ever marks an offer expired, supersedes it, or moves a
  negotiation to a terminal status on expiry. Nothing reads this column at
  all today outside of being set to `null` on every offer row.
- **(Prompt 13)** "Continue Transaction" (`/transaction/{id}` web,
  `mobile/app/transaction/[id].tsx` mobile, reached only after a negotiation
  is `accepted`) is a **placeholder page only** — a static "Coming soon"
  empty state with a link back to the negotiation. It carries zero payment,
  contract, Ejar, or Nafath logic, and there is no code anywhere in this
  feature that begins to implement any of those — this was an explicit,
  brief-sanctioned stand-in from Prompt 9, not an oversight.
- **(Prompt 13)** No fixed limit on the number of counter-rounds a
  negotiation can go through — a negotiation can bounce between `countered`
  states indefinitely (each round simply supersedes the previous `pending`
  offer row) until one side accepts, rejects, or withdraws. This matches the
  brief's own instruction not to add an artificial round cap, restated here
  explicitly per this prompt's task.
- **(Prompt 13)** No expiry/TTL on a negotiation itself either — a
  `submitted`/`countered` negotiation can sit indefinitely with no automatic
  timeout, same "no cron" reasoning as `expires_at` above.
- **(Prompt 13)** The two seed partner accounts referenced in "Investor demo
  instructions" below (`ahmed.partner@maskan.sa` / `sara.partner@maskan.sa`)
  have no real, known password — `backend/seed_partners_leads.py` creates
  them with a placeholder hash copied from an arbitrary existing user row.
  Not a negotiation-feature bug (pre-existing seed-script behavior, outside
  this feature's own scope), but worth knowing before relying on those
  accounts for a live demo — see the demo instructions' own note on this.
- **(Prompt 13)** Deep-links are hardcoded to the mediator/partner path
  (`mymakan://partner/negotiations/{id}`) for every notification recipient
  regardless of role — the frontend resolvers (Prompt 12) branch on the
  viewer's own `scope` to route a customer to `/negotiations/{id}` instead of
  `/partner/negotiations/{id}`, but the raw payload itself never encodes
  which URL a given recipient should actually land on; this is
  pre-existing, documented behavior inherited from `viewing_notifications.py`
  (not a new negotiation-specific limitation), restated here since it's the
  kind of thing an investor demo could stumble on if a customer's push
  notification is tapped from a device that also happens to be signed in as
  a mediator.

## Investor demo instructions

**Everything below is demoable end-to-end** as of Prompt 12 (web customer +
partner + mobile customer, notification deep-links all working); this
section (Prompt 13) writes out the full brief §27 storyline for BOTH Rent and
Buy, referencing real ids confirmed against the live local Postgres dev DB
during this prompt (query run directly, read-only, no rows changed).

### Prerequisites

- All backing feature flags default to `True` in `backend/app/core/config.py`
  and none are overridden in `backend/.env` — no flag toggling is needed
  before the demo: `FEATURE_AI_HOME_FINDER`, `FEATURE_PROPERTY_INTELLIGENCE`,
  `FEATURE_VISIT_MANAGEMENT` (gates the viewings routes), `FEATURE_NEGOTIATIONS`.
  Trust Center has no dedicated flag at all (always on).
- Dev DB is the shared local Postgres instance every prior prompt in this
  feature used (`backend/.env`'s `DATABASE_URL`, database `maskan`) — start
  the backend normally (`uvicorn app.main:app` from `backend/`, matching
  every other prompt's own local-dev instructions) and the web frontend
  (`npm run dev` from `frontend/`) or mobile (`npx expo start` from
  `mobile/`) against it.

### Real ids confirmed in the dev DB (Prompt 13, read-only query)

| Role | Rent walkthrough | Buy walkthrough |
|---|---|---|
| Property | `id=1` — "5-Bed Super-Lux Villa – Al Yasmin Compound", area **Al Yasmin**, `monthly_rent` SAR 17,500, `status="Published"`, `listing_type="rent"` | `id=108` — "Apartment for Sale – Al Andalus", area **Al Andalus**, `sale_price` SAR 350,000, `status="Published"`, `listing_type="sale"` |
| Mediator | `mediator_id=1`, agency **Yasmin Real Estate**, `user_id=3`, email `ahmed.partner@maskan.sa`, `subscription_status="active"` | `mediator_id=2`, agency **Olaya Property Partners**, `user_id=4`, email `sara.partner@maskan.sa`, `subscription_status="active"` |
| Customer (optional, see note) | `user_id=2`, `mnaushad@maskanai.com` | any signed-up customer — no existing lead match on Al Andalus |

Notes on this data, checked directly rather than assumed:

- Both seed mediator accounts (`ahmed.partner@maskan.sa` /
  `sara.partner@maskan.sa`) come from `backend/seed_partners_leads.py`, which
  creates them with a **placeholder password hash copied from an arbitrary
  existing user row** (`PLACEHOLDER_HASH = db.scalars(select(User.hashed_password).limit(1)).first()`)
  — i.e. there is no real, known password for these two accounts. Before
  running the partner-side steps live, either (a) reset one via a direct
  `UPDATE users SET hashed_password = '<hash>' WHERE id = 3;` using the app's
  own password-hashing function, or an admin tool if one exists, or (b) sign
  up a brand-new mediator account and substitute one of that mediator's own
  Published listings for the demo property instead — the flow is identical
  either way, only the partner login step differs. This was not fixed as
  part of this prompt since resetting a shared dev-DB account's password is
  outside "final validation/docs" scope and would affect other developers'
  sessions.
- The `property_negotiations` table is currently empty and neither demo
  property has a `completed` `PropertyViewing` yet — the Viewing → Completed
  Viewing steps below produce real data when actually run through (customer
  schedules, mediator confirms, mediator marks complete); they are not
  pre-seeded, so a fresh demo run mints its own negotiation/viewing ids.
- Lead-linking bonus for the Rent walkthrough: customer `user_id=2`
  already has `Lead id=1` (area "Al Yasmin") with an existing
  `LeadSuggestion` match to property `1` (`match_score=88`) — if that
  customer account is used, the resulting negotiation auto-links `lead_id`
  (see "Lead integration" above), so the demo can also show the **Message
  Mediator** action, which is otherwise hidden. The Buy walkthrough
  deliberately has no lead match on Al Andalus, which is a fine contrast to
  show too — **Message Mediator** correctly stays hidden when no lead is
  linked, per the "no lead thread to link to" decision documented above,
  rather than pointing at nothing.

### Web — full storyline, Rent (property `1`)

1. **AI Home Finder** (`/home-finder`) — customer answers the guided
   preference flow; this is the "AI discovery" leg of the story and is never
   a required precondition for negotiating (a customer can open a
   negotiation on any property without having gone through Home Finder
   first) — demo it, then separately navigate to `/property/1` for the rest
   of the walkthrough (Home Finder isn't guaranteed to surface this exact
   property).
2. **Property Intelligence** (`/property/1`) — the Price Intelligence card
   (fair-range/market-position badge for the rent price) and
   `NegotiationInsightCard` (asking price / market midpoint / discussion
   range, "Draft message" action) both render on the same page.
3. **Trust** — `PropertyTrustSection` renders further down the same page:
   mediator trust score and listing verification badges (from the
   already-shipped Trust Center feature, reused unchanged — see "Existing
   functionality reused" if this doc's Trust Center companion doc is needed
   for more detail).
4. **Viewing** — click **Schedule Viewing** (`ScheduleViewingModal`), pick a
   slot, submit. Sign in as the mediator (`ahmed.partner@maskan.sa`) → Partner
   Portal → **Viewing Requests** (`/partner/viewings`) → **Confirm**, then
   → **Mark as Complete** (`POST /partner/viewings/{id}/complete`).
5. **Completed Viewing** — customer revisits `/viewings/{id}` — now shows
   `"Completed"`, and the **Make an offer** button (retargeted in Prompt 7
   from the old "Ask AI about negotiation" hook) pre-fills the Make an Offer
   flow with this `viewing_id` via the `sessionStorage` handoff documented in
   "Screens changed" above.
6. **Make an Offer** — the 4-step modal: **Offer Intelligence** (reuses the
   already-fetched `NegotiationInsightCard` data, shows the "Limited market
   data" fallback copy if `sufficient_data` is false) → **Enter Amount** →
   optional **Message** with **Draft with AI** (editable, never
   auto-sent) → **Review** (large money typography, below-listing delta
   line) → **Submit** (`POST /properties/1/negotiations`).
7. Submitting lands on an inline confirmation linking straight into the new
   negotiation at `/negotiations/{id}`.
8. **Offer Intelligence recap + Ask AI** on Negotiation Detail — offer-vs-
   listing comparison, the real negotiation-strength badge
   (`negotiation_signal`), the deterministic myMakan Summary, and the
   offer-history timeline. Demo **Ask myMakan** (free-text question, AI
   reply with the standing disclaimer, plus the extra low-confidence warning
   if the signal is `limited_comparable_data`).
9. **Partner Portal — new offer** — still signed in as the mediator, open
   **Offers & Negotiations** (`/partner/negotiations`). The new offer appears
   under the **New Offers** tab with the customer's name, listing price vs.
   current offer, and submitted-time. Click **Open** for the full detail
   (`/partner/negotiations/{id}`) — Property/Customer/Offer blocks plus the
   **Market Context** card (reuses `GET /properties/1/intelligence`).
10. **Counter** — mediator submits **Counter Offer** (amount + optional
    message) — the negotiation moves to the **Countered** tab.
11. **Customer Ask myMakan** — back as the customer on Negotiation Detail
    (reload to pick up the mediator's counter), Ask myMakan again — now
    grounded in the counter, per "AI behavior" above.
12. **Counter again** — customer submits **Counter Again** (amount +
    optional **Draft with AI** message, grounded in the real offer history —
    e.g. "Following your counter of SAR X, I'd like to propose SAR Y").
13. **Partner Accept** — mediator opens the negotiation again and clicks
    **Accept** (only offered when the latest offer is the customer's own,
    matching the backend's self-accept-blocked rule) — or **Accept** directly
    from the list's one-click action if the negotiation is still in
    `submitted`.
14. **Offer Agreed** — customer's Negotiation Detail now shows the **Offer
    Agreed** state: agreed amount in large type, the disclaimer sentence
    verbatim ("This records the commercial agreement in myMakan. It is not
    the legal rental/purchase contract."), and three actions — **View
    Agreement Summary**, **Message Mediator** (shown here because
    `lead_id` is linked via customer `user_id=2`'s existing `Lead`/
    `LeadSuggestion` match, see the table above), and **Continue
    Transaction**.
15. **Agreement Summary** (`/negotiations/{id}/agreement`) — property,
    customer, mediator, transaction type, original listing amount, final
    agreed amount, agreed-on date, and a `NEG-000NNN`-style reference, plus
    the same disclaimer sentence again (shared i18n key, so wording can
    never drift between the two screens).
16. **Continue Transaction** — the placeholder "Coming soon" page, closing
    the storyline honestly (no real contract/payment flow exists anywhere in
    this feature — see "Known limitations").
17. **My Negotiations** (`/negotiations`, top nav / account dropdown) — the
    same negotiation now shows under the **Accepted** tab; switching to
    **Active**/**Closed** demonstrates the other two buckets (submit a
    second offer and withdraw it to show **Closed**).

### Web — Buy (property `108`) — condensed, same steps with these deltas

Same 17 steps, applied to `/property/108` and mediator
`sara.partner@maskan.sa`, with:

- Step 2/9's Property/Market Context intelligence reads
  `estimated_value_low/high` (buy) instead of `fair_range_low/high` (rent).
- Every money figure is the one-time `sale_price` (SAR 350,000), not a
  monthly rent — `transaction_type: "sale"` on the resulting negotiation.
- Step 14's **Message Mediator** action stays **hidden** — no `Lead`/
  `LeadSuggestion` match exists on Al Andalus in the current dev DB, so
  `lead_id` stays `null`. This is a useful contrast to show deliberately: the
  UI correctly omits the action rather than linking to a non-existent
  thread, per the documented "Lead integration" decision.

### Mobile — same storyline, different screens (customer side only; partner portal is web-only)

Screens map 1:1 to the web steps above:
`mobile/app/home-finder.tsx` → `mobile/app/property/[id].tsx` (Price
Intelligence + `PropertyTrustBadge`/`ListingVerificationBlock` +
`NegotiationInsightCard`, same page) → **Schedule Viewing**
(`mobile/app/viewing/new.tsx`) → `mobile/app/viewings/index.tsx`/`[id].tsx`
(Completed Viewing, retargeted "Make an offer" hook) →
`mobile/app/negotiation/new.tsx` (4-step Make an Offer) →
`mobile/app/negotiations/index.tsx`/`[id].tsx` (Negotiation Detail, Ask
myMakan, Counter Again/Withdraw sheets, and — inline on the SAME detail
screen rather than a separate route, see "Screens changed" — the Offer
Agreed state + full Agreement Summary once accepted) →
`mobile/app/transaction/[id].tsx` (placeholder). The partner-side steps
(mediator confirms/completes the viewing, counters, accepts) have no mobile
screens at all and must be run on web regardless of which platform the
customer side is being demoed on — confirmed by grepping `mobile/app/` for
any `partner/` screen: none exist outside `agent/[id].tsx`/`lead/*`.

### What was and wasn't re-verified live in this prompt

Prompt 13 confirmed the ids/data above via a direct, read-only query against
the dev DB (no rows created or changed) and confirmed `npx tsc --noEmit`
(web + mobile) and `npx vite build` (web) are clean against the current
working tree — it did **not** re-run the full manual HTTP walkthrough
end-to-end again (Prompts 9 and 10 already did that once each, with their
own scratch ids, all cleaned up afterward — see those prompts' "Screens
changed" entries above for exactly what was driven and confirmed against a
live backend at the time). The backend `pytest` suite (see "Tests" below)
is the mechanism keeping every rule this storyline depends on
(self-accept-blocked, transition validity, ownership, lead-linking,
agreement-summary population, etc.) continuously verified without needing a
fresh manual walkthrough every prompt.
