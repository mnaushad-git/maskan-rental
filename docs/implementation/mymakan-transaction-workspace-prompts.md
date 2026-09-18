# myMakan Rental/Buy Application + Transaction Workspace — Session-Sized Prompt Plan

This feature (full spec: see chat/task history — "Rental/Buy Application + Transaction Workspace") is too
large for one Claude Code session. This document splits it into 14 prompts, ordered by dependency. Run them
one at a time, in order, each in a fresh session (paste the prompt text verbatim as the user message). Each
prompt is self-contained and grounded in files verified against the repo on 2026-08-31.

Existing files this plan is grounded in:

- Backend models: `backend/app/models/property_negotiation.py` (accepted-offer flow — flat row + child
  `NegotiationOffer`, string `status` column, explicit `PROPERTY_NEGOTIATION_TRANSITIONS` dict — mirror this
  convention, not a DB enum, not a state-machine library), `property_viewing.py`, `mediator.py`, `lead.py`,
  `notification.py`, `user.py`, `audit_log.py`, `outbox_event.py`, `listing_image.py`
- Backend routes: `backend/app/api/routes/negotiations.py`, `partner_negotiations.py`, `viewings.py`,
  `partner_viewings.py`, `leads.py`, `notifications.py`, `mediators.py`
- Backend services: `backend/app/services/negotiation_ai.py`, `negotiation_intelligence.py`,
  `negotiation_signals.py`, `property_negotiation.py`, `viewing_checklist.py`, `viewing_checklist_ai.py`,
  `viewing_next_steps_ai.py`
- AI gateway: `backend/app/core/ai/gateway.py` (`get_client`, `run_chat`, `log_ai_call`),
  `core/ai/prompts.py`, `core/feature_flags.py`, `core/config.py`
