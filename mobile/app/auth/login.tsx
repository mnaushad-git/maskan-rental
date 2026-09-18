import { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { login } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";
import { colors } from "@/lib/colors";

export default function LoginScreen() {
  const { t } = useLanguage();
  const { setAuth } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const res = await login({ email, password });
      await setAuth(res.user, res.access_token);
      // Usually pushed from a protected screen's sign-in prompt, so back()
      // returns there. But this screen is also reachable with no back-stack
      // (e.g. a deep link) — router.back() then silently no-ops (dev-only
      // "GO_BACK not handled" warning, found testing the web target — see
      // docs/testing/mymakan-e2e-test-report.md P2-00x), leaving the user
      // looking at a stale login form despite being signed in.
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch {
      setError(t("auth.errors.invalidCredentials"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-6">
      <Text className="font-bold text-2xl text-foreground">{t("auth.welcomeBack")}</Text>
      <Text className="text-sm text-muted-foreground">{t("auth.signInDesc")}</Text>

      <View className="gap-3">
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("auth.emailAddress")}
          autoCapitalize="none"
          keyboardType="email-address"
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={t("auth.password")}
          secureTextEntry
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
      </View>

      {error && <Text className="text-sm" style={{ color: colors.destructive }}>{error}</Text>}

      <Button onPress={handleSubmit} loading={loading} disabled={!email || !password} fullWidth>
        {t("auth.signIn")}
      </Button>

      <View className="flex-row justify-center gap-1">
        <Text className="text-sm text-muted-foreground">{t("auth.dontHaveAccount")}</Text>
        <Link href="/auth/signup" replace>
          <Text className="text-sm font-semibold text-primary">{t("auth.signUp")}</Text>
        </Link>
      </View>
    </SafeAreaView>
  );
}
