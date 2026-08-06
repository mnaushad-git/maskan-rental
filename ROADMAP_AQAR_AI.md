# Maskan — Aqar Gap-Fill Roadmap & Session Budget Plan

> Living doc. A new Claude Code session should read **only this file** (not explore the whole repo) to know what's done and what's next. Update the Status table at the end of every session.

---

## Part 1 — Why the Claude usage limit keeps getting hit, and how to stop it

Root causes in how this project has likely been worked on so far:

1. **One giant session covering multiple features.** Each new feature triggers fresh codebase exploration (grepping, reading files) inside the same session, which is the most expensive thing an agent does. Cost compounds instead of resetting.
2. **No persisted plan.** Without a roadmap doc, every session re-derives "what exists, what's missing" from scratch by reading code — that's exactly what the audit above cost.
3. **No stop discipline.** Pushing through to "finish the feature" once a session is already long, instead of stopping at a clean checkpoint and continuing fresh.

Rules to follow going forward:

- **One feature = one session.** Start a new session (or `/clear`) per item in Part 2. Never chain two features in one continuous session.
- **Bootstrap cheap.** At the start of a session, point Claude at this file and the specific files listed under that feature — don't ask it to "explore the codebase" again.
- **Define done before starting.** Use the acceptance criteria listed per feature so the session has a clear stopping point instead of sprawling.
- **Checkpoint and stop.** End every session with: commit the work, update the Status table below, note what's left in "Next step" — even if the feature isn't 100% finished. A half-finished feature with a clear note costs nothing extra next session; a session that runs until it hits the limit mid-thought does.
- **Match model to task.** Reserve heavier reasoning for design/architecture decisions; routine CRUD/UI implementation doesn't need it.
- **Watch `/cost`.** If one feature is burning far more than others, that's a signal to split it into two sessions rather than push through.

---

## Part 2 — Prioritized Aqar gap-fill features (AI-flavored)

Confirmed by codebase audit (2026-08-05): Maskan already has map search, saved-search alerts, and full notification infra — those are **not** gaps. The real gaps vs. Aqar, in priority order:

### 1. Digital Rental Contract Management (Ejar-equivalent)
- **Aqar has:** users manage official Ejar rental contracts digitally inside the app.
- **Maskan gap:** fully absent — no contract/lease model or route exists at all (only a dummy "Contract signed" analytics string).
- **AI flavor:** an AI Contract Assistant that reads the lease terms and flags anything unusual vs. typical Saudi rental norms ("this deposit is 2x the district average," "no maintenance clause found") before the tenant signs — reuses the existing `ai.py` chat infra.
- **Why it fits one session:** new model + route (`backend/app/models/contract.py`, `routes/contracts.py`) + one frontend page; no dependency on other gaps.
- **Acceptance criteria:** tenant can generate a contract from an accepted lead, both parties can view/download it, AI Assistant surfaces at least 3 categories of flags.
- **Backend done (session 1):** `backend/app/models/contract.py` (`Contract` model: lead_id unique FK, tenant_user_id, landlord_mediator_id, property_id, rent_amount, deposit_amount, start_date/end_date, status `draft`→`pending_signature`→`active`→`expired`, separate `tenant_signed_at`/`landlord_signed_at`), migration `f1a2b3c4d5e6_add_contracts.py`, routes in `backend/app/api/routes/contracts.py` mounted at `/api/contracts`:
  - `POST /api/contracts/` — create from an accepted lead (`lead_id`, optional `property_id`, `rent_amount`, `deposit_amount`, `start_date`, `end_date`); caller must be the lead's tenant or its accepted mediator; 409 if a contract already exists for that lead.
  - `GET /api/contracts/my` — contracts where the caller is tenant or landlord mediator.
  - `GET /api/contracts/{id}` — fetch (tenant/landlord/admin only).
  - `POST /api/contracts/{id}/sign` — role-aware signing; flips to `active` once both signed, lazily flips to `expired` past `end_date` on read.
  - **Not yet done:** AI Contract Assistant flags (reuse `ai.py`), frontend page, PDF/download.

