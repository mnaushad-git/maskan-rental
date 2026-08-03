import { useState } from "react";
import { View, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { signup } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";

export default function SignupScreen() {
  const { t } = useLanguage();
  const { setAuth } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (password.length < 6) {
      setError(t("auth.errors.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      const res = await signup({ email, password, full_name: fullName || undefined });
      await setAuth(res.user, res.access_token);
      router.back();
    } catch {
      setError(t("auth.errors.unableToCreate"));
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || !email || password.length < 6;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-6">
      <Text className="font-bold text-2xl text-foreground">{t("auth.createAccount")}</Text>
      <Text className="text-sm text-muted-foreground">{t("auth.signUpDesc")}</Text>

      <View className="gap-3">
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder={t("auth.fullName")}
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
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
          placeholder={t("auth.createPasswordPlaceholder")}
          secureTextEntry
          className="rounded-xl border border-border px-4 py-3 text-foreground"
        />
      </View>

      {error && <Text className="text-sm" style={{ color: "#DC2626" }}>{error}</Text>}

      <Button onPress={handleSubmit} loading={loading} disabled={!email || password.length < 6} fullWidth>
        {t("auth.createAccountBtn")}
      </Button>

      <View className="flex-row justify-center gap-1">
        <Text className="text-sm text-muted-foreground">{t("auth.alreadyMember")}</Text>
        <Link href="/auth/login" replace>
          <Text className="text-sm font-semibold text-primary">{t("auth.signIn")}</Text>
        </Link>
      </View>
    </SafeAreaView>
  );
}