- **No document/file-upload storage service currently exists** anywhere in `backend/app/core/config.py` or
  the routes above (verified by grep — no S3/blob/upload-dir settings found). The Documents prompt (#4) must
  confirm this itself first (check `listing_image.py` for how property photos are actually stored — likely
  client-supplied URLs, not a server upload endpoint) and, only if genuinely nothing reusable exists, add one
  minimal conservative mechanism (e.g. local disk path under an existing static-serving convention, or a
  signed-URL-free authenticated download route) — not a new cloud-storage architecture.
- Web routes: `frontend/src/routes/negotiations.$id.tsx`, `negotiations.$id_.agreement.tsx`,
  `transaction.$id.tsx` (**currently a placeholder** — "Coming soon" `EmptyState`, see its own code comment
  citing this feature — this prompt plan replaces it), `partner.negotiations.$id.tsx`, `partner.negotiations.tsx`,
  `partner.tsx`, `lead.$leadId.tsx`, `viewings.$id.tsx`, `auth.tsx` (account/profile), `admin.tsx` +
  `admin_.*.tsx` (flat-file admin routing convention, e.g. `admin_.trust-moderation.tsx`),
  `lib/api/maskan.ts`, `lib/i18n/en.ts` + `ar.ts`, `components/maskan/`
- Mobile: `mobile/app/transaction/[id].tsx` (**currently the same placeholder**, mirrors web exactly —
  replace it), `mobile/app/negotiation/`, `mobile/app/negotiations/`, `mobile/app/viewing/`,
  `mobile/app/viewings/`, `mobile/app/leads.tsx`, `mobile/app/lead/`, `mobile/app/saved.tsx` /
  `my-bookings.tsx` (existing "My Activity"-style profile screens — model "My Transactions" access off
  these), `mobile/src/lib/api/maskan.ts`, `mobile/src/lib/i18n/`
- Docs to read as needed: `docs/implementation/mymakan-negotiations.md` (accepted-offer flow, terminal
  status details), `mymakan-viewings.md`, `mymakan-property-intelligence.md`, `mymakan-trust-center.md`,
  `mymakan-customer-parity.md` (update at the end), `mymakan-phase1.md`

**Global constraints — copy into every session, non-negotiable:**

- Feature-first investor demo mode. Phase 1 (Rent + Buy) only. Do not start another feature.
- Absolutely NOT in scope: Ejar, Nafath, government verification APIs, title deed integration, digital
  signatures, legal contract execution, payment gateway, reservation payment, escrow, mortgage, financing,
  new Redis architecture, new queue architecture, new microservices.
- Reuse, don't recreate: accepted `PropertyNegotiation`, `Property`, Property Intelligence, Trust Center,
  `PropertyViewing`, Leads/chat, mediator/customer profiles, notifications, AI gateway, auth, audit-log
  pattern, i18n, web/mobile parity rules.
- Statuses are plain string columns with an explicit Python transitions dict, mirroring
  `PROPERTY_NEGOTIATION_TRANSITIONS` / `PROPERTY_VIEWING_TRANSITIONS` exactly — no DB enum type, no state
  machine library.
- Progress %, checklist state, Next Best Action, and readiness are **100% deterministic** — never
  LLM-calculated, never LLM-decided. AI may only *explain* an already-computed state.
- AI must ground strictly in transaction/checklist/document/property/negotiation/trust data it is given.
  Never: legal interpretation, invented government requirements, claims of Ejar completion or title
  verification, document-validity claims beyond the recorded review status, or changing transaction status.
- Wording rules (exact): final ready state is **"Ready for Rental Contract Process"** (rent) or **"Ready for
  Sale Process"** (buy). Never "Transaction complete", "Ownership transferred", or "Ejar completed". The
  mutual-confirmation step is labeled **"Information Confirmation"**, never "Sign Contract".
  "✓ Verified by myMakan" trust wording rules from the Trust Center feature still apply — do not introduce
  new verification claims here.
- Agreed amount is immutable through normal transaction editing — any change requires a new
  negotiation/amendment, never a direct field edit.
- Customer web and mobile must reach equivalent business outcomes for every capability in this feature — no
  finishing with a web-only or mobile-only gap. Update `docs/implementation/mymakan-customer-parity.md` at
  the end (Prompt 14).
- Create `docs/implementation/mymakan-transaction-workspace.md` in Prompt 1 and update it incrementally as
  each prompt completes — models, statuses, checklist/progress methodology, APIs, screens, security, tests,
  known limitations, future Ejar/Nafath/payment integration boundaries.

---

## Prompt 1 — Inspection map + tracking doc + document-storage reality check

Read `CLAUDE.md`, `docs/implementation/mymakan-phase1.md`, `docs/implementation/mymakan-negotiations.md`,
`mymakan-viewings.md`, `mymakan-property-intelligence.md`, `mymakan-trust-center.md`.

Scope: read-only inspection, plus creating `docs/implementation/mymakan-transaction-workspace.md`. Do not
change any application code.

Do:
- Confirm the accepted-negotiation flow end-to-end (where `PropertyNegotiation.status` becomes `accepted`,
  what data is available on it — property, mediator, customer, agreed amount, currency, lead/viewing links).
- Confirm how `PropertyViewing` links to a negotiation/lead (for optional `viewing_id` on the new
  transaction).
- Confirm today's document/file-upload reality (see grounding note above) — inspect `listing_image.py` and
  any partner property create/edit form's image-upload call to determine whether ANY server-side upload
  endpoint exists that a Documents feature could reuse, or whether Prompt 4 must add a minimal one.
- Confirm the existing lead/chat thread model (`lead.py`, `leads.py` routes) well enough to know how
  "Message Mediator" will open/reuse an existing thread in Prompt 9/10.
- Confirm the notification system's event-dispatch convention (`notification.py`, `notifications.py`,
  `outbox_event.py`) well enough to know how new event types get added in Prompt 7.
- Confirm the admin flat-file routing convention (`admin_.*.tsx` + matching backend admin routes) for
  Prompt 13.

