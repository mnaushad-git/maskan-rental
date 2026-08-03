import "../global.css";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/lib/i18n/context";
import { ToastProvider } from "@/components/ui/Toast";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

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
              <Stack.Screen name="leads/index" options={{ headerShown: true }} />
              <Stack.Screen name="lead/[id]" options={{ headerShown: true }} />
              <Stack.Screen name="agent/[id]" options={{ headerShown: true }} />
            </Stack>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}
