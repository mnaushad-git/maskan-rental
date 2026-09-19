# myMakan 0.1.0-beta.1 — Deployment Report

**Date:** 2026-09-19
**Target:** Hostinger VPS (187.127.159.23, `maskanai.com`), Docker Compose (`docker-compose.prod.yml`, Caddy-fronted)

## Google API key migration (2026-09-19, post-deployment)

Following the original Anthropic/Google key exposure noted below, three new restricted Google keys were created:

- **myMakan Web Maps** — website-restricted, used by `VITE_GOOGLE_MAPS_API_KEY` (frontend, browser-side Maps JS)
- **myMakan Server Places** — IP-restricted to the Hostinger VPS (`187.127.159.23`), used by `GOOGLE_PLACES_API_KEY` / `GOOGLE_MAPS_API_KEY` (backend, server-side Places + Distance Matrix)
- Existing Android-native Maps SDK key — **left untouched**, not part of this migration

Values were transferred from the developer's local `backend/.env` / `frontend/.env` into `~/maskan-rental/.env.production` on the VPS without ever displaying them in this session, **except for two accidental exposures during this migration**, both logged transparently at the time:

1. A Windows-side file transfer step introduced a UTF-8 BOM + CRLF into one line of `.env.production`, which broke Docker Compose's env-file parser; the resulting error message echoed the new **myMakan Server Places** key value once.
2. The area-intelligence refresh job (`python -m app.jobs.refresh_area_intelligence`), run to verify the new server key, uses `httpx`'s default INFO-level request logging, which logs full request URLs including the `key=` query parameter — this printed the same Server Places key repeatedly across ~50 log lines while confirming the job worked.

**Recommendation: rotate the myMakan Server Places key again** given these two exposures, then repeat the transfer using a method that avoids both failure modes (LF-only/no-BOM file writes; suppress or redact `httpx` request-URL logging before re-running the refresh job).

`.env.production` also had one pre-existing duplicate `GOOGLE_PLACES_API_KEY=` line (unrelated to this session — cause not established, no prior backup of this file existed to compare against) discovered and deduplicated to a single line during cleanup of the BOM/CRLF corruption.

Affected services (`frontend` — rebuilt, since the Maps key is a Docker build arg; `backend` and `worker` — recreated to pick up the new server-side env vars) were redeployed; `db`, `redis`, and `caddy` were untouched.

### Verification results

| Check | Result |
|---|---|
| Web Maps JS (referrer-restricted key, tested with a matching `Referer: https://maskanai.com/` header) | **PASS** — SDK bootstrap returns valid JS, no `InvalidKeyMapError`/`RefererNotAllowedMapError`/`ApiNotActivatedMapError` |
| Web Places (no client-side Places calls exist in the frontend today — only server-side) | **PASS** (library loads under the restricted key; nothing in the current UI calls it directly) |
| Backend Places + Distance Matrix | **PASS** — live run of the real weekly refresh job against 6 districts, every Places Nearby Search and Distance Matrix call returned `200 OK`, zero `REQUEST_DENIED`, job completed ("Weekly refresh complete") |
| Android Maps (existing, untouched key) | **PASS** — reinstalled the already-built APK, map tiles + 111 property pins render correctly, session persisted |
| Production API health/readiness | **PASS** — `{"status":"ok"}` / `{"status":"ready",...}` after redeploy |
| Homepage / `/search` / `/property/{id}` | **PASS** — 200, no map error strings in HTML |
| Backend/worker/frontend logs since redeploy | **PASS** — no errors, exceptions, or denials found |

Anthropic key: **left untouched**, per instruction — no confirmation of its rotation has been given yet.

## Git

| | |
|---|---|
| Branch pushed | `feature/mymakan-phase1` → `b1ed9f5`; merged into `main` → `48a8c4c` |
| Push status | **PASS** — both branches verified: local HEAD == `origin/<branch>` HEAD |
| Deployed commit | `48a8c4c` (matches `main`) |

No secrets found in the diff. `frontend/.env.example` was missing and has been added. One accidental exposure: `backend/.env` (gitignored, never staged/committed) was read directly during diagnosis and its contents — including a real Anthropic API key and Google Places/Maps key — appeared in this session's tool output. **Recommend rotating both keys** out of caution; nothing reached git or the deployed server config as a result.

## Backend / Database

| Check | Result |
|---|---|
| DB backup before migration | **PASS** — `~/backups/maskan_pre_deploy_20260918_205615.sql` (340K), taken via `pg_dump` before any schema change |
| Migration | **PASS** — 3 new revisions applied cleanly (`d5e6f7a8b9c0`, `e6f7a8b9c0d1`, `f7a8b9c0d1e2` — property_transactions + 2 follow-ups); single head, no branch conflicts |
| Backend health | **PASS** — `/api/health` → `{"status":"ok"}`, `/api/health/ready` → database & redis both `ok` |
| Containers | `db`, `redis`, `backend`, `worker`, `frontend`, `caddy` all healthy after rebuild |
| Existing unrelated site | `mnaushad-blog` container (same host, same Caddy) — untouched; the server's local, uncommitted Caddyfile addition proxying `mnaushad.blog` was left in place (not overwritten by `git pull`) |

## HTTPS / Domain