Write `docs/implementation/mymakan-transaction-workspace.md` with: scope summary, the domain model this plan
will build (`PropertyTransaction`, `TransactionDocument`, checklist/progress design — copy from the global
constraints above), an "Inspection notes" section capturing what you found for each bullet above (especially
the document-storage reality check — this gates Prompt 4's approach), and empty placeholder headers for
Statuses / APIs / Screens / Security / Tests / Known limitations / Demo flow to be filled in by later
prompts. Report only a short summary — no code changes this prompt.

---

## Prompt 2 — Backend: PropertyTransaction + TransactionDocument models, migration, auto-creation

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md` (Prompt 1's inspection notes).

Scope: new `backend/app/models/property_transaction.py` (and a `TransactionDocument` model — same file or a
sibling `transaction_document.py`, your call, matching how the repo splits e.g. `property_negotiation.py`'s
parent+child), one new Alembic migration in `backend/alembic/versions/`, a hook into wherever
`PropertyNegotiation.status` transitions to `accepted` (in `negotiations.py` or `property_negotiation.py`
service — locate the exact acceptance code path first), `backend/app/schemas/property_transaction.py`, tests.

Build:
- `PropertyTransaction`: id, reference (human-readable, e.g. `MYM-XXXXX`, generate deterministically),
  property_id, transaction_type (`rent`/`sale`), customer_user_id, mediator_id, lead_id, negotiation_id
  (unique — this is what prevents duplicates), viewing_id (nullable), agreed_amount, currency, status,
  progress_percentage, timestamps (created_at/updated_at/ready_at/completed_at/cancelled_at),
  cancellation_reason. Statuses: `initiated`, `information_required`, `documents_required`, `under_review`,
  `ready_for_next_step`, `external_process_pending`, `completed`, `cancelled` — plain string column +
  explicit transitions dict, mirroring `PROPERTY_NEGOTIATION_TRANSITIONS`.
- `TransactionDocument`: transaction_id, document_type, label, required (bool), status
  (`not_uploaded`/`uploaded`/`accepted`/`needs_update`), uploaded file reference, uploaded_at, reviewed_at,
  review status, review note. Seed rows from a configurable template (rent template, buy template — see
  brief examples) when the transaction is created; do not invent legal/document requirements beyond the
  brief's conservative examples.
- Auto-creation: when a negotiation is accepted, create exactly one `PropertyTransaction` (unique constraint
  on negotiation_id enforces no duplicates even under a race).
- Customer info snapshot fields: reuse existing user/profile fields where possible; only add
  transaction-specific fields that don't already exist on `User`/profile, clearly marked required/optional
  in the schema layer, not new DB columns unless genuinely needed.

Do NOT add API routes, checklist/progress logic (next prompt), or touch frontend/mobile.

Tests: auto-creation on acceptance, duplicate prevention (same negotiation twice), reference generation,
rent vs buy template seeding, status transition dict correctness.

Update the tracking doc's Statuses/Models sections.

---

## Prompt 3 — Backend: Deterministic checklist, progress, Next Best Action, readiness engine

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: new `backend/app/services/transaction_progress.py` (or similar single module — brief explicitly says
"centralize checklist rules... do not manually hardcode progress independently in web/mobile"), reusing
Prompt 2's models, tests.

Build one centralized, pure/deterministic module that, given a `PropertyTransaction` + its documents +
confirmation flags, computes:
- Checklist state per step (rent: offer agreed / customer info / documents submitted / mediator review /
  terms reconfirmed / ready-for-contract-process; buy: same shape ending in ready-for-sale-process) — each
  step's status (done/in-progress with a fraction like documents "2/3"/pending).
- `progress_percentage` (0-100, deterministic weighting — document the formula in the tracking doc).
- Next Best Action: a single deterministic pick (e.g. "upload missing document" > "review mediator's update
  request" > "confirm your information" > ...) — priority order documented, not AI-chosen.
- Readiness label: Not Ready / Almost Ready / Ready for Next Step, with the exact rent/buy final-state
  strings from the global constraints.

This module is the single source of truth the API layer (Prompt 4/5) calls — never recomputed ad hoc
elsewhere, never in frontend/mobile.

Do NOT add API routes or touch frontend/mobile yet.

Tests: every checklist-state combination (no docs / partial docs / all docs+pending review / accepted docs +
unconfirmed / fully ready), progress % at each stage, Next Best Action priority ordering including ties,
readiness label transitions, rent vs buy final wording.

Update the tracking doc's "Checklist methodology" / "Progress methodology" sections with the exact formula
and priority order.

---

## Prompt 4 — Backend: Customer APIs (transaction, information, documents, confirm, cancel)

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md` (including Prompt 1's
document-storage reality check).

Scope: new `backend/app/api/routes/transactions.py` (registered in `backend/app/api/__init__.py`/`main.py`
following the existing router-registration convention), Prompt 2/3's models and service, tests.

Build:
- `GET /api/v1/transactions` — customer's own transactions, filterable active/completed/cancelled.
- `GET /api/v1/transactions/{id}` — full detail (property, mediator, checklist, progress, next-best-action,
  readiness, documents, terms snapshot) — owner-only.
- `PATCH /api/v1/transactions/{id}/customer-information` — updates the transaction-specific info fields from
  Prompt 2.
- `POST /api/v1/transactions/{id}/documents` — upload, using whatever storage mechanism Prompt 1 determined
  (reuse if one exists; otherwise the minimal conservative one decided there). Validate file type/size.
- `DELETE /api/v1/transactions/{id}/documents/{document_id}` — only where the document isn't yet
  accepted/under mediator review.
- `POST /api/v1/transactions/{id}/confirm-information` — sets customer confirmation timestamp (not a
  signature — see wording rules).
- `POST /api/v1/transactions/{id}/cancel` — captures cancelled_by/reason/timestamp, valid only pre-terminal.

Security (critical — test explicitly): customer can only ever access their own transaction/documents; no
trusting user IDs from the request body (derive from auth session); no public/unauthenticated document URLs;
valid status transitions only enforced via Prompt 2's transitions dict.

Do NOT touch partner/admin endpoints or frontend/mobile.

Tests: each endpoint happy-path, cross-customer access denial, invalid file type/size rejection, invalid
transition rejection, cancel-after-terminal rejection, agreed_amount is never editable via any of these.

Update tracking doc's APIs section.

---

## Prompt 5 — Backend: Partner APIs (list, detail, document review, confirm information)

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: new `backend/app/api/routes/partner_transactions.py` (mirror `partner_negotiations.py`'s auth/route
conventions exactly), Prompt 2/3's models and service, tests.

Build:
- `GET /api/v1/partner/transactions` — mediator's assigned transactions, filterable Action Required / Active
  / Ready / Completed / Cancelled.
- `GET /api/v1/partner/transactions/{id}` — detail: reference, property, customer (only fields needed for
  the transaction — not full customer PII), agreed amount, negotiation reference, status, checklist,
  documents, terms snapshot, timeline.
- `POST /api/v1/partner/transactions/{id}/documents/{document_id}/accept`.
- `POST /api/v1/partner/transactions/{id}/documents/{document_id}/request-update` — requires a short reason
  string; sets document status to `needs_update`; mediator can never alter the uploaded file itself, only
  its review status/note.
- `POST /api/v1/partner/transactions/{id}/confirm-information` — mediator-side "property and commercial
  information confirmed" timestamp.

Security: mediator can only access transactions where they are the assigned `mediator_id` — test a second
mediator's denial explicitly. Reuse whatever partner-auth dependency `partner_negotiations.py` already uses.

Do NOT touch customer/admin endpoints or frontend/mobile.

Tests: list filters, detail assembly, accept/request-update transitions, reason-required validation,
cross-mediator access denial, mediator cannot edit document file/content, agreed_amount immutability.

Update tracking doc's APIs section.

---

## Prompt 6 — Backend: Notifications wiring + AI Transaction Assistant

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: extend wherever `negotiations.py`/`viewings.py` already dispatch notifications (mirror that exact
pattern for consistency) for the new transaction events; new
`POST /api/v1/transactions/{id}/ai-assistant` in `transactions.py`, reusing `core/ai/gateway.py` +
`core/ai/prompts.py`; tests.

Build:
- Notification events: `transaction.created`, `transaction.action_required`, `document.uploaded`,
  `document.update_requested`, `document.accepted`, `transaction.ready`, `transaction.cancelled` — fired
  from Prompts 4/5's endpoints and the acceptance hook from Prompt 2, using the existing notification
  system/outbox pattern only (no new infra). Deep-link payload points at the transaction.
- AI Assistant endpoint: takes a quick-action key (customer set: what's next / what's missing / explain this
  step / what to prepare / summarize / what to ask mediator; mediator set: summarize outstanding / what's
  blocking / draft polite update request / summarize customer progress) plus the caller's own transaction
  context. Context assembled ONLY from transaction/checklist/document/property/negotiation/trust data — never
  invents facts, never changes status, never gives legal interpretation. Reuse `negotiation_ai.py` or
  `viewing_next_steps_ai.py`'s grounding pattern (build prompt strictly from a small structured context
  object, not raw DB rows).