### 2. Renter Identity Verification (Nafath-style)
- **Aqar has:** all advertisers verified via Nafath (Saudi national SSO).
- **Maskan gap:** verification exists only for mediators (`Mediator.is_verified` flag, admin-set manually); no renter/tenant identity verification at all.
- **AI flavor:** AI-assisted trust score combining verification status + review history + response rate into a single "Trust Badge," shown next to the existing rental score.
- **Why it fits one session:** can start with a mock/manual verification flow (mirroring the existing mediator pattern) rather than a real Nafath integration, which is a separate infra project.
- **Acceptance criteria:** renter can submit ID for verification, admin can approve (reuse mediator approval UI pattern), verified badge shows on profile/reviews.
- **Done (backend + frontend, one combined session since the earlier "backend done" session prompt was never actually run):**
  - Backend: `User.verification_status`/`is_verified`/`verification_document_ref`/`verification_submitted_at`/`verification_reviewed_at` fields (migration `a1b2c3d4e5f7`), routes in `backend/app/api/routes/verification.py` mounted at `/api/verification` — `POST/GET /me` (renter submit/status), `GET /admin/pending`, `POST /admin/{user_id}/approve`, `POST /admin/{user_id}/reject` (mirrors `mediators.py`'s approve/reject pattern). Exposed on `GET /auth/me` and `UserOut`. `GET /api/users/me/trust-metrics` returns the raw signals (verification, approved review count, lead response rate from `LeadMessage`) for the badge. `Review.reviewer_is_verified` (joined) exposed on `ReviewOut` for the mediator review list.
  - Frontend (mobile only — no renter-facing "profile" screen exists on the web app, only `mobile/app/(tabs)/profile.tsx`): `mobile/src/lib/trustScore.ts` (deterministic weighted formula: 50% verification / 25% review history / 25% response rate → `trusted`/`building`/`new` tier), `mobile/src/components/TrustBadge.tsx` (compact chip + full breakdown card), `mobile/app/verification.tsx` (submit/status screen), wired into the profile screen (badge chip + status row) and the mediator review list (`agent/[id].tsx`, "Verified" chip per reviewer).
  - **Not done:** no admin UI for verification review (API-only, admin can call it directly — same scope call as other admin approval flows in this codebase); no equivalent on the web frontend (renters don't have a profile page there yet).

### 3. Renter-Facing Premium Tier
- **Aqar has:** "Aqar Plus" — paid tier with extra search/filtering/marketing tools.
- **Maskan gap:** subscriptions exist only on the mediator (B2B/landlord) side; nothing for renters.
- **AI flavor:** premium unlocks "AI Alert Plus" — instant (not daily/weekly) AI-summarized alerts on saved searches, and unlimited AI Advisor chat vs. a free-tier message cap.
- **Dependency note:** the existing mediator subscription payment is currently **mocked** (no real Moyasar call yet — see `mediators.py:62-63,116` TODO). Fix that gateway integration first, or this tier will inherit the same mock, which is fine for a demo but worth flagging explicitly so it's a conscious choice, not a surprise later.
- **Why it fits one session:** mostly reuses the existing subscription model/pattern from `Mediator`, applied to `User`.
- **Acceptance criteria:** renter can subscribe, gated features actually check the subscription flag, downgrade/expiry works.

### 4. Short-Term Stay Booking
- **Aqar has:** book short-term stays directly in-app (date-range booking, not just a lead).
- **Maskan gap:** fully absent — platform only models long-term leads, no check-in/check-out or booking concept anywhere.
- **AI flavor:** AI dynamic pricing suggestion for landlords (suggest nightly rate based on area intelligence + season) and an AI availability assistant for renters ("this property is usually booked 2 weeks out").
- **Why it's biggest / split into 2 sessions:** needs a new booking/availability model, calendar UI, and a real payment flow — largest net-new surface area of all five gaps. Session A: data model + backend availability/booking API. Session B: frontend calendar UI + AI pricing/availability features.
- **Acceptance criteria (session A):** booking model with date ranges, conflict prevention at the DB level, API to create/list bookings. (session B): renter can pick dates and book, landlord sees calendar.

### 5. Rent Financing / Pay-Later
- **Aqar has:** "Rent Now, Pay Later" installment financing via partners (Rise, Ijari).
- **Maskan gap:** fully absent — `payment.py` only covers platform-to-mediator billing (subscriptions, lead pickups), not renter financing.
- **AI flavor:** AI affordability advisor — given a renter's stated budget, suggests an installment plan and flags if a property is a stretch vs. their profile.
- **Why lowest priority:** depends on a real payment/financing partner integration (external business relationship), not just code — lower value to build until that's lined up. Do last, or treat as a stub/waitlist feature until a partner is confirmed.
- **Acceptance criteria:** at minimum, a "Request financing" interest-capture flow (no real money movement) that feeds a waitlist — full integration is a separate future project once a partner is chosen.

### Bonus (not an Aqar gap, but relevant to "AI on every feature")
The current **AI Rental Score / Fair Rent Analysis is a client-side heuristic** (`frontend/src/lib/api/maskan.ts:231,267`), not an actual model call — unlike the AI Advisor and Area Intelligence, which are real backend AI. Worth a small session to move scoring server-side through the existing `ai.py` infra so all five "AI-flavored" features are consistently backed by real AI, not a mix of heuristic and real.

---

## Part 3 — Status tracking

| # | Feature | Status | Session(s) used | Next step |
|---|---|---|---|---|
| 1 | Digital rental contracts + AI assistant | Done | 2 | — |
| 2 | Renter identity verification + AI trust badge | Done | 1 | — |
| 3 | Renter premium tier + AI Alert Plus | Not started | — | Fix mocked Moyasar payment first (decide: fix now or accept mock) |
| 4a | Short-term booking — backend | Not started | — | Design booking/availability model |
| 4b | Short-term booking — frontend | Not started | — | Depends on 4a |
| 5 | Rent financing (waitlist stub) | Not started | — | Low priority — do last |
| Bonus | Server-side AI rental scoring | Not started | — | Move heuristic in `maskan.ts` into `ai.py` |

Update this table at the end of every session, even for partial progress.
