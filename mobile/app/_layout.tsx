import "../global.css";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";

import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/lib/i18n/context";

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
    <LanguageProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="property/[id]" options={{ headerShown: true, title: "" }} />
          <Stack.Screen name="auth/login" options={{ presentation: "modal", headerShown: true, title: "" }} />
          <Stack.Screen name="auth/signup" options={{ presentation: "modal", headerShown: true, title: "" }} />
          <Stack.Screen name="lead/new" options={{ headerShown: true, title: "" }} />
        </Stack>
      </AuthProvider>
    </LanguageProvider>
  );
}
