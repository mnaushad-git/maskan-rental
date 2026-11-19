// Runtime API configuration.
//
// EXPO_PUBLIC_API_BASE_URL is inlined into the JS bundle at build time:
//  - Google Play builds get it from the build profile's `env` in eas.json
//    (https://maskanai.com/api) and app.config.js refuses to build a release
//    profile without an https:// value.
//  - Local development reads mobile/.env (e.g. the emulator's 10.0.2.2) or
//    mobile/.env.local; both are gitignored and never uploaded to EAS.
//
// The localhost fallback exists only in development (__DEV__). A release
// bundle has no fallback, so a misconfigured build fails loudly on the first
// request instead of quietly talking to a developer machine.
const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");

export const API_BASE_URL: string = configured || (__DEV__ ? "http://localhost:8000/api" : "");

if (!API_BASE_URL) {
  console.error("EXPO_PUBLIC_API_BASE_URL is not set for this release build — API requests will fail.");
}
