import "../global.css";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LanguageProvider, useLanguage } from "@/lib/i18n/context";
import { ToastProvider } from "@/components/ui/Toast";
import { reregisterIfPermittedAsync, useNotificationTapHandler } from "@/lib/push";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

/** Mounted once inside AuthProvider/LanguageProvider so it can read both —
 * handles the two push concerns that need to live at the app root rather
 * than any one screen:
 *  1. Notification tap → deep link (foreground listener + cold-start check
 *     via useNotificationTapHandler, see src/lib/push.ts).
 *  2. Re-registering the device on app foreground when already logged in —
 *     covers token rotation / reinstall safety. Quiet-only: never prompts,
 *     see reregisterIfPermittedAsync's doc comment. */
function PushLifecycle() {
  const { user } = useAuth();
  const { lang } = useLanguage();
  useNotificationTapHandler();

  useEffect(() => {
    if (!user) return;
    reregisterIfPermittedAsync(lang).catch(() => {});

    function handleAppStateChange(next: AppStateStatus) {
      if (next === "active") reregisterIfPermittedAsync(lang).catch(() => {});
    }
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, [user, lang]);

  return null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({});

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <PushLifecycle />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="property/[id]" options={{ headerShown: true, title: "" }} />
              <Stack.Screen name="auth/login" options={{ presentation: "modal", headerShown: true, title: "" }} />
              <Stack.Screen name="auth/signup" options={{ presentation: "modal", headerShown: true, title: "" }} />
              <Stack.Screen name="lead/new" options={{ headerShown: true, title: "" }} />
              {/* Consumer feature screens — give them native headers with a back button */}
              <Stack.Screen name="advisor" options={{ headerShown: true }} />
              <Stack.Screen name="areas/index" options={{ headerShown: true }} />
              <Stack.Screen name="areas/[name]" options={{ headerShown: true }} />
              <Stack.Screen name="methodology" options={{ headerShown: true }} />
              <Stack.Screen name="compare" options={{ headerShown: true }} />
              <Stack.Screen name="estimate" options={{ headerShown: true }} />
              <Stack.Screen name="lead/[id]" options={{ headerShown: true }} />
              <Stack.Screen name="agent/[id]" options={{ headerShown: true }} />
              <Stack.Screen name="notifications" options={{ headerShown: true }} />
              <Stack.Screen name="saved-searches" options={{ headerShown: true }} />
              <Stack.Screen name="notification-settings" options={{ headerShown: true }} />
              <Stack.Screen name="property-requests/index" options={{ headerShown: true }} />
              <Stack.Screen name="property-requests/new" options={{ headerShown: true }} />
              <Stack.Screen name="property-requests/[id]" options={{ headerShown: true }} />
            </Stack>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}
