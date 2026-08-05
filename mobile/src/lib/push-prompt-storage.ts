import AsyncStorage from "@react-native-async-storage/async-storage";

// Mirrors src/lib/onboarding-storage.ts's flag pattern for the location
// pre-prompt — same idea, different feature: "has the user already been
// shown the custom in-app push-permission explainer once?" so contextual
// trigger points (saving a search with push on, sending a lead, opening
// the Notification Center, enabling a saved-search alert) don't nag the
// user with it repeatedly after they've made a choice.
const PUSH_PROMPT_SEEN_KEY = "myhome_push_prompt_seen";

export async function hasSeenPushPrompt(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUSH_PROMPT_SEEN_KEY)) === "1";
  } catch {
    return true; // fail safe: never block the app if storage is unavailable
  }
}

export async function markPushPromptSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_PROMPT_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}
