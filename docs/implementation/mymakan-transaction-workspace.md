# myMakan Rental/Buy Transaction Workspace — Implementation Tracking

Companion doc to `docs/implementation/mymakan-transaction-workspace-prompts.md`. Created
by Prompt 1 (Inspection map). Each later prompt reads this doc first, fills in its own
section(s), and leaves everything else untouched unless it discovers the existing
content is wrong.

No root `CLAUDE.md` exists in this repo (only `mobile/CLAUDE.md`, which is Expo module
boilerplate, not project docs) — Prompt 1 read the five sibling implementation docs
listed below instead, per the prompts file's own reading list.

## Scope summary

Build a `PropertyTransaction` workspace that a customer (and the assigned mediator)
lands on once a `PropertyNegotiation` is `accepted` — the step between "offer agreed"
and an eventual (out-of-scope) Ejar/contract/payment process. Phase 1 (Rent + Buy)
only, investor-demo grade. Absolutely NOT in scope: Ejar, Nafath, government
verification APIs, title deed integration, digital signatures, legal contract
execution, payment gateway, reservation payment, escrow, mortgage, financing, new
Redis/queue/microservice architecture. This plan reuses, rather than recreates:
accepted `PropertyNegotiation`, `Property`, Property Intelligence, Trust Center,
`PropertyViewing`, Leads/chat, mediator/customer profiles, notifications, the AI
gateway, auth, the audit-log pattern, i18n, and the web/mobile parity rules already
established by the four features this depends on (Negotiations, Viewings, Property
Intelligence, Trust Center).

Statuses are plain string columns with an explicit Python transitions dict — no DB
enum type, no state-machine library — mirroring `PROPERTY_NEGOTIATION_TRANSITIONS` /
`PROPERTY_VIEWING_TRANSITIONS` exactly (both confirmed below). Progress %, checklist
state, Next Best Action, and readiness are 100% deterministic, computed by one
centralized backend module — never LLM-calculated, never recomputed independently in
web/mobile. AI may only *explain* an already-computed state, grounded strictly in
transaction/checklist/document/property/negotiation/trust data it is given.

Wording rules (exact, non-negotiable): final ready state is **"Ready for Rental
Contract Process"** (rent) or **"Ready for Sale Process"** (buy) — never "Transaction
complete", "Ownership transferred", or "Ejar completed". The mutual-confirmation step
is labeled **"Information Confirmation"**, never "Sign Contract". Trust wording stays
within the Trust Center's existing "✓ Verified by myMakan" rule — no new verification
claims are introduced here. Agreed amount is immutable through normal transaction
editing — any change requires a new negotiation/amendment, never a direct field edit.

Customer web and mobile must reach equivalent business outcomes for every capability
in this feature — no finishing with a web-only or mobile-only gap (tracked in
`docs/implementation/mymakan-customer-parity.md`, updated at the end by Prompt 14).

## Domain model this plan will build

### `PropertyTransaction` — built by Prompt 2

