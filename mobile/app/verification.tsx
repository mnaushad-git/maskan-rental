import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { ShieldCheck, ShieldAlert, Clock, ShieldQuestion } from "lucide-react-native";
import { fetchMyVerification, submitVerification, fetchMyTrustMetrics, type ApiVerification, type ApiTrustMetrics } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage, type Language } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { TrustBadgeCard } from "@/components/TrustBadge";
import { colors } from "@/lib/colors";

function formatDate(iso: string, lang: Language): string {
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const STATUS_ICON = { unverified: ShieldQuestion, pending: Clock, approved: ShieldCheck, rejected: ShieldAlert } as const;
const STATUS_ICON_COLOR = {
  unverified: colors.mutedForeground,
  pending: colors.secondary,
  approved: colors.success,
  rejected: colors.destructive,
} as const;

export default function VerificationScreen() {
  const { t, lang } = useLanguage();
  const { user, authLoading } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [verification, setVerification] = useState<ApiVerification | null>(null);
  const [metrics, setMetrics] = useState<ApiTrustMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [documentReference, setDocumentReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    Promise.all([fetchMyVerification(), fetchMyTrustMetrics()])
      .then(([v, m]) => {
        setVerification(v);
        setMetrics(m);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit() {
    if (!documentReference.trim()) return;
    setSubmitting(true);
    try {
      const next = await submitVerification(documentReference.trim());
      setVerification(next);
      setDocumentReference("");
      toast(t("verification.submitSuccess"), "success");
      fetchMyTrustMetrics().then(setMetrics).catch(() => {});
    } catch (err) {
      toast(err instanceof Error ? err.message : t("verification.submitFailed"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Stack.Screen options={{ title: t("verification.heading") }} />
        <Skeleton height={120} radius={16} />
        <Skeleton height={180} radius={16} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("verification.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("verification.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("auth.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error || !verification) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("verification.heading") }} />
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  const status = verification.verification_status;
  const StatusIcon = STATUS_ICON[status];
  const canSubmit = status === "unverified" || status === "rejected";
  const statusDate =
    status === "pending" && verification.verification_submitted_at
      ? formatDate(verification.verification_submitted_at, lang)
      : status === "approved" && verification.verification_reviewed_at
        ? formatDate(verification.verification_reviewed_at, lang)
        : null;

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("verification.heading") }} />
      <ScrollView contentContainerClassName="gap-5 p-4 pb-10">
        <View className="gap-2 rounded-2xl border border-border p-4">
          <View className="flex-row items-center gap-2">
            <StatusIcon size={20} color={STATUS_ICON_COLOR[status]} />
            <Text className="text-base font-bold text-foreground">{t(`verification.status.${status}`)}</Text>
          </View>
          <Text className="text-sm text-muted-foreground">
            {statusDate ? t(`verification.statusDesc.${status}`, { date: statusDate }) : t(`verification.statusDesc.${status}`)}
          </Text>
        </View>

        {metrics && <TrustBadgeCard metrics={metrics} />}

        {canSubmit && (
          <View className="gap-3 rounded-2xl border border-border p-4">
            <Text className="text-sm text-muted-foreground">{t("verification.intro")}</Text>
            <View className="gap-1.5">
              <Text className="text-xs font-medium text-muted-foreground">{t("verification.documentLabel")}</Text>
              <TextInput
                value={documentReference}
                onChangeText={setDocumentReference}
                placeholder={t("verification.documentPlaceholder")}
                autoCapitalize="characters"
                className="rounded-xl border border-border px-4 py-3 text-foreground"
              />
              <Text className="text-[11px] text-muted-foreground">{t("verification.documentHelp")}</Text>
            </View>
            <Button onPress={handleSubmit} disabled={!documentReference.trim()} loading={submitting} fullWidth>
              {status === "rejected" ? t("verification.resubmit") : t("verification.submit")}
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