Do NOT touch admin or frontend/mobile.

Tests: each notification fires on the right event with the right recipient, AI grounding (mock gateway,
assert prompt context contains only permitted sources), AI failure fallback (no error surfaced to user, per
existing gateway convention), AI response never mutates transaction state.

Update tracking doc's "AI usage" and notifications sections.

---

## Prompt 7 — Backend: Admin read-only visibility + full backend test pass

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: extend `backend/app/api/routes/` with a minimal `admin_transactions.py` (or extend an existing admin
router if one is the natural home — check `property_request_admin.py`/`admin_trust.py` conventions first),
reuse existing admin permission checks, tests; then run the full set of transaction-related backend tests
added across Prompts 2-7.

Build (keep deliberately minimal per brief):
- `GET /api/v1/admin/transactions` — reference, type, property, customer, mediator, amount, status,
  progress, created date, last activity. Filterable/sortable following existing admin list conventions.
- `GET /api/v1/admin/transactions/{id}` — checklist, document statuses, timeline, participants, negotiation
  reference. Read-only — no admin mutation endpoints in this feature.

Do NOT build admin transaction editing/moderation actions. Do NOT touch frontend/mobile.

Then: run only the transaction-related backend test files from Prompts 2-7 and fix any regressions — don't
run the full unrelated suite.

