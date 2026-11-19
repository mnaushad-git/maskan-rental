// Release-build guard: Google Play profiles in eas.json set MASKAN_RELEASE_BUILD=1
// together with EXPO_PUBLIC_API_BASE_URL. A release must never be built against
// a developer machine (localhost / 10.0.2.2 / LAN IP) or over plain http — fail
// the build at config time instead of shipping an app that can't reach the API.
// (EAS_BUILD_PROFILE is not available when app.config.js is evaluated locally,
// hence the explicit flag.)
const isReleaseBuild = process.env.MASKAN_RELEASE_BUILD === "1";

if (isReleaseBuild) {
  const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const devHost = /\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (!apiUrl.startsWith("https://") || devHost.test(apiUrl)) {
    throw new Error(
      `Release build requires EXPO_PUBLIC_API_BASE_URL to be a public https:// URL (got "${apiUrl || "<unset>"}").`,
    );
  }
}

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android.config,
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? config.android.config.googleMaps.apiKey,
      },
    },
  },
});