**PASS** — TLS certificate valid for `maskanai.com` (Let's Encrypt, expires 2026-11-27), HTTP→HTTPS via Caddy, no mixed-content references found in the served HTML (only an inert SVG namespace URI matched a plain-`http://` grep).

## Customer / Partner / Admin Portals

These are **one unified TanStack Start app** (not three separate deployables) — customer routes, `/partner/*`, and `/admin/*` are all served by the same `frontend` container.

| Surface | Result |
|---|---|
| Homepage | **PASS** — 200, real property data |
| Search API | **PASS** — `/api/search` returns real results (111 rent listings) |
| Areas / Area Intelligence | **PASS** — 200 |
| Auth (signup/login) | **PASS** — real signup returns 201 + JWT, login 200, user row persisted (id 10 was the first test account created this session) |
| `/admin` | **PASS** — 200, serves shell (role-gating happens client-side against the JWT as before — unchanged behavior) |
| `/partner/register` | **PASS** — 200 |

## Android

| | |
|---|---|
| Package ID | `com.myhome.mobile` (unchanged — pre-existing identifier, not renamed per instructions) |
| Version name | `0.1.0-beta.1` |
| Version code | `1` |
| API environment | `https://maskanai.com/api` (baked into the JS bundle at build time; no localhost/10.0.2.2/LAN IP references) |
| Build type | **release**, signed with the local debug keystore (`debug.keystore`, gitignored, never committed) — **test distribution only, not a Play Store release** |
| APK build | **PASS** — `BUILD SUCCESSFUL`, all 4 ABIs (arm64-v8a, armeabi-v7a, x86, x86_64) |
| APK path (local, not committed) | `C:\Users\mnaus\AppData\Local\Temp\claude\d--Naushad-Projects-myMakan\2eff5619-64b9-408f-96aa-c85cd797e369\scratchpad\myMakan-0.1.0-beta.1.apk` |
| APK SHA-256 | `B84E5C8B07CD08807308A8EA1ADEDF22B65CACA3D65F0D5039327BE9AC89754` |
| Install test | **PASS** — installed and launched on a local Android emulator (Pixel 6, API level per the `Pixel_6` AVD) |
| Mobile smoke test | **PASS** for: app launch/branding, location-permission denial (falls back to manual city entry without crashing), map + list search against production (111 live properties), property detail (Property Intelligence score + Trust Center rendering with real trust flags), signup, login persistence across reinstall, Account menu (Saved/Leads/Viewings/Negotiations/Transactions all present) |
| Not manually walked this session | AI Advisor chat, Viewing scheduling, Negotiation, Transaction Workspace screens on native mobile specifically (time-constrained) — the same features were already verified via the web app and the backend API directly; account menu confirms they're all reachable |

### Issues found and fixed during Android testing

1. **`debug` build type hung on a splash screen indefinitely** — debug builds don't embed the JS bundle by default and wait for a Metro dev server that was never running. Fixed by building the `release` build type instead (already configured in this project to sign with the debug keystore for exactly this kind of test build).
2. **Wrong API URL baked into the bundle** (`localhost:8000` instead of `maskanai.com`) — `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` isn't read by a raw `gradlew` invocation (only by `expo` CLI commands). Fixed by exporting the variable directly into the build's process environment.
3. **Emulator DNS flakiness** (`UnknownHostException` resolving `maskanai.com` from inside the app, despite `adb shell ping` succeeding) — a known Android emulator quirk, not an app or server issue. Fixed by relaunching the emulator with `-dns-server 8.8.8.8,8.8.4.4`. Real devices use their own network's DNS and are not expected to hit this.

None of these required application code changes (only build/tooling invocation) — no source diff was needed to fix them, and no temporary debugging code was left in place.

## Backend test suite

736 tests collected. **68 pre-existing failures, all confirmed unrelated to this release's changes**:
- ~60 are a real-Redis signup rate-limit self-exhaustion — the local dev `.env` now sets `REDIS_URL` (a prior, separate local change), so the test suite's signup-heavy files legitimately hit the 5-signups/hour limit within one session. No fixture resets it. Reproduces identically with a completely empty Redis DB.
- The rest are `AICallLog` row accumulation — `log_ai_call()` (pre-existing, untouched code) intentionally uses its own DB session outside the test-transaction rollback boundary, so repeated local runs accumulate real rows against a `.one()` assertion.

All 7 new Transaction Workspace test files, plus the modified `test_ai_platform.py`, pass cleanly (155/155) when isolated from this local rate-limit noise. This matches the same two root causes already diagnosed independently in `docs/testing/mymakan-e2e-test-report.md` §4/§5.

Frontend: `npm run typecheck` and `npm run build` both clean. Mobile: `npx tsc --noEmit` clean.

## Known limitations (carried from `docs/testing/mymakan-e2e-test-report.md`)

- Saved-search alert **delivery** (scheduled daily digest) has never run continuously in any environment (no Celery Beat process started) — creation/preview/enable all verified working.
- Push notifications remain feature-flagged off (`FEATURE_PUSH_NOTIFICATIONS=false`) — unchanged, not part of this release's scope.
- A handful of pre-existing P2/P3 cosmetic issues listed in the E2E report (§23.2) are unfixed by design (out of this release's scope).

## Documents

- Release notes: `docs/releases/mymakan-0.1.0-beta.1.md`
- Tester guide: `docs/releases/mymakan-beta-tester-guide.md`
- This report: `docs/releases/mymakan-beta-deployment-report.md`