`backend/app/models/property_transaction.py`. id, reference (human-readable,
**persisted** column, e.g. `MYM-00042` — assigned right after insert via
`f"MYM-{transaction.id:05d}"`, deterministic since it's derived from the row's own
primary key, never random), property_id, transaction_type (`rent`/`sale`, copied from
`PropertyNegotiation.transaction_type`), customer_user_id, mediator_id, lead_id,
negotiation_id (**unique** — this is what prevents duplicates, enforced even under a
race by a DB unique constraint, not just an application check), viewing_id (nullable,
copied verbatim from the negotiation's own already-validated `viewing_id`),
agreed_amount (snapshotted from `negotiation.current_offer_amount`, immutable
thereafter), currency (always `"SAR"` — `DEFAULT_CURRENCY` constant, no multi-currency
support anywhere in this codebase), status, progress_percentage (starts at `0`),
`customer_info_confirmed_at` (nullable timestamp — see "Customer info snapshot"
below), timestamps (created_at/updated_at/ready_at/completed_at/cancelled_at),
cancellation_reason. No `cancelled_by` column (unlike `PropertyNegotiation`/
`PropertyViewing`) — the brief's own Prompt 2 field list omits it; a later prompt can
add it if the cancel action (Prompt 4/5) turns out to need it.

Auto-created (exactly one row, enforced by the unique constraint on `negotiation_id`)
**inline inside `accept_offer()`** (`app/services/property_negotiation.py`, right after
`negotiation.accepted_at` is set and `db.flush()`ed, before `record_event(...)` and the
transaction's own `db.commit()`) via
`app/services/property_transaction.py::create_transaction_for_negotiation()` — chosen
over an async outbox handler specifically so "negotiation accepted" and "transaction
exists" are atomic (both land or neither does); a losing request in a concurrent-accept
race gets an `IntegrityError` on the unique constraint and its whole transaction (incl.
the negotiation's status flip) rolls back. No new `EventType`/outbox event is emitted
for transaction creation itself — that's Prompt 6's job.

#### Customer info snapshot

The transaction's future "My Information" checklist step reuses `User.email`/
`full_name`/`phone` verbatim (`property_transaction.customer_info_snapshot()`) — no new
DB columns for the content itself, since User already carries everything a
demo-grade rent/buy KYC step needs. The one field that genuinely couldn't be reused is
`customer_info_confirmed_at` on `PropertyTransaction` itself: confirmation is inherently
per-transaction (a customer confirms once per transaction, not once ever), so it can't
live on `User`. Prompt 2 only adds the column; the actual `POST
.../confirm-information` action that sets it is Prompt 4's job.

### `TransactionDocument` — built by Prompt 2

`backend/app/models/property_transaction.py` (same file as `PropertyTransaction`,
matching how `property_negotiation.py` splits its own parent+child). id,
transaction_id, document_type (stable machine key, e.g. `"national_id"`), label
(display string), required (bool), status
(`not_uploaded`/`uploaded`/`accepted`/`needs_update`), file_reference (nullable —
populated by Prompt 4's upload endpoint; this prompt only defines the column),
uploaded_at, reviewed_at, review_note, created_at, updated_at. **No separate "review
status" column** — `status`'s own `accepted`/`needs_update` values already ARE the
review outcome; a duplicate column would just be two names for the same fact.

Seeded from `DOCUMENT_TEMPLATES` (a plain `{transaction_type: [...]}` dict, not a DB
table — mirrors this codebase's "Python-only config over new architecture" convention)
when the transaction is created. **No brief document-list examples were found
committed anywhere in this repo** (Prompt 1's inspection searched thoroughly for
"brief §" document examples and found none) — Prompt 2 chose deliberately conservative,
generic KYC-style documents only (identity + ability-to-pay), consistent with the
"Absolutely NOT in scope" list (no Ejar-specific paperwork, no
Nafath/government-verification claims, no financing/mortgage documents, no legal
contract text):

- **Rent**: National ID / Iqama Copy (required), Proof of Income — Salary Certificate
  or Bank Statement (required), Additional Supporting Document (optional).
- **Sale**: National ID / Iqama Copy (required), Proof of Funds — Bank Statement
  (required), Additional Supporting Document (optional).

Kept identical in shape (2 required + 1 optional) between rent and sale so Prompt 3's
checklist fraction math (e.g. documents "2/3") works the same for both transaction
types. A later prompt is free to replace/extend `DOCUMENT_TEMPLATES` if a more specific
brief surfaces — nothing else references the template contents by value.

### Checklist / progress design

A single centralized, pure/deterministic backend module (not yet built — Prompt 3's
scope) computes, given a `PropertyTransaction` + its documents + confirmation flags:

- Checklist state per step (rent: offer agreed / customer info / documents submitted /
  mediator review / terms reconfirmed / ready-for-contract-process; buy: same shape
  ending in ready-for-sale-process), each step done / in-progress (e.g. documents
  "2/3") / pending.
- `progress_percentage` (0-100, deterministic weighting — formula documented once
  Prompt 3 writes it).
- Next Best Action — a single deterministic priority pick, never AI-chosen.
- Readiness label — Not Ready / Almost Ready / Ready for Next Step, using the exact
  rent/buy final-state strings above.

This module becomes the single source of truth every API layer (customer, partner,
admin) calls — never recomputed ad hoc elsewhere, never in frontend/mobile.

## Inspection notes

### 1. Accepted-negotiation flow end-to-end

`backend/app/models/property_negotiation.py` — `PropertyNegotiation` is a single flat
row (mirrors `PropertyViewing`'s convention) with a plain `status: String(30)` column
(default `"submitted"`) and an explicit transitions dict:

```python
PROPERTY_NEGOTIATION_TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"countered", "accepted", "rejected", "withdrawn"},
    "countered": {"countered", "accepted", "rejected", "withdrawn"},
    "accepted": {"closed"},
    # terminal: rejected, withdrawn, closed
}
```

`status` becomes `"accepted"` inside `app/services/property_negotiation.py::accept_offer()`
(services/property_negotiation.py:232-275), called from two route-layer entry points —
customer-side `POST /negotiations/{id}/accept` (`api/routes/negotiations.py:215-228`)
and mediator-side `POST /partner/negotiations/{id}/accept`
(`api/routes/partner_negotiations.py`, same underlying function with
`actor_role="mediator"`). `accept_offer()`'s sequence, all in one transaction: validate
the latest `NegotiationOffer` is `pending` and wasn't placed by the accepting actor
(self-accept blocked) → `_transition(negotiation, "accepted")` → mark that offer
`status = "accepted"` → set `negotiation.accepted_at` → `db.flush()` →
`record_event(db, event_type=EventType.NEGOTIATION_ACCEPTED, aggregate_type=
"property_negotiation", aggregate_id=negotiation.id, payload={...})` → `db.commit()`.

**This `record_event(..., NEGOTIATION_ACCEPTED, ...)` call site (services/
property_negotiation.py:258-272), immediately before its `db.commit()`, is where
Prompt 2's auto-creation hook attaches** — either inline right after (same
transaction, so the `PropertyTransaction` row and the negotiation's `accepted` status
land together or not at all), or via a new outbox handler keyed on
`EventType.NEGOTIATION_ACCEPTED` (mirrors `negotiation_notifications.py`'s handler
registration — see bullet 5 below). Prompt 2 should pick whichever matches how tightly
"exactly one transaction, no race" needs to be guaranteed; the unique constraint on
`PropertyTransaction.negotiation_id` is the actual duplicate-prevention backstop either
way.

**Data available on an accepted `PropertyNegotiation` row** (all confirmed fields on
the model, `models/property_negotiation.py:77-148`):

- `property_id` → `property` relationship (title, images, area/district, city — via
  `Property`).
- `customer_user_id` → `customer` relationship (`User`).
- `mediator_id` (nullable) → `mediator` relationship (`Mediator`) — copied from
  `Property.mediator_id` at negotiation-creation time, not read live.
- `lead_id` (nullable) → `lead` relationship — see bullet 4.
- `viewing_id` (nullable) → `viewing` relationship — see bullet 2.
- `transaction_type` (`"rent"`/`"sale"`, string) — copied from `Property.listing_type`
  at creation time, never read live (so a later listing-type edit can't retroactively
  change an in-flight negotiation).
- `current_offer_amount` (`Numeric(12,2)`) — the accepted amount; also readable off the
  winning `NegotiationOffer.amount` (the row whose `status` was just flipped to
  `"accepted"`) if a second source is wanted.
- `original_listing_amount` (`Numeric(12,2)`) — snapshot of the listing's price at
  negotiation-creation time, for reference/display only.
- `accepted_at` (timestamp).
- No `currency` column exists on `PropertyNegotiation` or `Property` — this codebase
  has no multi-currency support anywhere found; **Prompt 2 should default
  `PropertyTransaction.currency` to a fixed `"SAR"` constant** rather than reading a
  field that doesn't exist.
- A ready-made deterministic **Agreement Summary** already exists:
  `property_negotiation.build_agreement_summary(negotiation, offers, prop) -> dict |
  None` (non-`None` only once `status == "accepted"`), returned on every
  `GET /negotiations/{id}` as `PropertyNegotiationDetailOut.agreement_summary` —
  contains `property_id`/`property_title`/`customer_name`/`mediator_agent_name`/
  `transaction_type`/`original_listing_amount`/`final_agreed_amount`/`agreed_at`/
  `negotiation_reference` (`NEG-000123`). This is a strong candidate for what
  `PropertyTransaction`'s "View Agreement Summary" action (brief, Prompt 8) renders
  from directly, rather than re-deriving the same facts a second way.

### 2. How `PropertyViewing` links to a negotiation/lead

`PropertyNegotiation.viewing_id` (FK → `property_viewings.id`, `ondelete="SET NULL"`,
nullable) is **explicit, client-supplied, server-verified** — sent optionally on
`POST /properties/{property_id}/negotiations` and validated by
`create_negotiation()` against ALL of: the viewing exists, its `customer_user_id`
matches the calling customer, its `property_id` matches the path's `property_id`, and
its `status == "completed"`. A mismatch is rejected (422), never silently dropped to
`null`. Never required — a customer can negotiate without ever having scheduled a
viewing.

For `PropertyTransaction.viewing_id` (optional, per the prompts file's own field
list): the simplest, most consistent approach is to **just copy
`PropertyNegotiation.viewing_id` at transaction-auto-creation time** — the negotiation
has already done the real validation work above: no new validation needed, no risk of
diverging from what the negotiation itself considers a legitimately linked viewing.

### 3. Document/file-upload reality (gates Prompt 4)

**Confirmed: no server-side document/file-upload endpoint exists anywhere in this
codebase.** Grepped the whole backend for `UploadFile`, `multipart`, `s3`, `S3_`,
`UPLOAD_DIR`, blob-storage clients, `boto3` — zero matches.

`backend/app/models/listing_image.py` — `ListingImage` is a 4-column table
(`id`, `property_id`, `url: String(1024)`, `display_order`). Both image-add endpoints
in `api/routes/properties.py` — admin's `POST /{property_id}/images` (line 872) and
partner's `POST /partner/{property_id}/images` (line 893) — take a plain
`ImagePayload { url: str }` JSON body and just persist that URL string verbatim
(`ListingImage(property_id=..., url=payload.url.strip(), display_order=next_order)`).
There is no upload step anywhere in this flow — the frontend is expected to already
have a hosted image URL (external host) before calling this endpoint. No local-disk
static-serving convention, no signed-URL mechanism, nothing to reuse.

**Conclusion: Prompt 4 must add a minimal, conservative upload mechanism from
scratch** — there is nothing in this codebase for a Documents feature to reuse. Given
the "no new cloud-storage architecture" constraint, the lightest option consistent with
this repo's existing patterns is a local-disk store under a new authenticated download
route (e.g. `backend/uploads/transactions/{transaction_id}/...` on disk, served back
only through an ownership-checked `GET` endpoint — never a public static URL, since
transaction documents are private, unlike listing photos). Prompt 4 owns the final
call on exact shape (path convention, allowed MIME types/size caps, whether it's a
single combined create-and-upload endpoint or a two-step "create document record then
PUT the file"); this note only forecloses "reuse an existing endpoint," since none
exists.

### 4. Existing lead/chat thread model

`backend/app/models/lead.py` — `Lead` (area-wide search/enquiry, no `property_id`
column — only `area_name`/`city`) has a `messages: list["LeadMessage"]` relationship.
`LeadMessage` (`lead.py:102-113`): `id`, `lead_id`, `sender_user_id`, `sender_role`
(`"customer"` | `"mediator"`, admin also sends as `"admin"` via a separate admin
route), `content`, `is_read`, `created_at`.

Routes in `api/routes/leads.py`: `GET /{lead_id}/messages` (line 446) and
`POST /{lead_id}/messages` (line 459), both gated through `_check_lead_access(lead,
current_user, db)` (403 unless the caller is the lead's customer or its assigned
mediator), plus `POST /{lead_id}/messages/read` to mark read. Frontend: web's
`lead.$leadId.tsx` already renders this thread end-to-end (message list + composer);
mobile has the equivalent under `mobile/app/lead/[id].tsx`.

**Implication for "Message Mediator" (Prompt 9/10):** `PropertyTransaction.lead_id` is
only ever populated when the underlying `PropertyNegotiation.lead_id` was itself
populated — which (per the negotiations feature's own documented decision) only
happens when an existing `LeadSuggestion(lead_id, property_id)` row already links that
customer's lead to that exact property. **This will often be null.** So "Message
Mediator" cannot assume a lead thread always exists. Two real options for Prompt 9:
(a) when `lead_id` is present, deep-link straight to `/lead/$leadId` (web) /
`/lead/[id]` (mobile) — reuses the thread verbatim, zero new messaging code; (b) when
absent, fall back to the same mechanism Property Detail/Negotiation pages already use
for "Contact Agent"/"Message Mediator" without a lead in hand — the existing
`ContactModal` flow (web) which, per the Property Intelligence tracking doc, ultimately
creates a new lead via the existing lead-creation path. Prompt 9 should confirm which
of these the brief expects (likely both, branched on `lead_id`), but no new
thread/messaging model is needed either way — this is a reuse-only integration point.

### 5. Notification event-dispatch convention

`backend/app/core/outbox.py` — `EventType` is a plain class of dot-namespaced string
constants (e.g. `NEGOTIATION_ACCEPTED = "negotiation.accepted"`); `record_event(db, *,
event_type, aggregate_type, aggregate_id, payload) -> OutboxEvent` just does `db.add()`
— **never commits** — so it must be called in the same transaction as the domain
mutation, before that mutation's own `db.commit()` (confirmed directly in
`accept_offer()` above: `db.flush()` → `record_event(...)` → `db.commit()`).
`backend/app/models/outbox_event.py` is the row shape; `backend/app/tasks/outbox.py`
is the polling publisher that later picks pending rows up and dispatches to registered
handlers via `register_handler(event_type, handler_fn)`.

Per-feature notification workers follow one consistent shape — confirmed by reading
`backend/app/tasks/negotiation_notifications.py` in full: a small `_TITLES` dict (en/ar
title strings keyed by the `Notification.type` value), a `_render()` function building
the localized title/body from the event payload, and a handler registered via
`register_handler(EventType.X, handler)` that resolves recipients (excluding whichever
`actor_user_id` performed the action — never self-notify), builds a `dedupe_key =
f"{event_type}:{aggregate_id}:{user_id}"`, and delivers through the shared `_deliver()`
pipeline every notification type uses. `backend/app/models/notification.py`'s
`NOTIFICATION_TYPES` tuple must also gain a matching underscore-style entry per new
type (e.g. `"transaction_created"`) alongside the dot-namespaced `EventType` string
(e.g. `"transaction.created"`) — these are deliberately two different string styles for
the same concept, exactly as every existing feature (viewings, negotiations) already
does it.

**For Prompt 6:** add the seven new `EventType` constants under a new
`# ── Transaction Workspace ──` block in `outbox.py` (mirroring the existing per-feature
comment-block convention already visible in that file — see `# ── Visit & Viewing
Management ──` / `# ── Negotiation & Offer Management ──`), matching entries in
`NOTIFICATION_TYPES`, and a new `app/tasks/transaction_notifications.py` module
following `negotiation_notifications.py`'s exact template (titles dict, `_render()`,
`register_handler`, self-notify exclusion, `dedupe_key`, deep-link string pointing at
`mymakan://.../transactions/{id}` mirroring the existing `mymakan://partner/
negotiations/{id}` shape).

### 6. Admin flat-file routing convention

Frontend: `frontend/src/routes/admin_.*.tsx` (dot-prefixed flat files —
`admin_.notifications.tsx`, `admin_.property-requests.tsx`,
`admin_.trust-moderation.tsx` all confirmed present) — each a standalone route outside
`admin.tsx`'s embedded sidebar-tab shell, following this codebase's flat-file routing
convention (same family as `property-requests.$id.tsx`, etc.).

Backend: the matching pattern is a dedicated `admin_*.py` router file (confirmed via
`admin_trust.py`) rather than folding into an existing router — `admin_trust.py`'s own
top-of-file note documents its convention explicitly: `get_admin_user` on every route
for permission checks, `record_audit` for every mutating action (not applicable here
per Prompt 7's read-only-by-design scope), plain query-param filters + an
`X-Total-Count` response header for list endpoints (not a paginated envelope object),
and reuse of existing service/assembly helpers imported directly (e.g.
`admin_trust.py` imports `_build_trust_assessment`/`_load_property_for_intelligence`
straight from `properties.py` rather than recomputing) — Prompt 7's
`admin_transactions.py` should do the same: import Prompt 3's checklist/progress
module and Prompt 2's `to_*_out()` helpers directly rather than re-deriving the
transaction's computed fields a second way.

**For Prompt 13:** create `frontend/src/routes/admin_.transactions.tsx`, wired to
Prompt 7's `GET /api/v1/admin/transactions` (list) / `GET /api/v1/admin/transactions/{id}`
(detail) — both confirmed as the only two admin endpoints this feature needs, read-only,
no mutation actions.

## Statuses

`PROPERTY_TRANSACTION_STATUSES` (`app/models/property_transaction.py`) — plain string
column, no DB enum type, mirroring `PROPERTY_NEGOTIATION_STATUSES`'s convention exactly:

```python
PROPERTY_TRANSACTION_STATUSES = (
    "initiated",
    "information_required",
    "documents_required",
    "under_review",
    "ready_for_next_step",
    "external_process_pending",
    "completed",
    "cancelled",
)
```

Explicit `{current_status: {allowed_next_statuses}}` transitions dict, mirroring
`PROPERTY_NEGOTIATION_TRANSITIONS`'s shape:

```python
PROPERTY_TRANSACTION_TRANSITIONS: dict[str, set[str]] = {
    "initiated": {"information_required", "documents_required", "under_review", "cancelled"},
    "information_required": {"documents_required", "under_review", "cancelled"},
    "documents_required": {"information_required", "under_review", "cancelled"},
    "under_review": {"information_required", "documents_required", "ready_for_next_step", "cancelled"},
    "ready_for_next_step": {"external_process_pending", "completed", "cancelled"},
    "external_process_pending": {"completed", "cancelled"},
    # terminal: completed, cancelled
}
```

Every transaction starts at `initiated` (set by
`create_transaction_for_negotiation()`). `cancelled` is reachable from every
non-terminal status (a customer/mediator/admin can cancel at any point before
completion — mirrors `PropertyNegotiation`/`PropertyViewing`'s own convention).
Back-and-forth between `information_required`/`documents_required`/`under_review` is
allowed because a mediator's "request update" on a document or missing info can
legitimately move a transaction backwards before it's ready to move forward again.
`completed`/`cancelled` are terminal (omitted as dict keys, so `.get(status, set())`
always returns an empty set for them — same convention as
`PROPERTY_NEGOTIATION_TRANSITIONS`).

**Nothing calls this dict yet** — Prompt 2 only defines the shape. Prompt 3's
centralized deterministic checklist/progress engine is what will actually decide which
of these transitions to apply on any given recompute (never a route/frontend decision);
the cancel action (Prompt 4/5) will also validate against it directly.

`TRANSACTION_DOCUMENT_STATUSES` — `not_uploaded` (default, set at seed time) →
`uploaded` (Prompt 4's upload endpoint) → `accepted` | `needs_update` (Prompt 5's
mediator review actions). No transitions dict for this one (only 4 flat values, no
brief call for anything more structured).

## Checklist / Progress methodology (Prompt 3)

`backend/app/services/transaction_progress.py` — pure/deterministic, no DB
queries, no AI, no wall-clock dependence. `compute_transaction_progress(transaction)`
is the single entry point Prompt 4/5/7's API layer must call; frontend/mobile
must never recompute any of this themselves.

**Only one confirmation flag exists today**
(`PropertyTransaction.customer_info_confirmed_at`, Prompt 2) — there is no
separate mediator-side "commercial information confirmed" column yet (Prompt
5's brief mentions a future mediator-side confirm-information action, but
adding its storage is that prompt's job). Given that, the six checklist steps
deliberately split the "customer info" concept across two steps using only
what already exists:

- **`customer_info`** (step 2) — profile-completeness check: does the
  customer's `User.full_name`/`User.phone` snapshot have both fields filled
  in (`User.email` is excluded — it's NOT NULL and therefore always present,
  so counting it would never let this fraction show anything but done).
  Purely derived, no confirmation action.
- **`terms_reconfirmed`** (step 5, labeled exactly **"Information
  Confirmation"** per the wording rule) — whether
  `customer_info_confirmed_at` is set, i.e. Prompt 9's "My information is
  correct" action.

### Checklist steps (both rent and sale; step 6's label/wording differs)

| key | label | status rule |
|---|---|---|
| `offer_agreed` | Offer Agreed | always `done` (the transaction only exists once the negotiation was accepted) |
| `customer_info` | Customer Information | `done` if `full_name` **and** `phone` present; `in_progress` with detail `"N/2"` if exactly one present; else `pending` `"0/2"` |
| `documents_submitted` | Documents Submitted | counts **required** documents only (2 in both rent/sale templates). `done` if all required docs have `status != "not_uploaded"`; `in_progress` with detail `"submitted/required_total"` if some but not all; else `pending` |
| `mediator_review` | Mediator Review | `done` if all required docs are `status == "accepted"`; `in_progress` with detail `"accepted/required_total"` once at least one required doc has been submitted (covers both "awaiting review" and "needs_update" cases — both keep this step incomplete); else `pending` |
| `terms_reconfirmed` | **Information Confirmation** | `done` if `customer_info_confirmed_at` is set; else `pending` (binary, no fraction) |
| `ready_for_next_step` | **"Ready for Rental Contract Process"** (rent) / **"Ready for Sale Process"** (sale) | `done` only once all five prior steps are `done` |

Only **required** documents count toward `documents_submitted`/`mediator_review`'s
fraction and done-ness — the optional "Additional Supporting Document" never
blocks completion. (This means the checklist's own fraction denominator is
`2`, not `3`, for both seeded templates — a deliberate choice so a step
marked `done` never simultaneously shows a fraction like `"2/3"` while an
optional document sits unsubmitted.)

### `progress_percentage` formula (0-100, sums to exactly 100 once fully done)

| step | max weight | contribution formula |
|---|---|---|
| Offer Agreed | 10 | always awarded (fixed) |
| Customer Information | 15 | `15 × (fields_present / 2)` |
| Documents Submitted | 25 | `25 × (required_submitted / required_total)` |
| Mediator Review | 25 | `25 × (required_accepted / required_total)` |
| Information Confirmation | 15 | `15` if confirmed, else `0` |
| Ready bonus | 10 | `10` only if **all** of the above are fully done, else `0` |

Sum, then `round()` and clamp to `[0, 100]`. Every fraction above is exact in
binary floating point for the seeded 2-required-document templates (halves),
so no rounding surprises appear before the final `round()` call.

### Next Best Action — deterministic priority order

Evaluated top-to-bottom; the first applicable rule wins. Ties among
documents (e.g. two required docs both missing, or both `needs_update`)
always resolve to the **lowest `id`** (insertion/template order — matches
`PropertyTransaction.documents`'s own `order_by`):

1. `complete_profile_information` — Customer Information step not done.
2. `upload_missing_document` — a required document is `not_uploaded` (names it).
3. `review_update_request` — a required document is `needs_update` (names it). Always outranked by #2 — matches the brief's own documented example ordering ("upload missing document" > "review mediator's update request").
4. `await_mediator_review` — all required docs submitted, none missing/flagged, but not all accepted yet.
5. `confirm_information` — Information Confirmation step not done.
6. `ready` — everything done; message names the exact rent/sale final-state string.

### Readiness label

- **Not Ready** — until both Documents Submitted **and** Mediator Review are `done`.
- **Almost Ready** — Documents Submitted + Mediator Review done, but Information Confirmation still pending.
- **"Ready for Rental Contract Process"** (rent) / **"Ready for Sale Process"** (sale) — once every step is `done`. Never a generic "Ready for Next Step" string at this final tier.

### What Prompt 3 deliberately did NOT add

No `compute_status()`/status-transition helper — `PROPERTY_TRANSACTION_TRANSITIONS`
application (deciding when `PropertyTransaction.status` itself moves between
`initiated`/`information_required`/`documents_required`/`under_review`/
`ready_for_next_step`) remains Prompt 4/5's job once they have real mutating
endpoints to drive it; this prompt only computes the read-only checklist/
progress/NBA/readiness view.

## APIs

### Customer-facing (Prompt 4)

`backend/app/api/routes/transactions.py`, mounted at `/api/transactions` +
`/api/v1/transactions`, gated behind `FEATURE_NEGOTIATIONS` (not a
dedicated new flag — a `PropertyTransaction` can only ever exist off an
accepted `PropertyNegotiation`, so when negotiations are off nothing could
exist here either; mirrors `negotiations.py`'s `_require_enabled()` exactly).

- `GET /transactions` — the caller's own transactions; `?status=active`
  (everything not `completed`/`cancelled`) / `completed` / `cancelled`,
  omitted returns everything. Each row includes the denormalized
  property/mediator display fields + live-computed `next_best_action` /
  `readiness_label` (never the frontend's job to derive).
- `GET /transactions/{id}` — full detail: checklist (all 6 steps),
  `progress_percentage`, `next_best_action`, `readiness_label`, documents,
  customer info snapshot, and `terms_snapshot` (reused verbatim from
  `property_negotiation.build_agreement_summary()`, not re-derived — see
  Prompt 1's inspection notes, bullet 1). Owner-only (403 for any other
  customer, 404 if the id doesn't exist or isn't a transaction at all).
- `PATCH /transactions/{id}/customer-information` — body
  `{full_name?, phone?}`. Edits the underlying `User` row directly, **not** a
  transaction-specific table — Prompt 2 already decided there's no new DB
  column needed for this content since `User` already carries it (only
  `customer_info_confirmed_at`, the *confirmation timestamp*, is genuinely
  transaction-specific). `None` means "leave unchanged".
- `POST /transactions/{id}/documents` — multipart form, `document_id` (int)
  + `file`. Allowed content types: `application/pdf`, `image/jpeg`,
  `image/png`; max 10MB. Allowed only while the target document is
  `not_uploaded` or `needs_update` (409 otherwise — `accepted`/currently
  `uploaded` i.e. "under mediator review" are both locked from re-upload).
  A fresh upload clears any stale `reviewed_at`/`review_note` from a
  previous `needs_update` cycle.
- `DELETE /transactions/{id}/documents/{document_id}` — same
  not_uploaded/needs_update gate as upload; removes the file from disk and
  resets the document row to `not_uploaded`.
- `GET /transactions/{id}/documents/{document_id}/download` — the *only*
  way to read a document's bytes back; owner-only. No public/static route
  serves the upload directory anywhere in this app (see below).
- `POST /transactions/{id}/confirm-information` — sets
  `customer_info_confirmed_at` (NOT a signature — wording rule: labeled
  "Information Confirmation", never "Sign Contract"). 409 once the
  transaction is terminal.
- `POST /transactions/{id}/cancel` — body `{reason}`. Sets `cancelled_at`,
  `cancellation_reason`, `cancelled_by="customer"`. 409 if the transaction
  is already `completed`/`cancelled` (validated directly against
  `PROPERTY_TRANSACTION_TRANSITIONS`, per the brief's own transitions-dict
  convention).

Every mutating endpoint re-derives the transaction from `{id}` +
the authenticated `current_user` (`property_transaction.get_owned_transaction()`)
— never trusts a user id from the request body — and returns the freshly
recomputed `PropertyTransactionDetailOut`.

### Document storage (Prompt 4)

Confirmed at Prompt 1: no upload endpoint of any kind existed anywhere in
this codebase. Built from scratch, minimal and conservative per that
inspection's conclusion:

- Local disk under `backend/uploads/transactions/{transaction_id}/{document_id}_{uuid}{ext}`
  (`property_transaction.UPLOAD_ROOT`, resolved relative to the source file
  so it's independent of the process's working directory). Gitignored
  (`backend/uploads/`).
- **Never a public/static URL** — there is no `app.mount(...)` or
  `StaticFiles` serving this directory anywhere; the only access path is the
  authenticated, ownership-checked `GET .../download` route above.
  `TransactionDocument.file_reference` stores the opaque absolute disk path,
  never returned to the frontend as a servable URL (the frontend must call
  the download route, which streams the file via `FileResponse`).
- New dependency: `python-multipart` (required by FastAPI's
  `UploadFile`/`File`/`Form` — this repo had zero multipart handling before
  this prompt, confirmed by Prompt 1's grep).

### Status/progress recompute-and-persist (Prompt 4)

Prompt 3 deliberately left "when does `PropertyTransaction.status` actually
move between its 8 values" unimplemented (pure checklist/progress
computation only). Prompt 4 adds
`property_transaction.sync_progress_and_status(db, transaction)` — called
at the end of every mutating action above (document upload/delete, confirm-
information, customer-information edit) — which recomputes via Prompt 3's
engine, persists `progress_percentage`, and maps checklist completion onto
a status:

`customer_info` not done → `information_required`; else `documents_submitted`
not done → `documents_required`; else `mediator_review` OR
`terms_reconfirmed` not done → `under_review` (both "awaiting mediator" and
"awaiting customer confirmation" share this one coarse-grained status —
there is no 9th status value for the latter); else `ready_for_next_step`
(also stamps `ready_at` the first time this is reached). Terminal statuses
(`completed`/`cancelled`) are never touched by this recompute. A transition
is only applied if reachable via zero-or-more hops through
`PROPERTY_TRANSACTION_TRANSITIONS` (BFS, guards against the
information_required/documents_required/under_review cycle) — in practice
every one of these 4 target statuses is always reachable from any
non-terminal current status, so this is a safety net, not an active
constraint.

**Known quirk:** a transaction's `status` column stays at its
creation-time value (`initiated`) until the *first* mutating action runs
`sync_progress_and_status()` — `GET` never writes, it only computes the
checklist/next-best-action/readiness fields fresh for the response. So
`GET /transactions/{id}` immediately after auto-creation can show
`status: "initiated"` alongside a checklist that already reports
`customer_info` as done or pending correctly (the checklist is always
live; `status` briefly is not, until something mutates the transaction).

### Partner-facing (Prompt 5)

`backend/app/api/routes/partner_transactions.py`, mounted at
`/api/partner/transactions` + `/api/v1/partner/transactions`, gated the same
way as `transactions.py` (`FEATURE_NEGOTIATIONS`, not a dedicated flag).
Mirrors `partner_negotiations.py`'s auth/route conventions exactly: every
endpoint depends on `get_mediator_user` (`app/api/deps.py`, returns
`(User, Mediator)`), and every mutating/read action re-derives the
transaction from `{id}` + the authenticated mediator via
`property_transaction.get_owned_transaction_for_mediator()` (404 if the id
doesn't exist, 403 "Not your transaction" otherwise) — never trusts a
mediator id from the request body.

- `GET /partner/transactions` — the mediator's own transactions
  (`PropertyTransaction.mediator_id == mediator.id`, copied from the
  negotiation at auto-creation time, never a live `Property.mediator_id`
  re-lookup). `?status_filter=` accepts `action_required` / `active` /
  `ready` / `completed` / `cancelled`, partitioning every transaction into
  exactly one of these five dashboard tabs
  (`property_transaction.list_transactions_for_mediator()`):
  `action_required` — at least one `TransactionDocument` is `uploaded`
  (submitted, awaiting this mediator's accept/request-update decision), the
  one thing only the mediator can unblock; `active` — non-terminal, not yet
  ready, nothing currently awaiting mediator review; `ready` —
  `ready_for_next_step` or `external_process_pending`; `completed` /
  `cancelled` mirror the status column directly. Omitted/unrecognized
  returns everything.
- `GET /partner/transactions/{id}` — detail: reference, property, agreed
  amount, negotiation reference (via the same reused
  `terms_snapshot`/`build_agreement_summary()` as the customer side), status,
  checklist (all 6 steps, identical engine output to the customer's own
  detail response), documents, and a **restricted** `customer` object —
  `{full_name}` only, deliberately narrower than the negotiations feature's
  own partner privacy bar (`PartnerNegotiationOut`'s
  `customer_name`/`customer_phone`/`customer_email`): the brief explicitly
  scoped this to "only fields needed for the transaction — not full customer
  PII", and document review/confirm-information genuinely doesn't need
  contact details (the existing lead/negotiation messaging channel already
  covers "how to reach the customer").
- `POST /partner/transactions/{id}/documents/{document_id}/accept` — only
  valid while the target document is `uploaded` (409 otherwise); sets
  `status="accepted"`, `reviewed_at=now()`, clears `review_note`. Never
  touches `file_reference` — the mediator can only change a document's
  review status/note, never the uploaded file itself (no endpoint on this
  router accepts a file/content payload at all).
- `POST /partner/transactions/{id}/documents/{document_id}/request-update` —
  body `{reason}` (`TransactionDocumentReviewRequest`, 422 on an
  empty/whitespace-only reason — the one schema in this feature that
  actually validates its reason string, unlike
  `NegotiationRejectRequest`/`TransactionCancelRequest`'s free-text
  convention). Same `uploaded`-only gate as accept; sets
  `status="needs_update"` + `review_note=reason` + `reviewed_at=now()`,
  which reopens the document for the customer's own re-upload via the
  existing `_document_editable()` gate (Prompt 4) — no new customer-side
  code needed for that half.
- `POST /partner/transactions/{id}/confirm-information` — mediator-side
  "property and commercial information confirmed" timestamp. New
  `PropertyTransaction.mediator_info_confirmed_at` column (this prompt's
  migration `f7a8b9c0d1e2`), separate from and independent of the
  customer's own `customer_info_confirmed_at` — different actor, different
  column, same terminal-status (`completed`/`cancelled` → 409) guard. **Not
  wired into Prompt 3's checklist/progress engine** — storage only for now
  (see "Known limitations" below); `sync_progress_and_status()` is still
  called for consistency with every other mutating action, but it's
  currently a no-op against this particular field since no checklist step
  reads it yet.

Every mutating endpoint returns the freshly recomputed
`PartnerPropertyTransactionDetailOut` (checklist/progress/next-best-action/
readiness always come from Prompt 3's engine via
`property_transaction.to_partner_transaction_detail_out()`, never recomputed
ad hoc in the route). `agreed_amount` stays immutable through every action on
this router — no request schema here declares that field, so pydantic drops
it silently even if a client sends one (tested directly).

**Correction added by Prompt 10**: this list was originally missing a document
*download* route — without one, the "Accept"/"Request Update" actions above would be
blind decisions (a mediator could see a document's status/label but never its actual
bytes). Added `GET /partner/transactions/{transaction_id}/documents/{document_id}/download`,
reusing the same `property_transaction.document_file_path()` helper and ownership guard
as every other route on this router — see "Screens" → "Partner web (Prompt 10)" for the
full rationale and tests.

### Admin (Prompt 7)

`backend/app/api/routes/admin_transactions.py`, mounted at
`/api/admin/transactions` + `/api/v1/admin/transactions`, gated the same way
as `transactions.py`/`partner_transactions.py` (`FEATURE_NEGOTIATIONS`, not a
dedicated flag). Mirrors `property_request_admin.py`/`admin_trust.py`'s
conventions: `get_admin_user` on every route, plain query-param filters + an
`X-Total-Count` response header for the list endpoint (not a paginated
envelope object), and reuse of Prompt 2/3/4's existing `to_transaction_out()`
/ `to_transaction_detail_out()` helpers directly (via new
`to_admin_transaction_out()` / `to_admin_transaction_detail_out()` thin
wrappers in `property_transaction.py` that just add participant display
fields) rather than re-deriving the transaction's computed fields a second
way. **Read-only — no admin mutation/moderation endpoints of any kind** (see
"Known limitations" below).

- `GET /admin/transactions` — reference, type, property, customer
  (name/email), mediator, amount, status, progress, created date, last
  activity, for every transaction (no ownership scoping). Filterable by
  `status`, `transaction_type` (`rent`/`sale`), `mediator_id`,
  `customer_user_id`; sortable by `sort=created_at|updated_at|
  progress_percentage` + `order=asc|desc` (defaults to `updated_at desc`,
  i.e. last-activity-first). `skip`/`limit` pagination,
  `X-Total-Count` header carries the post-filter, pre-pagination count
  (`property_request_admin.list_requests`'s own convention).
- `GET /admin/transactions/{id}` — checklist (all 6 steps), document
  statuses, participants (customer name/email, mediator agent name),
  and negotiation reference — the latter already covered by
  `terms_snapshot.negotiation_reference`, reused verbatim from Prompt 4's
  `PropertyTransactionDetailOut` rather than added as a duplicate field. Adds
  a `timeline`: this transaction's own `OutboxEvent` rows (`aggregate_type=
  "property_transaction"`, `aggregate_id=str(transaction.id)`) in
  chronological order — there is no separate event-log/history table for
  `PropertyTransaction` (see that model's own docstring), so the timeline is
  read directly off the same seven event types Prompt 6 already records,
  never a new history mechanism. No ownership check — any admin can look up
  any transaction by id (unlike the customer/partner routes' 403 "not
  yours").

Tests: `backend/tests/test_admin_transactions.py` — access control (non-admin
403, unauthenticated 401, no ownership restriction on the happy path),
list happy path (all admin-visible fields present, `X-Total-Count` correct),
filters (`status` incl. 422 on an unknown value, `transaction_type`,
`mediator_id`, `customer_user_id`), sort (`progress_percentage` asc, unknown
`sort` value falls back to `updated_at`), detail happy path (checklist keys,
document count/status, `customer_info`/`terms_snapshot.negotiation_reference`,
timeline contains `transaction.created` with the right payload), detail 404,
and a direct check that no mutation verb (`POST .../cancel`, `PATCH`,
`POST .../confirm-information`) resolves to a route on this router at all.

## Notifications (Prompt 6)

Event/notification pattern mirrors `negotiations.py`/`viewings.py` exactly —
see `backend/app/core/outbox.py` (`EventType` dot-namespaced strings) +
`record_event(db, ...)` called in the same transaction as the mutating
write, and `backend/app/models/notification.py`'s underscore-style
`NOTIFICATION_TYPES` tuple. Handler lives in
`backend/app/tasks/transaction_notifications.py`, structured identically to
`negotiation_notifications.py`: `_TITLES`, `_render()`,
`@register_handler(...)`/`_enqueue()` per event, `_recipients_for_event()`
(self-notify exclusion via `payload["actor_user_id"]`, never duplicates a
`user_id`), the same dedupe-key (`f"{event_type}:{aggregate_id}:{user_id}"`)
pre-check + `_deliver()` pipeline every other notification type uses.
Registered at import time via `app.main`'s `import
app.tasks.transaction_notifications  # noqa: F401` line (no entry needed in
`celery_app.py`'s `include=[...]` list — `negotiation_notifications`/
`viewing_notifications` aren't there either, same existing precedent).
`deep_link` is `mymakan://partner/transactions/{id}` for every recipient
regardless of role — same "one hardcoded string" convention
`negotiation_notifications.py`/`viewing_notifications.py` already use
(mobile's `deepLink.ts` resolver already tolerates an optional `partner/`
prefix for exactly this reason).

Seven events added under a new `# ── Transaction Workspace ──` block in
`outbox.py`:

- `EventType.TRANSACTION_CREATED = "transaction.created"`
- `EventType.TRANSACTION_ACTION_REQUIRED = "transaction.action_required"`
- `EventType.TRANSACTION_DOCUMENT_UPLOADED = "document.uploaded"`
- `EventType.TRANSACTION_DOCUMENT_UPDATE_REQUESTED = "document.update_requested"`
- `EventType.TRANSACTION_DOCUMENT_ACCEPTED = "document.accepted"`
- `EventType.TRANSACTION_READY = "transaction.ready"`
- `EventType.TRANSACTION_CANCELLED = "transaction.cancelled"`

Matching `NOTIFICATION_TYPES` entries: `transaction_created`,
`transaction_action_required`, `document_uploaded`,
`document_update_requested`, `document_accepted`, `transaction_ready`,
`transaction_cancelled`.

**No brief event-to-recipient mapping was found committed anywhere in this
repo** (same "Prompt N owns the call" situation as Prompt 2's document
templates) — this prompt's own trigger-point design, documented in full in
`transaction_notifications.py`'s module docstring:

- **`transaction.created`** — fired inline inside
  `create_transaction_for_negotiation()` (the same Prompt 2 hook called from
  `accept_offer()`). Notifies **both** customer and mediator, deliberately
  with no `actor_user_id` in the payload — this is a new-entity-for-both
  event (a fresh workspace neither party had a moment ago), not "someone did
  something to you"; `PropertyNegotiation.accept_offer()` already fires its
  own self-notify-excluded `NEGOTIATION_ACCEPTED` event separately for the
  "you accepted / your offer was accepted" half of the story.
- **`document.uploaded`** — `upload_document()` (Prompt 4). Mediator only —
  the customer already gets a synchronous API response confirming their own
  upload, so notifying them too would be a pointless self-notification.
- **`document.accepted`** / **`document.update_requested`** —
  `accept_document()` / `request_document_update()` (Prompt 5). Customer
  only (the mediator performed the action).
- **`transaction.action_required`** — fired **alongside**
  `document.update_requested`, from the same `request_document_update()`
  call: one mediator action produces two distinct customer notifications —
  a specific "this document needs a fix" detail, plus a general "you have an
  action required" nudge whose body embeds the *live* deterministic Next
  Best Action message (`progress.next_best_action.message`, recomputed by
  the same `sync_progress_and_status()` call already running) so the nudge
  text can never drift stale relative to Prompt 3's engine.
- **`transaction.ready`** — `sync_progress_and_status()`, fired only the
  *first* time a transaction reaches `ready_for_next_step` (guarded by the
  same `transaction.ready_at is None` check that already exists for stamping
  `ready_at` — a plain read-only `GET` never re-fires it, and neither does
  any later mutation once `ready_at` is set). Notifies **both** parties, no
  `actor_user_id` (shared milestone, not an actor-performed action). Body
  embeds `progress.readiness_label` **verbatim** — the exact "Ready for
  Rental Contract Process"/"Ready for Sale Process" string — never re-worded,
  per the feature's non-negotiable wording rule.
- **`transaction.cancelled`** — `cancel_transaction()` (Prompt 4; mediator-
  initiated cancellation isn't wired to any route yet). Notifies whichever
  party did **not** cancel, resolved from `cancelled_by` since this function
  isn't handed the acting `User` object directly (`cancelled_by="customer"`
  → actor is `transaction.customer_user_id`, so only the mediator is
  notified).

Tests: `backend/tests/test_transaction_notifications.py` — end-to-end (real
HTTP endpoints, asserting the actual `OutboxEvent` row each mutating action
creates, same style as `test_outbox.py`'s "real endpoints actually emit the
events they claim to" section) for all seven events including the
two-events-from-one-mutation case and the readiness event firing exactly
once even after a later read-only `GET`, plus unit tests against
`_render()`/`_TITLES` directly (English/Arabic, including a dedicated
assertion that `transaction_ready`'s body carries the exact wording-rule
string and never the forbidden "Transaction complete"/"Ownership
transferred" phrasing).

## AI usage (Prompt 6)

`POST /api/v1/transactions/{id}/ai-assistant` (customer, `transactions.py`)
and `POST /api/v1/partner/transactions/{id}/ai-assistant` (mediator,
`partner_transactions.py`) — both call the same
`app/services/transaction_ai.py::generate_response()`, mirroring
`negotiation_ai.generate_guidance()`'s "AI call with a deterministic
fallback, never raises, never blocks" shape exactly, rate-limited the same
way (`rate_limit_dependency("transaction_ai_assistant", limit=20,
window_seconds=600, by_user=True)`, mirroring `negotiation_ai_guidance`'s
own limit). The brief's own endpoint description names only
`transactions.py`, but also lists a distinct mediator quick-action
vocabulary — the only way for a mediator to actually reach that vocabulary
through an ownership-checked route is a mirrored endpoint on
`partner_transactions.py`, so this prompt added both, sharing one service
function via an `actor_role` parameter.

**Quick actions** (`transaction_ai.CUSTOMER_QUICK_ACTIONS` /
`MEDIATOR_QUICK_ACTIONS`, validated against the caller's own role —
`InvalidQuickAction` → 422, never a 500):

- Customer: `whats_next`, `whats_missing`, `explain_step`, `what_to_prepare`,
  `summarize`, `what_to_ask_mediator`.
- Mediator: `summarize_outstanding`, `whats_blocking`,
  `draft_update_request`, `summarize_customer_progress`.

**Grounding** (`transaction_ai._build_facts()`) — a small structured text
block, never raw DB rows, assembled ONLY from: Prompt 3's own
`compute_transaction_progress()` output (checklist/progress/readiness/Next
Best Action — explained, never recalculated by the model), this
transaction's documents (label/required/status/mediator review note, never
the file itself or its disk path), property identity (title/area/city),
the terms snapshot reused verbatim from
`property_negotiation.build_agreement_summary()` (same reuse rule Prompt 4's
`terms_snapshot` response field already follows), a lightweight trust
signal (`mediator.is_verified` → "Verified by myMakan" / "Not yet verified
by myMakan" — deliberately NOT the full Trust Center assessment, which
needs several extra aggregate queries that live in the `properties.py` route
layer and would be disproportionate machinery for a short assistant reply),
and a role-scoped identity block: the customer's own `full_name`/`phone` on
the customer side, but only `customer.full_name` (no phone/email) on the
mediator side — matching `PartnerTransactionCustomerOut`'s existing privacy
bar (Prompt 5). The system prompt (`TRANSACTION_ASSISTANT`,
`core/ai/prompts.py`) additionally forbids the model from claiming to
change transaction state, mark a document reviewed, confirm information, or
cancel anything, and forbids any legal interpretation (contracts, Ejar,
Nafath, disputes, financing, ownership transfer, tenancy law) — the
assistant may only explain and suggest; every real action still happens
through the app's own buttons.

**Fallback** (`transaction_ai._deterministic_fallback()`) — a short
templated sentence built from Prompt 3's own `readiness_label` +
`progress_percentage` + `next_best_action.message`, same "never blocks,
never invents" contract as `negotiation_ai.generate_guidance`'s own
fallback. Used both on any AI-call exception and (implicitly) documents what
the AI response should be grounded in.

**Never mutates state**: `generate_response()` only reads `transaction` and
everything reachable from it — no `db.flush()`/`db.commit()` anywhere in
`transaction_ai.py`, and neither route calls `db.commit()` either.

Tests: `backend/tests/test_transaction_ai.py` — grounding (captured prompt
content contains only the permitted facts; the mediator-role block is
verified to omit the customer's phone/email while still including their
name), wrong-role quick action rejected (`InvalidQuickAction`), AI-failure
fallback (never raises, fallback text references the real
reference/readiness), state-mutation guard (`db_session.is_modified(...)`
stays `False`, and a `GET` detail response is byte-identical before/after
an assistant call), plus HTTP-level wiring for both routers (happy path,
wrong-role 422, cross-owner 403, unknown-language 422, AI-failure 200
fallback).

## Screens

### Customer web workspace (Prompts 8-9)

`frontend/src/routes/transaction.$id.tsx` — header (property/type/reference/status/agreed
amount/mediator + `TransactionStepper`, `frontend/src/components/maskan/TransactionStepper.tsx`,
Prompt 8), Next Best Action card, and a 6-tab body (Prompt 9):

- **Overview** — read-only Agreed Commercial Terms, rendered straight from `terms_snapshot`
  (never a free-form edit path, per the global "agreed amount is immutable" rule).
- **My Information** — edit `full_name`/`phone` (email read-only) via Prompt 4's PATCH
  endpoint, plus the **Information Confirmation** action ("My information is correct" —
  never "Sign Contract") and its confirmed timestamp.
- **Documents** — one `frontend/src/components/maskan/TransactionDocumentCard.tsx` per
  seeded document: required/optional badge, status chip, upload/replace gated on
  `not_uploaded`/`needs_update` and delete gated on `needs_update` only (mirrors the
  backend's own `_document_editable()`/`status == "not_uploaded"` gates exactly), review-note
  display when `needs_update`, authenticated download.
- **Checklist** — the full 6-step detail (label/status/detail/description), a more verbose
  companion to the header stepper's compact view — same `checklist` data, not recomputed.
- **Activity** — `frontend/src/components/maskan/TransactionActivityTimeline.tsx`, built
  client-side purely from timestamps already on the detail response (`created_at`, per-document
  `uploaded_at`/`reviewed_at`, `customer_info_confirmed_at`, `mediator_info_confirmed_at`,
  `ready_at`, `completed_at`, `cancelled_at`) — there's no customer-facing timeline endpoint
  (the `OutboxEvent`-backed one is Prompt 7's admin-only addition), and this never touches the
  lead/chat message list.
- **AI Assistant** — `frontend/src/components/maskan/TransactionAskMyMakanPanel.tsx`, the
  customer quick-action vocabulary from Prompt 6 (`whats_next`/`whats_missing`/`explain_step`/
  `what_to_prepare`/`summarize`/`what_to_ask_mediator`), reply rendered as assistant text under
  a visible "AI" badge, with a fallback note when `generated_by === "fallback"`.

**Message Mediator** stays a sidebar action (Prompt 8) — deep-links to `/lead/$leadId` only
when `lead_id` is present, mirroring `negotiations.$id.tsx`'s own "no lead → no button" choice
rather than building a parallel contact flow. **Cancellation** is a sidebar "Cancel Transaction"
action (hidden once `completed`/`cancelled`) opening a reason-picker modal
(`TRANSACTION_CUSTOMER_CANCEL_REASONS`, mirrors `NEGOTIATION_CUSTOMER_WITHDRAW_REASONS`'s
closed-list-over-free-text convention) that calls Prompt 4's cancel endpoint — same
`WithdrawModal` shape `negotiations.$id.tsx` already uses.

Verified end-to-end against a real backend/DB (not just unit tests): login, tab navigation,
a real document upload (status/progress/Next Best Action all live-recomputed), a real
customer-information save + confirm, a real AI Assistant quick-action round trip, and both
locales including full RTL mirroring of the stepper/checklist.

_(Mobile equivalent: Prompts 10-13.)_

### Partner web (Prompt 10)

`frontend/src/routes/partner.transactions.tsx` (list) + `partner.transactions.$id.tsx`
(detail) — mirrors `partner.negotiations.tsx`/`partner.negotiations.$id.tsx`'s file
naming, the "foo.bar.tsx sibling of foo.tsx" `pathname !== "/partner/transactions" →
<Outlet />` guard, and the `authLoading`/`user`/`loading`/`error` load-state shape
exactly. Content is closer to the customer workspace (Prompts 8-9) than to the
negotiations detail page, so the detail screen reuses that page's 6-tab layout
(Overview / Customer / Documents / Checklist / Activity / AI Assistant) rather than
negotiations' stacked-blocks layout — interpreted as "mirror the routing/auth-guard
structure", not the literal UI shape, since the brief's own document list (View/Accept/
Request Update) needs more room than the negotiation detail page's blocks give it.
Every checklist/status/readiness string is reused verbatim from the `transactionPage.*`
i18n keys the customer side already established (never a second translation of the same
backend-computed values) — only the partner-specific chrome (tabs' labels aside, list
tabs, document review actions, AI Assistant quick actions, confirm-information copy)
lives under a new `partnerTransactions` namespace.

- **List** — 5 tabs (Action Required / Active / Ready / Completed / Cancelled) mapped
  directly to Prompt 5's `?status_filter=` values. Unlike `partner.negotiations.tsx`
  (one fetch, bucketed client-side, since every negotiation's tab is derivable from its
  own `status` field), this list **refetches per tab** — `action_required` depends on
  per-document state (`TransactionDocument.status == "uploaded"`) that the summary list
  row (`PartnerPropertyTransactionOut`) doesn't carry, so client-side bucketing isn't
  possible without an N+1 detail fetch. Tab pill counts were dropped for the same reason
  (would need all 5 buckets fetched up front). Card fields per brief §11: reference,
  property, customer name, rent/buy badge, agreed amount, progress bar, status badge,
  Next Best Action, last updated.
- **Detail** — transaction summary (property/type/reference/agreed amount + the shared
  `TransactionStepper`), Next Best Action card, then tabs: Overview (terms snapshot,
  reused `transactionPage.overview.*` keys), Customer (restricted `customer.full_name`
  snapshot — never phone/email, matches `PartnerTransactionCustomerOut`'s privacy bar —
  plus the mediator's own **Information Confirmation** action against
  `mediator_info_confirmed_at`, independent of the customer's own confirmation), Documents
  (View/Accept/Request Update — see below), Checklist (full 6-step detail, same data as
  the header stepper), Activity (client-derived timeline, same timestamps-only approach
  as `TransactionActivityTimeline.tsx`, rebuilt inline in the partner detail route rather
  than reusing that component since `PartnerPropertyTransactionDetailOut`'s `customer`
  field isn't structurally assignable to that component's `customer_info`-typed prop),
  AI Assistant (mediator quick-action vocabulary from Prompt 6). Sidebar actions: Message
  Customer (deep-links to `/partner/leads/$leadId` only when `lead_id` is present, same
  "no lead → no button" rule as every other surface in this feature), View Property, View
  original negotiation (`/partner/negotiations/$id`).
- **Document actions** — View opens the file in a new tab via a fetched Blob URL;
  Accept and Request Update are only offered while a document is `uploaded` (mirrors the
  backend's own 409 gate); Request Update opens a reason-required modal (empty/whitespace
  rejected client-side before the call, matching the backend's own 422 validation) with a
  placeholder reading `"e.g. Please upload a clearer copy."` per the brief's own example
  text — never a preset value, since a reason is mandatory.
- **Backend addition this prompt required**: Prompt 5's `partner_transactions.py` built
  accept/request-update but never added a document *download* route — an oversight the
  tracking doc didn't previously flag, since without it a mediator could review a
  document's metadata but never its actual bytes, making "Accept"/"Request Update" a
  blind decision. Added `GET /partner/transactions/{transaction_id}/documents/{document_id}/download`,
  mirroring `transactions.py`'s customer-side download route exactly (same shared
  `property_transaction.document_file_path()` helper, same ownership-checked
  `get_owned_transaction_for_mediator()` guard, same no-public-URL contract) — 3 new
  tests in `test_partner_transactions.py` (happy path byte-match, 404 before upload,
  403 cross-mediator), 187 tests passing across the full transaction-related suite.

_(Mobile equivalent: Prompts 11-13.)_

### Mobile (Prompt 11)

`mobile/app/transaction/[id].tsx` (replaces the Prompt-1-era "Coming soon" placeholder)
+ new `mobile/app/my-transactions.tsx`, wired into the profile tab
(`mobile/app/(tabs)/profile.tsx`) right after "My Negotiations" — same plain-`Pressable`-row
convention every other profile nav entry uses (checked `saved.tsx`'s own wiring first, per
this prompt's own scope note; no dedicated tab bar entry, matching how My Negotiations/My
Viewings are also profile-only, not bottom-tab items). Treats web's Prompts 8-9 as the
reference for *behavior and copy*, not pixel layout — mirrors mobile's own established
single-scroll-of-section-cards convention (`app/negotiations/[id].tsx`) instead of web's
tab bar: Header (property/type/reference/status/agreed amount/mediator) with a new
**vertical** `TransactionStepper` (`mobile/src/components/TransactionStepper.tsx` — a
separate component from web's horizontal one, so a phone screen never needs horizontal
scroll, per this prompt's own scope note), Next Best Action, Overview (terms snapshot,
read-only), My Information (edit + save + Information Confirmation action), Documents
(one `TransactionDocumentCard` per seeded document — see below), Activity (client-derived
timeline, rebuilt inline same as partner web's Prompt 10 version, for the same "prop type
isn't shared" reason), a toggleable Ask myMakan panel (customer quick-action vocabulary,
chip-based like `app/negotiations/[id].tsx`'s own panel — this endpoint takes a fixed
action key, not free text), and an actions block (Message Mediator via `lead_id`, View
Property, View original negotiation, Ask myMakan toggle, Cancel Transaction via a
`BottomSheet` reason-picker mirroring `WithdrawSheet`'s exact shape). No separate
"Checklist" section — the vertical stepper already shows every step's label/status/detail
fraction, so a second section repeating the same data would be pure duplication (web's tab
bar has room for a redundant expanded view; a single mobile scroll doesn't need it).

- **Documents / device picker**: `expo-document-picker` (`~57.0.1`, added via `npx expo
  install` — no app.json plugin config needed for the plain-picker-plus-cache-directory
  usage here) opens the system file picker restricted to the same
  `application/pdf`/`image/jpeg`/`image/png` allowlist the backend enforces.
  `mobile/src/lib/api/maskan.ts::uploadTransactionDocument()` appends the picked asset as
  React Native's `{ uri, name, type }` FormData idiom (not a real `Blob`/`File` — the
  web client's `File`-based upload function doesn't translate directly, hence a separate
  mobile-specific implementation with the same multipart shape). No document *download*
  route needed on the customer side (unlike Prompt 10's partner-side gap) — a customer
  already has the file on their own device after picking it.
- **`mobile/src/lib/transactionWorkspace.ts`** — ports web's `statusTone`/`readinessText`/
  `nbaText` helpers verbatim (status tone dropped, mobile's `Badge` has no `destructive`
  tone — see `myNegotiations`'s own `STATUS_TONE` precedent for `rejected`/`cancelled`
  folding into `warning` instead) so both platforms render the backend's deterministic
  `readiness_label`/`next_best_action` fields identically, never recomputed independently.
- **i18n**: `mobile/src/lib/i18n/{en,ar}.ts`'s `transactionPage` namespace was previously
  just 3 placeholder keys (`backToNegotiation`/`comingSoon`/`desc`, unused anywhere else —
  confirmed by grep before removing) for the "Coming soon" screen this prompt replaces;
  rebuilt with the same key names/values as web's own `transactionPage`/`myTransactions`
  namespaces (status/checklist/checklistStatus/readiness/nba/documents/myInformation/
  activity/askPanel/cancelModal) so copy never drifts between platforms, plus a new
  `nav.myTransactions` key for the profile row.
- **Bug fixed in `app/negotiations/[id].tsx`**: "Continue Transaction" previously linked
  to `/transaction/${negotiation.id}` — using the *negotiation's* id, not the real
  transaction id. This was invisible while `/transaction/[id]` was a placeholder that
  ignored its param, but would have opened the wrong (or a nonexistent) transaction now
  that the screen is real. Fixed to mirror web's `negotiations.$id.tsx`
  `handleContinueTransaction()` exactly: call `fetchMyTransactions()` and navigate to the
  row whose `negotiation_id` matches, since the `PropertyTransaction` is already
  auto-created server-side and there's nothing to create client-side. New i18n keys
  `negotiationDetail.agreed.openingTransaction`/`continueTransactionFailed` support the
  loading/error states this now needs (previously a bare `<Link>`, now an async handler).

Verified: `npm run typecheck` (mobile) passes clean with `strict: true`, including the
`@ts-expect-error`-suppressed RN `FormData` append (confirmed genuinely necessary — the
suppression itself would fail to compile if unused, under `strict` mode).

### Admin web (Prompt 13)

`frontend/src/routes/admin_.transactions.tsx` — single flat file (no separate `$id` route,
unlike partner web's Prompt 10 two-file convention; the detail view is `selectedId` local
state within the same component instead, since the list and detail are both simple enough
to share one file and this mirrors `admin_.property-requests.tsx`'s own single-file shape
more closely than partner's). Self-contained: its own admin-login gate and `Panel`
primitive, duplicated rather than imported from `admin_.property-requests.tsx` (same
"each flat file stays independently code-splittable" rationale that file's own top
comment documents) — and, like every other `admin_.*.tsx` file, **plain English strings
throughout, no i18n `t()` calls at all** (confirmed by reading `admin_.property-requests.tsx`
in full before writing this one — the admin console doesn't use the i18n system anywhere).
Not linked from `admin.tsx`'s own nav — reachable only by direct URL, same
"flagged as a judgment call, not wired into the sidebar" precedent
`admin_.property-requests.tsx`'s own tracking note already established for this file
family.

- **List** — reference, type, property, customer (name + email), mediator, amount,
  status, progress, created, last activity, per brief §22/Prompt 13's own field list.
  Filters: status (dropdown of all 8 statuses), transaction type, mediator id, customer
  user id — all wired straight to Prompt 7's query params. Sort: `created_at` /
  `updated_at` / `progress_percentage`, asc/desc, defaulting to `updated_at desc` (last
  activity first, matching the backend's own default). `X-Total-Count`-driven pagination,
  same direct-`fetch` (not `requestJson`) idiom `fetchAdminPropertyRequests()` already
  uses so the header survives.
- **Detail** — checklist (all 6 steps with status/detail), document statuses (label,
  required/optional, status), timeline (raw `OutboxEvent` rows: event type + timestamp —
  no payload rendering attempted, since payload shapes vary per event type and this is a
  minimal read-only view, not a full audit log UI), participants (customer name/email,
  mediator agent name) and negotiation reference (`terms_snapshot.negotiation_reference`,
  reused verbatim, never re-derived). **Zero mutation controls anywhere on this page** —
  matches the backend router's own read-only-by-design scope (no admin cancel/override
  action exists to wire up in the first place).

Verified: `npm run build` (regenerates `routeTree.gen.ts` for the new route) and
`npm run typecheck` both pass clean; `test_admin_transactions.py`'s existing 14 tests
re-run unchanged (no backend changes this prompt — Prompt 7 already built everything this
page needed).

## Security

### Customer-facing (Prompt 4)

- **Ownership, never trust the body**: every route derives the transaction
  from the path `{id}` + the authenticated `current_user`
  (`property_transaction.get_owned_transaction()` — 404 if the id doesn't
  exist, 403 if it exists but belongs to a different customer). No route
  reads a customer/user id out of a request body anywhere. Tested explicitly
  for every mutating action (`test_transactions_api.py`'s cross-customer
  tests) plus the two read routes (list only ever returns the caller's own
  rows; detail 403s for a non-owner).
- **No public/unauthenticated document URLs**: there is no `StaticFiles`
  mount or any other route serving `property_transaction.UPLOAD_ROOT` — the
  authenticated, ownership-checked `GET .../download` route is the only way
  to retrieve a file's bytes, and `TransactionDocument.file_reference` (an
  opaque absolute disk path) is never itself a clickable/servable URL.
- **File validation**: content type allowlist (`application/pdf`,
  `image/jpeg`, `image/png`) and a 10MB size cap, both enforced before
  anything touches disk; rejected uploads never mutate the document row.
- **Valid transitions only**: `sync_progress_and_status()` validates any
  computed status change is reachable via `PROPERTY_TRANSACTION_TRANSITIONS`
  before applying it; `cancel_transaction()` checks `"cancelled" in
  PROPERTY_TRANSACTION_TRANSITIONS.get(status, set())` directly (409
  otherwise) rather than unconditionally overwriting `status`.
- **`agreed_amount` immutability**: no request schema in this prompt
  (`CustomerInformationUpdate`, `TransactionCancelRequest`, the multipart
  upload form) includes an `agreed_amount` field at all — even if a client
  sends one anyway, Pydantic's default "ignore unknown fields" behavior
  drops it silently before it ever reaches the service layer (tested
  directly).

### Partner-facing (Prompt 5)

- **Ownership, never trust the body**: every `partner_transactions.py` route
  derives the transaction from the path `{id}` + the authenticated
  `(User, Mediator)` pair via
  `property_transaction.get_owned_transaction_for_mediator()` — 404 if the
  id doesn't exist, 403 "Not your transaction" if it exists but belongs to a
  different mediator. Tested explicitly for every route (list scoping,
  detail, accept, request-update, confirm-information) with a second
  mediator. A customer-only token (no `Mediator` row at all) is rejected by
  `get_mediator_user` itself before any ownership check runs — also tested
  directly.
- **Document file/content is never mediator-editable**: `accept_document()`
  and `request_document_update()` only ever assign
  `status`/`reviewed_at`/`review_note` — neither touches `file_reference`,
  and neither route's request schema (`TransactionDocumentReviewRequest`, or
  the bodyless accept endpoint) declares a file/content field at all, so
  there is no code path on this router that could alter the customer's
  originally uploaded bytes. Tested directly: the file on disk and its
  authenticated download are byte-identical before and after a mediator
  action, even when a client tries smuggling `file_reference`/`review_note`
  into the accept request's JSON body.
- **Review actions gated on `uploaded` only**: both accept and
  request-update 409 unless the target document is currently `uploaded`
  (not `not_uploaded`, not already `accepted`, not `needs_update`) — a
  mediator can't accept/flag a document the customer hasn't (re)submitted,
  and can't act twice on the same submission.
- **Reason required for request-update**: `TransactionDocumentReviewRequest`
  strips and rejects an empty/whitespace-only `reason` (422) before the
  service layer ever runs — the one reason field in this whole feature that
  isn't accepted as unrestricted free text.
- **`agreed_amount` immutability**: same guarantee as the customer side —
  no request schema on `partner_transactions.py` includes an `agreed_amount`
  field, so it's silently dropped even if a client sends one (tested
  directly against the request-update endpoint).
- **Customer PII minimization**: `PartnerPropertyTransactionOut`/
  `PartnerPropertyTransactionDetailOut` expose only `customer_name`/
  `customer.full_name` — no phone, no email, anywhere in this router's
  responses (tested directly), narrower than the negotiations feature's own
  partner privacy bar.

## Tests

**Prompt 2** — `backend/tests/test_property_transactions.py` (12 tests, all passing
alongside the full existing suite, 590 passed/23 skipped): auto-creation on acceptance
(field-by-field, via the real `POST /negotiations/{id}/accept` HTTP path so the actual
`accept_offer()` hook is exercised, not a fabricated call), no transaction created on a
*failed* accept (self-accept 409), reference format, duplicate prevention (direct
`IntegrityError` from calling `create_transaction_for_negotiation()` twice for the same
negotiation, simulating a concurrent-accept race), rent vs. sale document template
seeding, transitions-dict shape correctness (every status is a valid key, terminal
statuses have no outgoing transitions, `cancelled` reachable from every active status,
every referenced status is a real status), customer info snapshot reuse (present vs.
missing optional `User` fields). Existing `test_negotiations.py`/
`test_partner_negotiations.py` suites (52 tests) re-verified unchanged after the
`accept_offer()` hook was added.

**Prompt 3** — `backend/tests/test_transaction_progress.py` (29 tests, pure
unit tests against transient/unpersisted ORM instances — no DB needed except
one integration test at the end that exercises the real
`create_transaction_for_negotiation()` path): every checklist-step
status/detail combination (no docs, partial customer info, partial
documents, all submitted pending review, accepted-but-unconfirmed,
needs_update, fully ready), `progress_percentage` at each stage (10 → 25 →
38 → 50 → 75 → 100), Next Best Action priority ordering including ties
(missing-document tie-break by lowest id, needs_update tie-break by lowest
id, upload-missing outranking review-update-request per the brief's own
example ordering), readiness label transitions (Not Ready → Almost Ready →
final rent/sale string), rent vs. sale final wording on both the checklist
step label and the readiness label. Full transaction-related suite
(`test_property_transactions.py` + `test_transaction_progress.py` +
`test_negotiations.py` + `test_partner_negotiations.py`, 93 tests) re-run
together, all passing.

**Prompt 4** — `backend/tests/test_transactions_api.py` (28 tests, real
HTTP-level tests via `client`/`db_session`, uploads cleaned up from disk by
an autouse fixture since they land outside the DB-rollback isolation every
other write gets): list scoping (own-only, active/completed/cancelled
filters), detail assembly happy path (checklist/next-best-action/readiness/
terms_snapshot/customer_info all present and correct), 404/403 on both read
routes, customer-information PATCH (profile edit + recompute, `agreed_amount`
in the body silently ignored), document upload happy path + invalid content
type (422) + oversized (422, cap monkeypatched down for test speed) +
cross-customer (403) + blocked once `accepted` (409) + allowed while
`needs_update` (200, clears stale review_note), document delete blocked
while `uploaded`/"under mediator review" (409) vs. allowed while
`needs_update` (200) + cross-customer (403), authenticated download
(content-byte match) vs. cross-customer (403) vs. before-any-upload (404),
confirm-information (timestamp set, status/progress recompute, blocked
after cancel with 409, cross-customer 403), cancel (happy path incl.
`cancelled_by="customer"`, cross-customer 403, cancel-after-terminal 409),
and two full end-to-end integration tests (rent → "Ready for Rental Contract
Process", sale → "Ready for Sale Process") walking upload → simulated
mediator-accept (direct ORM mutation + `sync_progress_and_status()`, since
Prompt 5's real mediator endpoints don't exist yet) → confirm-information →
100%. Full transaction-related suite re-run together (121 tests, all
passing).

**Prompt 5** — `backend/tests/test_partner_transactions.py` (24 tests, real
HTTP-level tests via `client`/`db_session`, same upload-cleanup fixture as
`test_transactions_api.py`): list scoping (own-only) and all 5 status-filter
buckets (`action_required` only appears once a document is genuinely
`uploaded`, `active` before any upload, `ready`/`completed`/`cancelled`
mirroring the status column directly), list response never exposes
phone/email, detail assembly happy path (checklist/documents/terms_snapshot
present, restricted `customer` object is name-only), 404/403 on both read
routes, accept happy path + before-upload 409 + already-accepted 409 +
unknown-document 404 + cross-mediator 403, request-update happy path +
empty/whitespace reason 422 (document left untouched) + before-upload 409 +
re-upload-reopens-the-customer-gate (proves it feeds the existing Prompt 4
`_document_editable()` mechanism, not a parallel one) + cross-mediator 403,
mediator-cannot-alter-file-content (accept with a spoofed
`file_reference`/`review_note` in the body leaves the on-disk file and its
authenticated download byte-identical), confirm-information happy path
(sets `mediator_info_confirmed_at`, independent of
`customer_info_confirmed_at`) + blocked-after-cancel 409 + cross-mediator
403, and `agreed_amount` immutability through a request-update call that
tries to sneak one in. Full backend suite re-run (671 passed, 23 skipped —
same skip count as before this prompt).

**Prompt 7** — `backend/tests/test_admin_transactions.py` (14 tests): access
control (non-admin 403, unauthenticated 401), list happy path (all
admin-visible fields, `X-Total-Count`), filters (`status` incl. 422 on an
unknown value, `transaction_type`, `mediator_id`, `customer_user_id`), sort
(`progress_percentage` asc, unknown `sort` falls back to `updated_at`),
detail happy path (checklist, documents, `customer_info`/
`terms_snapshot.negotiation_reference`, timeline contains `transaction.created`
with the right payload), detail 404, no-ownership-restriction (any admin can
view any transaction), and a direct check that no mutation verb resolves to a
route on this router. Only the transaction-related suite from Prompts 2-7 was
re-run per this prompt's own scope (not the full unrelated backend suite):
`test_property_transactions.py` + `test_transaction_progress.py` +
`test_transactions_api.py` + `test_partner_transactions.py` +
`test_transaction_notifications.py` + `test_transaction_ai.py` +
`test_admin_transactions.py` + `test_negotiations.py` +
`test_partner_negotiations.py` — 184 tests, all passing, no regressions.

**Prompt 10** — `test_partner_transactions.py` grew from 24 to 27 tests with the new
partner document-download route (happy path, before-upload 404, cross-mediator 403); no
other backend changes this prompt. Frontend: `npm run build` (regenerates
`routeTree.gen.ts` for the two new routes) and `npm run typecheck` both pass clean.

**Prompt 11** — no backend changes (mobile-only prompt). `npm run typecheck` (mobile,
`strict: true`) passes clean across the two new/replaced screens, two new components,
new API section, and the `negotiations/[id].tsx` fix. No mobile test runner exists in
this repo to add automated coverage to (mobile has no `__tests__`/Jest setup anywhere —
confirmed by the absence of a `test`/`jest` script in `mobile/package.json`), consistent
with every other mobile feature in this codebase relying on typecheck + manual
verification rather than automated tests.

## Buy-path verification (Prompt 12)

Verification-only prompt — no new functionality, no files changed. Walked the BUY flow
using a real `sale`-type accepted negotiation (`Property.listing_type="sale"`,
`PropertyNegotiation.transaction_type` copied from it) through the full backend
integration test (`test_transactions_api.py::test_full_sale_flow_reaches_ready_for_sale_process`,
re-run clean) plus a manual audit of every surface that renders transaction data, looking
specifically for rent-only copy/logic that might have leaked into the buy path:

- **Purchase-price wording** — every amount label across customer web, partner web, and
  mobile (`transactionPage.agreedAmount`/`overview.originalListing`/`overview.finalAgreed`,
  and their partner/mobile equivalents) is transaction-type-neutral ("Agreed amount",
  never "Rent amount"); the rent-only `"/mo"` suffix (`negotiationDetail.offerBlock.
  perMonth`) is applied only behind an explicit `transaction.transaction_type === "rent"`
  guard everywhere it's used — audited every call site across all three surfaces, no
  ungated occurrence found. No fix needed.
- **Buy checklist final state** — confirmed `"Ready for Sale Process"` renders exactly,
  end-to-end, from `transaction_progress.py::READY_LABELS["sale"]` through every response
  schema, every frontend/mobile checklist-step-6 label computation
  (`transaction_type === "sale" ? "Ready for Sale Process" : "Ready for Rental Contract
  Process"`, written identically in `transaction.$id.tsx`, `partner.transactions.$id.tsx`,
  and mobile's `transaction/[id].tsx`), and the `transaction.ready` notification body
  (embeds `readiness_label` verbatim). No fix needed.
- **Buy document template** — confirmed `DOCUMENT_TEMPLATES["sale"]` (National ID / Iqama
  Copy, **Proof of Funds (Bank Statement)**, Additional Supporting Document) is the
  conservative one from Prompt 2, distinct from `["rent"]`'s Proof of Income variant, and
  that `create_transaction_for_negotiation()` selects the template by the transaction's
  own `transaction_type` (with a `rent` fallback that can only trigger for an
  unrecognized type — never reachable in practice, since `transaction_type` is always
  copied from an already-validated `Property.listing_type`). No fix needed.
- **Partner buy view** — `partner.transactions.tsx`/`partner.transactions.$id.tsx`
  (Prompt 10) reuse the exact same transaction-type-neutral labels and `perMonth` guard as
  customer web; confirmed no sale-transaction card/detail view shows rent-specific text.
  No fix needed.
- **AI Assistant / notifications** — `TRANSACTION_ASSISTANT`'s system prompt
  (`core/ai/prompts.py`) already describes the feature generically as "Rental/Buy
  Transaction Workspace" and never assumes rent; `transaction_notifications.py`'s bodies
  never hardcode "rent" and instead embed the deterministic `readiness_label`/`next_best_
  action.message` values verbatim. No fix needed.
- **"Buyer terminology"** (Prompt 12's own instruction: "buyer terminology where the
  brief specifies it") — considered relabeling the `customer_info` checklist step /
  "My Information" section to "Buyer Information" for `sale` transactions, since Prompt
  14's own BUY demo storyline narrates that step as "Buyer Information". Decided against
  it: that storyline line is demo narration, not a located brief citation for literal UI
  copy (same "no brief §N text was ever found committed in this repo" situation Prompt
  1/2/5 already hit for document templates and dashboard bucket rules) — and the backend's
  `ChecklistStep.label` for this step is a single shared string
  (`transaction_progress.py`), not currently split by transaction type the way the final
  step already is. Relabeling would need a new backend field or a frontend-only override
  of a backend-supplied label (breaking the "never recomputed/reworded ad hoc" invariant
  every other layer of this feature relies on) for a requirement that isn't textually
  confirmed anywhere. Left as-is, documented here rather than silently skipped, so a future
  prompt with a located brief citation can revisit it deliberately.

Full transaction-related backend suite re-run together (135 tests: `test_property_
transactions.py` + `test_transaction_progress.py` + `test_transactions_api.py` +
`test_partner_transactions.py` + `test_transaction_notifications.py` + `test_transaction_
ai.py` + `test_admin_transactions.py`), all passing, no regressions.

## Known limitations

- `DOCUMENT_TEMPLATES`' two-required-plus-one-optional rent/sale lists are Prompt 2's
  own conservative choice, not sourced from a committed brief (none was found in-repo —
  see "Domain model" → `TransactionDocument` above). Revisit if a more specific
  requirements list surfaces later.
- **Admin visibility is read-only by design (Prompt 7)** — `GET
  /admin/transactions` and `GET /admin/transactions/{id}` are the only two
  admin endpoints this feature has; there is no admin cancel/override/edit
  action anywhere. This is deliberate, not a gap: a transaction's status,
  checklist, and progress are 100% deterministic outputs of the
  customer/mediator actions Prompts 4/5 already built (document
  upload/review, information confirmation, cancellation) — an admin
  "override" button would either have to fake one of those actor actions
  (confusing provenance: whose action was it really?) or bypass
  `PROPERTY_TRANSACTION_TRANSITIONS`/Prompt 3's engine entirely (breaking the
  "never recomputed ad hoc" invariant every other layer of this feature
  relies on). If a future brief needs admin moderation here (e.g. force-
  cancel a stuck transaction), it should be added as its own explicit,
  audited action — mirroring `admin_trust.py`'s `record_audit` convention —
  rather than folding it into this read-only router.
- **`mediator_info_confirmed_at` (Prompt 5) is storage-only** — the column
  and its `POST /partner/transactions/{id}/confirm-information` action
  exist, but Prompt 3's checklist/progress engine still only reads
  `customer_info_confirmed_at` for the `terms_reconfirmed` step (see
  tracking doc's "Checklist / Progress methodology", written before this
  column existed). A mediator confirming information today does not move
  the checklist, `progress_percentage`, Next Best Action, or readiness label
  at all — it's recorded and returned in every transaction response, but a
  future prompt would need to extend `transaction_progress.py` to actually
  factor it in, if the brief ends up wanting that.
- **Partner dashboard status-filter buckets (Prompt 5) are this prompt's own
  design, not sourced from a committed brief** — `action_required` /
  `active` / `ready` / `completed` / `cancelled` were named directly in
  Prompt 5's own instructions, but the exact rule for what counts as
  "action required" (this prompt chose: at least one document currently
  `uploaded`) wasn't specified further. Revisit if a more specific
  requirements list surfaces later.
- `status` can briefly read `"initiated"` even once the checklist already
  shows further progress, until the *first* mutating action runs
  `sync_progress_and_status()` — see "Status/progress recompute-and-persist"
  above. `GET` is deliberately read-only (never writes), so this is a
  documented characteristic, not a bug — every mutating endpoint on this
  transaction fixes it immediately.
- Uploaded files live on local disk, keyed by absolute path in
  `file_reference` — fine for this investor-demo, single-instance
  deployment, but would need a shared/object store (still out of the
  "no new cloud-storage architecture" scope for this feature) before this
  app could ever run behind more than one backend process.

## Demo flow

The RENT storyline below was walked live end-to-end (Prompt 14): the real backend
(`uvicorn`, not the test client) running against the actual dev Postgres database,
driven with real authenticated HTTP requests through every step below in sequence —
negotiation create → accept (auto-creates the transaction) → customer-information PATCH
→ two real document uploads (multipart, landing on real disk) → two mediator accepts →
confirm-information — reaching `status: "ready_for_next_step"`, `progress_percentage:
100`, `readiness_label: "Ready for Rental Contract Process"`. The AI Assistant endpoint
was also exercised live and returned a real (non-fallback) OpenAI-backed reply correctly
grounded in that exact transaction's data (amount, property, area, readiness state). The
admin detail endpoint's timeline showed the real `OutboxEvent` rows this run created
(`transaction.created`, two `document.uploaded`). The BUY storyline and the frontend's
five new routes (`/my-transactions`, `/transaction/{id}`, `/partner/transactions`,
`/partner/transactions/{id}`, `/admin/transactions`) were verified via the backend's own
sale-flow integration test (see "Buy-path verification" above) and an SSR smoke-check
(each route returns HTTP 200 with the correct `<title>`, no error boundary) respectively
— a live-browser click-through wasn't performed since no browser-automation tool
(Playwright/chromium-cli) is installed in this environment; recommend `/run-skill-generator`
if that capability is wanted for a future session.

### RENT storyline

1. **Property → AI Match → Intelligence → Trust → Viewing → Negotiation** — pre-existing
   features (AI Home Finder, Property Intelligence, Trust Center, Viewings, Negotiations),
   unchanged by this feature.
2. **Offer Accepted** — mediator or customer calls `POST /negotiations/{id}/accept`.
   Inside `accept_offer()`, immediately after `negotiation.accepted_at` is set:
   `create_transaction_for_negotiation()` runs in the same DB transaction, so the
   `PropertyTransaction` row (status `initiated`, 0% progress, rent document template
   seeded: National ID, Proof of Income, Additional Supporting Document) exists the
   instant the negotiation shows `accepted` — both customer and mediator get a
   `transaction.created` notification.
3. **Continue Transaction** — the negotiation detail screen (web `negotiations.$id.tsx`,
   mobile `negotiations/[id].tsx`) shows a "Continue Transaction" action once
   `status === "accepted"`; both platforms resolve the real transaction id via
   `fetchMyTransactions()` and navigate to `/transaction/{id}`.
4. **Transaction Workspace → 35%** — the workspace opens showing Offer Agreed (done, 10
   pts) + whatever fraction of Customer Information is already on file from the user's
   own profile (up to 15 pts) — a customer with both `full_name` and `phone` already set
   lands at exactly 25%; the demo's "35%" checkpoint corresponds to also having uploaded
   one of the two required documents (partial credit on Documents Submitted).
5. **Complete Customer Information** — "My Information" tab/section: edit
   `full_name`/`phone` via `PATCH .../customer-information`, save. `customer_info`
   checklist step moves to `done` (full 15 pts).
6. **Upload Document** — "Documents" tab/section: pick a file for each required document
   (web `<input type="file">`, mobile `expo-document-picker`) → `POST
   .../documents` (multipart). Once both required rent documents are `uploaded`,
   `documents_submitted` is `done` (25 pts) and the transaction's `status` recomputes to
   `under_review`; the mediator gets a `document.uploaded` notification.
7. **Partner Reviews** — partner web `partner.transactions.$id.tsx` Documents tab: View
   (authenticated download) each document, then either Accept or Request Update.
8. **Update Requested** — mediator picks Request Update on one document with a required
   reason (e.g. "Please upload a clearer copy."). Sets that document to `needs_update` +
   `review_note`; fires `document.update_requested` + `transaction.action_required` to the
   customer; `mediator_review` step drops back to `in_progress` even though the other
   required document may already be `accepted`.
9. **Customer Updates** — customer sees the flagged document (warning-tone review note) on
   their own Documents section, re-uploads (allowed while `needs_update`) — this clears
   `review_note`/`reviewed_at` and reopens the document at `uploaded` for another mediator
   pass.
10. **Partner Accepts** — mediator accepts both required documents → `mediator_review`
    `done` (25 pts, 75% cumulative), readiness label becomes **"Almost Ready"**.
11. **Confirm Commercial Information** — customer's "Information Confirmation" action
    (`POST .../confirm-information`, labeled exactly "My information is correct" — never
    "Sign Contract") sets `customer_info_confirmed_at`; `terms_reconfirmed` `done` (15 pts,
    90% + the 10pt ready bonus once every step is done = **100%**).
12. **100% → "Ready for Rental Contract Process"** — `status` recomputes to
    `ready_for_next_step`, `ready_at` stamps for the first time, `readiness_label` and the
    checklist's final step both read the exact wording-rule string; `transaction.ready`
    notifies both parties with that string embedded verbatim.

### BUY storyline

1. **Property → Offer Accepted** — same accept-flow trigger as RENT, but off a
   `sale`-type property (`Property.listing_type == "sale"`) — the auto-created transaction
   seeds the **sale** document template (National ID, **Proof of Funds (Bank
   Statement)** — not Proof of Income, Additional Supporting Document; confirmed distinct
   in "Buy-path verification" above) and every amount/wording surface renders
   transaction-type-neutral copy (no "/mo" suffix, no "rent" wording anywhere — audited in
   that same section).
2. **Transaction Workspace → Buyer Information** — "My Information"/Customer Information
   step, same mechanism as RENT (edit `full_name`/`phone`, save) — see "Buy-path
   verification"'s own note on why this step's backend-supplied label stays "Customer
   Information" rather than a sale-specific "Buyer Information" string (no located brief
   citation for that literal relabeling; documented as a deliberate, revisitable choice).
3. **Documents** — upload National ID + Proof of Funds (Bank Statement); once both
   required sale documents are `uploaded`, `documents_submitted` is `done` and `status`
   moves to `under_review`.
4. **Mediator Review** — partner web reviews and accepts both documents (same View/
   Accept/Request Update mechanism as RENT, applied to the sale template's own documents).
5. **Confirmation** — customer's Information Confirmation action, same endpoint/wording as
   RENT.
6. **"Ready for Sale Process"** — once every step is `done`, `readiness_label` and the
   checklist's final step read exactly `"Ready for Sale Process"` (never "Ready for
   Rental Contract Process", "Transaction complete", or "Ownership transferred") —
   verified end-to-end by `test_full_sale_flow_reaches_ready_for_sale_process`.

Both storylines' terminal states are explicitly **not** the start of any Ejar/Nafath/
government-verification/contract-execution/payment/escrow/mortgage/financing flow — those
remain entirely out of scope for this feature (see "Scope summary" above); the workspace's
job ends at "ready for the next, currently out-of-app, process."
