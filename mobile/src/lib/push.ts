import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRunningInExpoGo } from "expo";
import type * as NotificationsModule from "expo-notifications";
import * as Device from "expo-device";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { router } from "expo-router";
import { registerDevice, unregisterDevice, type RegisterDevicePayload } from "@/lib/api/maskan";
import { deepLinkToRoute } from "@/lib/deepLink";

/**
 * Real push notification registration + tap handling.
 *
 * Live-refresh design note: the backend exposes a Server-Sent Events stream
 * (`GET /notifications/stream`) for "someone else's action should update my
 * screen right now" (e.g. a saved-search digest firing server-side). React
 * Native has no native EventSource, so a real SSE client would need a
 * manual fetch()+ReadableStream reader (same pattern as this codebase's
 * `streamAdvisorChat` in api/maskan.ts). We deliberately did NOT build that
 * here: mobile already gets equivalent "instant" behavior for free —
 * background/terminated via native push, and foregrounded via
 * `Notifications.addNotificationReceivedListener` triggering an immediate
 * refetch (see NotificationBell.tsx and app/notifications.tsx) — plus the
 * existing 60s poll as a safety net if a push is ever dropped. A custom SSE
 * client would duplicate that coverage for extra complexity (reconnect
 * logic, token-in-query-param, backgrounding edge cases) with no user-
 * visible improvement, so it's left as a follow-up if a use case emerges
 * that pure push can't cover (e.g. web dashboard parity).
 *
 * Expo Go note: expo-notifications throws as an *import-time* side effect
 * (not just on specific function calls) when running inside Expo Go — push
 * notifications were removed from Expo Go entirely as of SDK 53. A
 * try/catch around a call site can't catch that, since the throw happens
 * while evaluating the package itself, before control ever returns here.
 * The module is therefore loaded lazily via `require`, only outside Expo
 * Go; every exported function below degrades to a no-op/null return when
 * `Notifications` is unavailable, so local dev in Expo Go works normally
 * aside from push itself (which genuinely cannot work there — use a dev
 * client build for that, per the error Expo itself points to).
 */
const Notifications: typeof NotificationsModule | null = isRunningInExpoGo()
  ? null
  : (require("expo-notifications") as typeof NotificationsModule);

const DEVICE_ID_KEY = "myhome_push_device_id";
const INSTALLATION_ID_KEY = "myhome_installation_id";

function androidChannels(): Array<{
  id: string;
  name: string;
  importance: NotificationsModule.AndroidImportance;
}> {
  const N = Notifications!;
  return [
    { id: "default", name: "General", importance: N.AndroidImportance.DEFAULT },
    { id: "property_alerts", name: "Property alerts", importance: N.AndroidImportance.HIGH },
    { id: "leads", name: "Leads & messages", importance: N.AndroidImportance.HIGH },
    { id: "security", name: "Security", importance: N.AndroidImportance.MAX },
  ];
}

// Foreground presentation: show a heads-up alert + play sound even while the
// app is open, so a lead message doesn't silently disappear into the
// Notification Center only.
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function setupAndroidChannelsAsync(): Promise<void> {
  if (Platform.OS !== "android" || !Notifications) return;
  for (const channel of androidChannels()) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: channel.importance,
      vibrationPattern: [0, 200, 200, 200],
    });
  }
}

