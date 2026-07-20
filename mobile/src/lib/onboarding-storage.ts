import AsyncStorage from "@react-native-async-storage/async-storage";

// Mirrors frontend/src/components/maskan/LocationOnboarding.tsx's localStorage flag.
const ONBOARDING_KEY = "myhome_onboarding_done";

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === "1";
  } catch {
    return true; // fail safe: never block the app if storage is unavailable
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    // ignore
  }
}
