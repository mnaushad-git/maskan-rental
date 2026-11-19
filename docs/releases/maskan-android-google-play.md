# Maskan Android — Google Play release preparation

Status: code-side fixes committed locally on `feature/mymakan-phase1` (2026-11-20, not pushed).
Nothing has been built, uploaded, pushed or deployed.

## 1. Build profiles (`mobile/eas.json`)

| Profile | Use | Output | API |
|---|---|---|---|
| `development` | dev client | — | local `.env` (unchanged) |
| `preview` | internal QA APK | APK | **none set** — see §7 |
| `play-internal` | Google Play internal/closed testing | AAB, store-signed, versionCode auto-incremented (remote) | `https://maskanai.com/api` |
| `production` | extends `play-internal` | AAB | same |

```bash
cd mobile
eas build -p android --profile play-internal          # build only — not yet approved
eas submit -p android --profile play-internal          # track=internal, releaseStatus=draft
```

Safeguards:
- `play-internal` sets `MASKAN_RELEASE_BUILD=1`; `app.config.js` then refuses to evaluate unless
  `EXPO_PUBLIC_API_BASE_URL` is a public `https://` URL (rejects unset, `http://`, localhost,
  `10.x`, `192.168.x`, `172.16–31.x`). Verified: 4 bad values rejected, prod URL accepted,
  dev config unaffected.
- `src/lib/config.ts`: localhost fallback only in `__DEV__`; release bundles have no fallback.
- `mobile/.env` / `.env.local` (emulator `10.0.2.2`, localhost) are gitignored, so EAS cloud builds
  never upload them.
- No secrets in the app: the only embedded values are the API URL and the Android Maps SDK key
  (public by design, protected by restrictions — §3).

## 2. Android permissions (merged **release** manifest)

Inspected with `expo prebuild` + Gradle `processReleaseManifestForPackage` (before: 35 entries, after: 32).

| Permission | Source | Decision |
|---|---|---|
| ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION | expo-location | **Keep** — map "near me" + district onboarding (foreground only) |
| INTERNET, ACCESS_NETWORK_STATE | RN / libraries | Keep |
| POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, VIBRATE, `c2dm.permission.RECEIVE` | expo-notifications / FCM | Keep — push notifications |
| READ_APP_BADGE + launcher badge permissions (Samsung, HTC, Huawei, …) | ShortcutBadger (expo-notifications) | Keep — normal permissions, badge counts |
| BIND_GET_INSTALL_REFERRER_SERVICE | installreferrer (expo-application) | Keep — normal permission |
| FOREGROUND_SERVICE | androidx WorkManager | Keep — library-internal; no FGS-type permission declared |
| `com.maskanai.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | androidx | Keep — app-private signature permission |
| **SYSTEM_ALERT_WINDOW** | Expo template main manifest (in release too) | **Blocked** — dev overlay only |
| **READ/WRITE_EXTERNAL_STORAGE** (≤ API 32) | template, expo-file-system, expo-image | **Blocked** — documents use the system picker (SAF) |
| **USE_BIOMETRIC, USE_FINGERPRINT** | androidx.biometric via expo-secure-store | **Blocked** — `requireAuthentication` is never used |

Also pinned in `app.json`: expo-location `isAndroidBackgroundLocationEnabled: false`,
`isAndroidForegroundServiceEnabled: false` (no background location, no FOREGROUND_SERVICE_LOCATION).

Residual: expo-location's library manifest always declares
`expo.modules.location.services.LocationTaskService` with `foregroundServiceType="location"`.
It cannot start (no FOREGROUND_SERVICE_LOCATION permission). If Play Console asks for a
foreground-service declaration anyway, either declare "not used" or strip the service with a
small config plugin (`tools:node="remove"`).

Target SDK 36, min SDK 24, `allowBackup=true` (expo-secure-store configures backup exclusion).

## 3. Google Maps API key

The Android Maps SDK key is in `mobile/app.json` (`android.config.googleMaps.apiKey`, committed since
`2c7d540`); `app.config.js` prefers `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` when set (local `.env` holds the
same key). JS code does not use it. Not rotated or changed.

Required restrictions in Google Cloud Console → APIs & Services → Credentials → this key:

1. **Application restrictions → Android apps**, add package `com.maskanai.app` with each SHA-1:
   - **Play app signing key** — Play Console → the app → Test and release → App integrity → App signing
     → "App signing key certificate" SHA-1. (Internal/closed testing installs are Play-signed: without
     this the map is blank for testers.)
   - **Upload key** — `eas credentials -p android` → the keystore's SHA-1 (also signs `preview` APKs).
   - Optional: the local debug keystore SHA-1 — better a separate dev key.
2. **API restrictions → Restrict key → Maps SDK for Android** only.
3. Quotas / budget alert on the project.

Do not reuse this key for the web (`VITE_GOOGLE_MAPS_API_KEY`: HTTP-referrer restricted to
`https://maskanai.com/*`) or the backend (`GOOGLE_MAPS_API_KEY` / `GOOGLE_PLACES_API_KEY`: IP-restricted
to the VPS, Places/Distance Matrix only). Because the Android key is in git history, rotating it is
reasonable — **requires approval**.

## 4. Account deletion

- API: `GET /api/auth/me/deletion-eligibility`, `POST /api/auth/me/delete` `{password, confirmation:"DELETE"}`
  (rate-limited 5/h per user; wrong password → 403, never 401).