Update tracking doc's APIs (admin) section and note the read-only-by-design decision under "Known
limitations".

---

## Prompt 8 — Web: Negotiation "Continue Transaction" wiring + My Transactions + workspace shell

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md` (all backend APIs now exist).

Scope: `frontend/src/routes/negotiations.$id.tsx` (wire the "Continue Transaction" action to create/open the
transaction), a new `frontend/src/routes/my-transactions.tsx` (or similar, following the flat-file routing
convention seen in `my-leads.tsx`), replace the placeholder in `transaction.$id.tsx` with a real workspace
shell, `frontend/src/lib/api/maskan.ts` (new calls for Prompt 4's endpoints), `lib/i18n/en.ts`+`ar.ts`
(replace/extend the existing `transactionPage.*` keys), `components/maskan/`.

Build:
- Negotiations detail: once a negotiation's status is `accepted`, "Continue Transaction" calls the
  create-or-open behavior (backend already guarantees idempotency) and navigates to
  `/transaction/$id`.
- `My Transactions` page: Active/Completed/Cancelled tabs, cards per brief section 5 (image, rent/buy,
  district, amount, status, progress, next action, last activity). Link from the customer account area
  (wherever `auth.tsx`'s account section already links to `my-leads.tsx`/saved items).
- Transaction workspace shell (`transaction.$id.tsx`): header (property image/title/district, rent-or-buy
  chip, agreed amount, reference, status, progress stepper per brief section 20, mediator, action buttons —
  Message Mediator/View Property/View Agreement Summary/Ask myMakan) + Next Best Action card + tab/section
  scaffolding for Overview/My Information/Documents/Checklist/Activity/AI Assistant (bodies built in Prompt
  9). Skeleton loading + error/retry + empty states.

Do NOT build the tab bodies yet (Prompt 9), and do NOT touch mobile/partner/admin. Arabic RTL must work.

---

## Prompt 9 — Web: Workspace tab bodies (Information, Documents, Terms, Confirm, Activity, AI, Cancel)

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`. Treat Prompt 8's shell as the
mount point — do not rebuild it.