async function getOrCreateInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  // expo-application's Android ID is the closest thing to a stable native
  // installation identifier; iOS has nothing equivalent exposed to JS
  // (identifierForVendor isn't surfaced by expo-application on this SDK),
  // so both platforms fall back to a locally generated + persisted UUID —
  // stable across app restarts, reset on reinstall (which is the desired
  // "installation" semantics anyway).
  const androidId = Platform.OS === "android" ? Application.getAndroidId() : null;
  const id = androidId ?? globalThis.crypto?.randomUUID?.() ?? `install-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, id);
  return id;
}

export async function getStoredDeviceRowId(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(DEVICE_ID_KEY);
  return raw ? Number(raw) : null;
}

async function storeDeviceRowId(id: number): Promise<void> {
  await AsyncStorage.setItem(DEVICE_ID_KEY, String(id));
}

async function clearStoredDeviceRowId(): Promise<void> {
  await AsyncStorage.removeItem(DEVICE_ID_KEY);
}

/** Returns the OS-level permission status without prompting — used to
 * decide whether the contextual pre-prompt is even necessary (already
 * granted / permanently denied both skip it). Resolves "undetermined" when
 * push isn't available at all (e.g. running in Expo Go). */
export async function getPushPermissionStatusAsync(): Promise<NotificationsModule.PermissionStatus> {
  if (!Notifications) return "undetermined" as NotificationsModule.PermissionStatus;
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/** Same as getPushPermissionStatusAsync, plus `canAskAgain` — used by the
 * notification settings screen to decide whether to prompt in-app or send
 * the user to OS settings instead. */
export async function getPushPermissionDetailsAsync(): Promise<{
  status: NotificationsModule.PermissionStatus;
  canAskAgain: boolean;
}> {
  if (!Notifications) {
    return { status: "undetermined" as NotificationsModule.PermissionStatus, canAskAgain: true };
  }
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return { status, canAskAgain };
}

/** Guarded pass-through for Notifications.addNotificationReceivedListener —
 * returns a no-op subscription when push isn't available (e.g. Expo Go), so
 * callers (NotificationBell, the notifications list) don't need their own
 * direct `expo-notifications` import (see the Expo Go note above: importing
 * that package at all is what throws, not just calling into it). */
export function addPushReceivedListener(
  listener: (notification: NotificationsModule.Notification) => void,
): { remove: () => void } {
  if (!Notifications) return { remove: () => {} };
  return Notifications.addNotificationReceivedListener(listener);
}

async function obtainTokenAndRegisterAsync(locale: string): Promise<string | null> {
  if (!Notifications) return null;
  await setupAndroidChannelsAsync();

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) {
    // Expected until `eas init` is run and a real EAS project id is added
    // to app.json's extra.eas.projectId — see final report for the exact
    // remaining step. Registering with the backend without a real Expo
    // push token would just create a device row that can never receive a
    // push, so we bail out here rather than send a bogus token.
    console.warn("[push] No EAS project id configured (app.json extra.eas.projectId) — cannot obtain an Expo push token. Skipping device registration.");
    return null;
  }

  let pushToken: string;
  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    pushToken = tokenResponse.data;
  } catch (err) {
    console.warn("[push] Failed to obtain Expo push token:", err);
    return null;
  }

  try {
    const installationId = await getOrCreateInstallationId();
    const payload: RegisterDevicePayload = {
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web",
      push_token: pushToken,
      installation_id: installationId,
      device_id: Device.osInternalBuildId ?? Device.modelId ?? undefined,
      app_version: Constants.expoConfig?.version ?? undefined,
      os_version: Device.osVersion ?? undefined,
      locale,
      device_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const device = await registerDevice(payload);
    await storeDeviceRowId(device.id);
    return pushToken;
  } catch (err) {
    console.warn("[push] Device registration with backend failed:", err);
    return null;
  }
}

/**
 * Requests the OS push permission (this is the real, one-shot native
 * prompt — callers must only invoke this from a user-initiated "Enable
 * notifications" tap, e.g. PushPermissionPrompt's "Enable notifications"
 * button, never on app launch, per the contextual pre-prompt requirement)
 * and, if granted, fetches the Expo push token and registers this device
 * with the backend. Returns the registered device's push token on success,
 * or null if permission was denied / push is unavailable (e.g. Expo Go) /
 * no EAS project id is configured / the request failed.
 */
export async function registerForPushNotificationsAsync(locale: string): Promise<string | null> {
  if (!Notifications) return null;
  if (!Device.isDevice) {
    console.warn("[push] Push notifications require a physical device or an emulator with Play services — proceeding anyway since Expo/Android emulators with Play services still work.");
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    return null;
  }

  return obtainTokenAndRegisterAsync(locale);
}

/**
 * Quiet re-registration: only proceeds if OS permission is ALREADY granted
 * (never prompts) — safe to call on every login/signup and app foreground
 * so the backend's device row / push token stays fresh across token
 * rotation and reinstalls, without ever surfacing a permission dialog
 * outside the contextual pre-prompt flow. Wired from auth-context.tsx
 * (post-login/signup) and app/_layout.tsx (foreground, already-logged-in).
 */
export async function reregisterIfPermittedAsync(locale: string): Promise<string | null> {
  if (!Notifications) return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return null;
  return obtainTokenAndRegisterAsync(locale);
}

/** Called on logout, before auth is cleared, so the right device row (the
 * one this install actually registered) gets unregistered server-side. */
export async function unregisterCurrentDeviceAsync(): Promise<void> {
  const id = await getStoredDeviceRowId();
  if (id == null) return;
  try {
    await unregisterDevice(id);
  } catch {
    // best-effort — if this fails (offline logout, etc.) the row just goes
    // stale server-side; it isn't a correctness problem for this user.
  } finally {
    await clearStoredDeviceRowId();
  }
}

/** Reads whatever `data.deepLink` the backend attached to a push payload
 * (see backend/app/core/notification_providers.py's `_message_for`) off a
 * notification response and returns the in-app route to navigate to. */
function routeFromResponse(response: NotificationsModule.NotificationResponse): string | null {
  const data = response.notification.request.content.data as { deepLink?: string } | undefined;
  return deepLinkToRoute(data?.deepLink ?? null);
}

/**
 * Mounts the two tap-handling listeners (foreground/background resume, and
 * background→tap) plus a one-time cold-start check
 * (`getLastNotificationResponseAsync`) for the "app was fully terminated
 * and launched by tapping a push" case. Call once near the root
 * (app/_layout.tsx) — see that file for the actual mount site. No-ops when
 * push isn't available (e.g. Expo Go).
 */
export function useNotificationTapHandler(): void {
  const navigate = useCallback((route: string | null) => {
    if (!route) return;
    // expo-router already dedupes pushing the exact same route twice in a
    // row within the same tick; there is no separate cold-start + listener
    // double-fire here because getLastNotificationResponseAsync only ever
    // resolves once per process lifetime (Expo clears it after first read).
    router.push(route as never);
  }, []);

  useEffect(() => {
    if (!Notifications) return undefined;

    // Cold start: app was terminated, user tapped a push to launch it.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) navigate(routeFromResponse(response));
    });

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      navigate(routeFromResponse(response));
    });
    return () => sub.remove();
  }, [navigate]);
}
