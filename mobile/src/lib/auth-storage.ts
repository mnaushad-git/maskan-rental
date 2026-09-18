import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { AuthUser } from "./api/maskan";

const TOKEN_KEY = "maskan_token";
const USER_KEY = "maskan_user";

// expo-secure-store's web fallback throws `ExpoSecureStore.default.
// getValueWithKeyAsync is not a function` in this Expo 57 setup — an
// uncaught error at auth-context.tsx's mount-time useEffect that blocked
// every screen behind Expo's full-screen dev error overlay, since this is
// read unconditionally on first mount regardless of platform (see
// docs/testing/mymakan-e2e-test-report.md P2-00x). myMakan mobile targets
// iOS/Android, not web, so this just needs to not crash there — fall back
// to localStorage on web, same trust model the frontend/ web app already
// uses for the identical purpose (frontend/src/lib/auth-storage.ts).
const isWeb = Platform.OS === "web";

async function getItem(key: string): Promise<string | null> {
  if (isWeb) return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function readStoredToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function readStoredUser(): Promise<AuthUser | null> {
  const raw = await getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export async function writeStoredAuth(user: AuthUser, token: string): Promise<void> {
  await setItem(TOKEN_KEY, token);
  await setItem(USER_KEY, JSON.stringify(user));
}

export async function clearStoredAuth(): Promise<void> {
  await deleteItem(TOKEN_KEY);
  await deleteItem(USER_KEY);
}