Scope: `frontend/src/routes/transaction.$id.tsx` (fill in the tab bodies), new components under
`frontend/src/components/maskan/` for reuse by mobile's equivalent later, `lib/api/maskan.ts`, i18n files.

Build each section per brief sections 8-15:
- My Information: required/optional fields, edit + save via Prompt 4's PATCH endpoint.
- Documents: per-document card (type, label, required badge, status chip, upload control, "Update Required"
  reason display when applicable), upload/delete wired to Prompt 4.
- Agreed Commercial Terms: read-only canonical values (rent or buy variant per brief section 13) — no
  free-form edit path.
- Information Confirmation: "My information is correct" action + timestamp display (label exactly
  "Information Confirmation", never "Sign Contract").
- Activity: timeline rendered from backend event/status timestamps (not duplicating lead chat).
- Ask myMakan: quick-action buttons from Prompt 6's customer set, response rendered as assistant text with a
  visible AI label.
- Message Mediator: opens/reuses the existing lead-chat thread (reuse whatever `lead.$leadId.tsx` already
  does — don't build a parallel thread).
- Cancellation: reason picker (brief section 23 examples) + confirm, respecting existing permission rules.

Do NOT touch mobile/partner/admin. Visual bar: this is investor-facing — real stepper/timeline component,
not a bare list. Test both locales.

---

## Prompt 10 — Partner web: Transactions list + detail

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: new `frontend/src/routes/partner.transactions.tsx` + `partner.transactions.$id.tsx` (mirror
`partner.negotiations.tsx`/`partner.negotiations.$id.tsx`'s structure and auth guard exactly),
`lib/api/maskan.ts` (Prompt 5's endpoints), i18n files.

Build:
- List: Action Required / Active / Ready / Completed / Cancelled tabs; row/card per brief section 11
  (reference, property, customer, rent/buy, amount, progress, status, next action, last updated).
- Detail: transaction summary, progress checklist, customer information (only the fields the partner API
  returns — never over-fetch), documents with View/Accept/Request Update (reason-required modal for
  request-update, shows "Please upload a clearer copy."-style placeholder text), Information Confirmation
  action, AI Assistant with the mediator quick-action set from Prompt 6, timeline.

Do NOT touch customer web, mobile, or admin.

---

## Prompt 11 — Mobile: My Transactions + workspace parity

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`. Treat Prompts 8-9 as the
reference implementation — mirror their behavior and copy, not the pixel layout; this is the parity-critical
prompt.

Scope: replace the placeholder in `mobile/app/transaction/[id].tsx`, new `mobile/app/my-transactions.tsx` (or
under an existing profile-adjacent folder — check how `my-bookings.tsx`/`saved.tsx` are wired into the
profile tab first and match it), `mobile/src/components/` (new transaction components — compact mobile-native
layout per brief, e.g. vertical stepper, no horizontal overflow), `mobile/src/lib/api/maskan.ts`,
`mobile/src/lib/i18n/`.

Build: everything from Prompts 8-9's web scope — My Transactions (tabs), workspace header + Next Best Action
+ progress stepper, My Information, Documents (upload via device picker), Terms, Confirm Information,
Activity, Ask myMakan, Message Mediator (reuse existing mobile lead-chat screen), Cancellation. Read
`AGENTS.md` in `mobile/` first (Expo version pinned — check the versioned docs before writing any
Expo-specific code).

Do NOT touch web, partner, or admin. Do NOT add a partner-portal surface to mobile — none exists today.

---

## Prompt 12 — Web + Mobile: Buy-specific verification pass

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: whatever files from Prompts 8-11 need adjustment — this is a verification/fix prompt, not new
surface area.

Do: walk through the BUY flow (brief sections 25 + the Buy investor-demo storyline) on both web and mobile
using data from a `sale`-type accepted negotiation. Confirm: purchase-price wording (not "rent"), buyer
terminology where the brief specifies it, buy checklist final state renders exactly "Ready for Sale Process",
buy document template is the conservative one from Prompt 2 (not the rent one), partner buy view shows
correct terms. Fix any rent-only copy/logic that leaked into the buy path. Do NOT start new functionality.

Update tracking doc if any buy-path gaps required a fix worth recording.

---

## Prompt 13 — Admin web: minimal Transactions list + detail

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md`.

Scope: new `frontend/src/routes/admin_.transactions.tsx` (mirror `admin_.property-requests.tsx`'s
flat-file/permission convention), wired to Prompt 7's read-only admin endpoints, i18n files.

Build: list (reference, type, property, customer, mediator, amount, status, progress, created, last
activity) with basic filters; detail view (checklist, document statuses, timeline, participants, negotiation
reference) — read-only, no mutation actions, per brief section 22.

Do NOT touch customer, partner, or mobile. Do NOT add any admin transaction-editing capability.

---

## Prompt 14 — Tests, parity doc, demo verification, progress doc finalization

Read `CLAUDE.md` and `docs/implementation/mymakan-transaction-workspace.md` (should now have incremental
sections from Prompts 1-13).

Scope: `backend/tests/`, any missing frontend/mobile test coverage, `docs/implementation/mymakan-customer-parity.md`,
`docs/implementation/mymakan-transaction-workspace.md`.

Do:
- Run only the affected backend test files across the whole feature and fix any regressions — don't run the
  full unrelated suite.
- Typecheck/build the affected web and mobile surfaces; use the `run` skill to click through both investor
  demo storylines if practical:
  RENT — Property → AI Match → Intelligence → Trust → Viewing → Negotiation → Offer Accepted → Continue
  Transaction → Transaction Workspace → 35% → Complete Customer Information → Upload Document → Partner
  Reviews → Update Requested → Customer Updates → Partner Accepts → Confirm Commercial Information → 100% →
  "Ready for Rental Contract Process".
  BUY — Property → Offer Accepted → Transaction Workspace → Buyer Information → Documents → Mediator Review
  → Confirmation → "Ready for Sale Process".
- Update `docs/implementation/mymakan-customer-parity.md`: add every capability from brief section 26 (My
  Transactions, detail, progress, My Information, documents, update-requested, terms, confirm information,
  activity, message mediator, Ask myMakan, cancellation) with a web/mobile parity result — no unresolved gaps.
- Finalize `docs/implementation/mymakan-transaction-workspace.md`: models, statuses, checklist/progress
  methodology, APIs, customer/mobile/partner/admin screens, document handling, AI usage, security, tests,
  known limitations, future Ejar/Nafath/payment integration boundaries, investor demo flow.

Report only: files changed, models/APIs added, customer web status, mobile status, partner status, parity
result, tests/build results, known limitations, progress document path. This is the final prompt in the
sequence.