- App: Profile → Delete account (`mobile/app/delete-account.tsx`). Web: `https://maskanai.com/account/delete`.
- Logic: `backend/app/services/account_deletion.py` — one transaction:
  - **Blocks** while open: partner (mediator) account, active transaction, open negotiation,
    requested/confirmed viewing, upcoming booking, draft/pending/active contract, open lead, non-draft
    active property request, pending payment. Admin accounts can't self-delete.
  - **Deletes**: devices, notifications (+deliveries), notification preferences, saved searches (+matches),
    saved properties, home-finder searches, digest runs, financing interests.
  - **Anonymises**: user row (email → `deleted-user-<id>-<rand>@deleted.maskanai.invalid`, name/phone/
    verification ref/card token cleared, random password, `is_active=false`, `deleted_at`), lead contact
    snapshots, review author names; detaches analytics + AI-usage rows; cancels draft property requests
    and active premium.
  - **Keeps**: transactions, bookings (incl. guest name/phone), contracts, payments, negotiations,
    viewings, transaction documents — the users row stays, so no RESTRICT/CASCADE side effects.
  - **Sessions**: `is_active=false` makes every issued JWT fail (`deps.user_from_token`).
  - **Audit**: `account.self_deleted` entry with counts; when financial records are retained it also
    stores name/email/phone (`retained_identity`) — decision D4.
- Admin `DELETE /api/users/{id}` (admin-only) now uses the same service instead of a hard delete: same
  blockers (409 with blocker codes), same retention, sessions revoked; refuses admin targets and the
  acting admin (403); already-deleted/unknown → 404. Audited as `account.admin_deleted` (audit
  `user_id` = admin, metadata `initiated_by: "admin"`, `admin_user_id`) vs `account.self_deleted`
  (`initiated_by: "self"`).

## 5. Backend compatibility (mobile app ↔ production `b2141d3`)

125 distinct mobile API calls (`mobile/src/lib/api/maskan.ts`) compared against OpenAPI specs generated
from both trees with production feature flags (paths, methods, parameters, request/response fields two
levels deep, auth):

- **111 compatible** — identical request/response shapes in production and branch.
- **3 changed, backward-compatible**: `GET /properties/{id}/duplicate-check`, `/similar`, `/trust` gained
  *optional* auth in the branch (`get_optional_current_user`; invalid tokens resolve to anonymous).
- **2 missing in production**: `/auth/me/delete`, `/auth/me/deletion-eligibility` (new) → requires deploy.
- **9 disabled in production and branch** (feature flags off by default): bookings ×5
  (`FEATURE_BOOKING`), financing ×1 (`FEATURE_FINANCING`), projects ×3 (`FEATURE_PROJECTS`).
  Projects/Bookings tabs are hidden (`href: null`) and the financing sheet is never rendered. The
  booking calendar and unit rules render for `is_bookable` listings (4 of 149 in production); fixed
  server-side: `PropertyOut.is_bookable` is reported `false` unless `FEATURE_BOOKING` is on (stored column
  and list filter unchanged), so once this backend is deployed no client — including already-installed
  builds — shows the booking flow while the bookings API is disabled.
- No endpoint used by the app was removed; branch adds 6 paths (2 deletion, 4 partner/media).
- Migrations: production DB is at `f7a8b9c0d1e2`; the branch adds only `a1c2d3e4f5a6`
  (`users.deleted_at`, nullable, metadata-only, reversible; tested up/down/up).

## 6. Deployment dependencies (before the Play build reaches testers)

1. Backend from this branch incl. `alembic upgrade head` (`a1c2d3e4f5a6`) — the deletion endpoints.
2. Frontend from this branch — `/privacy` and `/account/delete` (the app links to `/privacy`;
   Play Console needs both URLs).
3. The other 7 unreleased branch commits (partner listing photos / media) ride along — the wider
   application release that still needs separate approval.

## 7. Decisions required

| # | Decision |
|---|---|
| D1 | Legal entity name, CR number, address; privacy contact email; support email for `/account/delete` |
| D2 | Hosting provider naming, server location, cross-border transfer statement (Anthropic, Google, Expo) |
| D3 | Applicable law (KSA PDPL?), lawful bases, user-rights statement and response time |
| D4 | Keep name/email/phone in the audit log when financial records exist (current default) — or not |
| D5 | Retention periods for transactions/bookings/contracts/payments/documents; backup retention |
| D6 | Lead contact snapshots are anonymised on deletion; bookings' guest name/phone kept unchanged — confirm |
| D7 | Active premium is cancelled on deletion without automatic refund — confirm |
| D8 | Minimum age; how users are told about policy changes; Arabic policy translation |
| D10 | `preview` profile has no API URL (release-mode APK) — point it at production or a staging API? |
| D11 | Rotate the committed Android Maps key? |

After D1–D8: resolve every `<ToConfirm>` in `frontend/src/components/maskan/PrivacyPolicy.tsx`, legal
review, set `POLICY_APPROVED = true` and `LAST_UPDATED`.

## 8. Remaining Google Play blockers (outside code)

- Privacy policy approved and deployed (D1–D8), `/account/delete` deployed.
- Play Console: Data safety form (location, personal info, financial info, photos/files = documents,
  app activity, device IDs = push token; data deleted on request: yes, with web URL), content rating,
  target audience, ads = none, app access instructions + a reviewer test account, store listing
  (512 px icon, 1024×500 feature graphic, phone screenshots).
- Maps key restrictions with the Play app-signing SHA-1 (§3) — after the first upload creates it.
- Push notifications: no Firebase config (`google-services.json` / FCM v1 key in EAS) — push won't be
  delivered on Android until added; production `FEATURE_PUSH_NOTIFICATIONS` is also off.
- Personal developer accounts created after Nov 2023: closed test with ≥ 12 testers for 14 days
  before production access.
- `npx expo-doctor`: 16 Expo packages are behind SDK 57 patch versions (`npx expo install --check`).
