import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { AlertTriangle } from "lucide-react-native";
import {
  deleteMyAccount,
  fetchAccountDeletionEligibility,
  UnauthorizedError,
  type AccountDeletionEligibility,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { forgetCurrentDeviceAsync } from "@/lib/push";
import { useLanguage } from "@/lib/i18n/context";
import { Button } from "@/components/ui/Button";
import { colors } from "@/lib/colors";

const CONFIRMATION_WORD = "DELETE";
const PRIVACY_URL = "https://maskanai.com/privacy";

/** Self-service account deletion (Google Play account-deletion policy).
 * Requires the current password (re-authentication) and typing DELETE; the
 * backend refuses while obligations are open (active transaction, scheduled
 * viewing, …) and returns the reasons, which are shown before the form. */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, clearAuth } = useAuth();
  const [eligibility, setEligibility] = useState<AccountDeletionEligibility | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setEligibility(await fetchAccountDeletionEligibility());
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) setLoadError(e instanceof Error ? e.message : t("deleteAccount.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!user && !submitting) router.replace("/auth/login");
  }, [user, submitting, router]);

  const confirmed = confirmation.trim().toUpperCase() === CONFIRMATION_WORD;

  function handleDelete() {
    setError(null);
    Alert.alert(t("deleteAccount.finalTitle"), t("deleteAccount.finalBody"), [
      { text: t("deleteAccount.cancel"), style: "cancel" },
      { text: t("deleteAccount.confirmButton"), style: "destructive", onPress: submit },
    ]);
  }

  async function submit() {
    setSubmitting(true);
    try {
      await deleteMyAccount(password, confirmation.trim());
      // The server already deactivated the account and deleted its push
      // devices. Forget the local device id first so clearAuth() doesn't call
      // DELETE /devices/{id} with the revoked token (that 401 would re-trigger
      // the global sign-out listener).
      await forgetCurrentDeviceAsync();
      await clearAuth().catch(() => {});
      Alert.alert(t("deleteAccount.doneTitle"), t("deleteAccount.doneBody"));
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteAccount.genericError"));
      // The account may have gained an obligation meanwhile — refresh reasons.
      load();
    } finally {
      setSubmitting(false);
      setPassword("");
    }
  }

  if (!user) return null;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: t("deleteAccount.heading") }} />
      <ScrollView contentContainerClassName="gap-4 p-6">
        <View className="flex-row items-center gap-2">
          <AlertTriangle size={22} color={colors.destructive} />
          <Text className="flex-1 text-xl font-bold text-foreground">{t("deleteAccount.heading")}</Text>
        </View>

        <Text className="text-sm text-foreground">{t("deleteAccount.intro")}</Text>
        <View className="gap-1 rounded-xl border border-border p-4">
          <Text className="text-sm font-semibold text-foreground">{t("deleteAccount.deletedTitle")}</Text>
          <Text className="text-sm text-muted-foreground">{t("deleteAccount.deletedBody")}</Text>
          <Text className="mt-2 text-sm font-semibold text-foreground">{t("deleteAccount.retainedTitle")}</Text>
          <Text className="text-sm text-muted-foreground">{t("deleteAccount.retainedBody")}</Text>
        </View>
        <Text className="text-sm font-semibold text-primary" onPress={() => Linking.openURL(PRIVACY_URL)}>
          {t("deleteAccount.privacyLink")}
        </Text>

        {!eligibility && !loadError && <ActivityIndicator />}
        {loadError && (
          <View className="gap-2">
            <Text className="text-sm" style={{ color: colors.destructive }}>{loadError}</Text>
            <Button variant="outline" onPress={load}>{t("deleteAccount.retry")}</Button>
          </View>
        )}

        {eligibility && !eligibility.eligible && (
          <View className="gap-2 rounded-xl border border-border p-4" accessibilityRole="alert">
            <Text className="text-sm font-semibold text-foreground">{t("deleteAccount.blockedTitle")}</Text>
            {eligibility.blockers.map((b) => (
              <Text key={b.code} className="text-sm text-muted-foreground">• {b.message}</Text>
            ))}
          </View>
        )}

        {eligibility?.eligible && (
          <View className="gap-3">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t("deleteAccount.passwordPlaceholder")}
              secureTextEntry
              autoCapitalize="none"
              accessibilityLabel={t("deleteAccount.passwordPlaceholder")}
              className="rounded-xl border border-border px-4 py-3 text-foreground"
            />
            <Text className="text-sm text-muted-foreground">{t("deleteAccount.typeToConfirm", { word: CONFIRMATION_WORD })}</Text>
            <TextInput
              value={confirmation}
              onChangeText={setConfirmation}
              placeholder={CONFIRMATION_WORD}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={t("deleteAccount.typeToConfirm", { word: CONFIRMATION_WORD })}
              className="rounded-xl border border-border px-4 py-3 text-foreground"
            />
            {error && <Text className="text-sm" style={{ color: colors.destructive }} accessibilityRole="alert">{error}</Text>}
            <Button variant="destructive" onPress={handleDelete} loading={submitting} disabled={!password || !confirmed} fullWidth>
              {t("deleteAccount.submit")}
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
