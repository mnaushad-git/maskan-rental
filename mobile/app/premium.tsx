import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Sparkles, Zap, MessageCircleMore, BadgeCheck } from "lucide-react-native";
import {
  fetchMySubscription,
  subscribeToPremium,
  renewPremium,
  unsubscribeFromPremium,
  type ApiSubscription,
} from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";
import { useLanguage, type Language } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ErrorState";
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

const BENEFIT_ICONS = [Zap, MessageCircleMore, BadgeCheck] as const;

export default function PremiumScreen() {
  const { t, lang } = useLanguage();
  const { user, authLoading, refreshUser } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [subscription, setSubscription] = useState<ApiSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    fetchMySubscription()
      .then(setSubscription)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubscribe() {
    setBusy(true);
    try {
      const result = await subscribeToPremium();
      if (result.payment_url) {
        await Linking.openURL(result.payment_url);
        return;
      }
      toast(t("premium.subscribeSuccess"), "success");
      await Promise.all([load(), refreshUser()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("premium.actionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRenew() {
    setBusy(true);
    try {
      await renewPremium();
      toast(t("premium.renewSuccess"), "success");
      await Promise.all([load(), refreshUser()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("premium.actionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    try {
      await unsubscribeFromPremium();
      toast(t("premium.cancelSuccess"), "success");
      await Promise.all([load(), refreshUser()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("premium.actionFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || loading) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 gap-4 bg-background p-4">
        <Stack.Screen options={{ title: t("premium.heading") }} />
        <Skeleton height={140} radius={16} />
        <Skeleton height={220} radius={16} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Stack.Screen options={{ title: t("premium.heading") }} />
        <Text className="text-center text-base font-semibold text-foreground">{t("premium.signInToView")}</Text>
        <Button onPress={() => router.push("/auth/login")}>{t("auth.signIn")}</Button>
      </SafeAreaView>
    );
  }

  if (error || !subscription) {
    return (
      <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
        <Stack.Screen options={{ title: t("premium.heading") }} />
        <ErrorState onRetry={load} />
      </SafeAreaView>
    );
  }

  const isActive = subscription.subscription_status === "active";
  const benefits = [t("premium.benefit.instantAlerts"), t("premium.benefit.unlimitedChat"), t("premium.benefit.badge")];

  return (
    <SafeAreaView edges={["bottom"]} className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("premium.heading") }} />
      <ScrollView contentContainerClassName="gap-5 p-4 pb-10">
        <View className="items-center gap-2 rounded-2xl border border-ai/30 bg-ai-soft p-5">
          <View className="size-14 items-center justify-center rounded-2xl bg-ai/15">
            <Sparkles size={28} color={colors.ai} />
          </View>
          <Text className="text-center text-lg font-bold text-foreground">{t("premium.title")}</Text>
          <Text className="text-center text-sm text-muted-foreground">{t("premium.subtitle")}</Text>
        </View>

        <View className="gap-2 rounded-2xl border border-border p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">{t("premium.currentPlan")}</Text>
            <View className={`rounded-full px-2.5 py-1 ${isActive ? "bg-ai/15" : "bg-surface-2"}`}>
              <Text className={`text-xs font-bold ${isActive ? "" : "text-muted-foreground"}`} style={isActive ? { color: colors.ai } : undefined}>
                {isActive ? t("premium.tier.premium") : t("premium.tier.free")}
              </Text>
            </View>
          </View>
          <Text className="text-xs text-muted-foreground">
            {isActive && subscription.subscription_expires_at
              ? t("premium.statusDesc.activeUntil", { date: formatDate(subscription.subscription_expires_at, lang) })
              : subscription.subscription_status === "cancelled"
                ? t("premium.statusDesc.cancelled")
                : subscription.subscription_status === "expired"
                  ? t("premium.statusDesc.expired")
                  : t("premium.statusDesc.free")}
          </Text>
        </View>

        <View className="gap-3 rounded-2xl border border-border p-4">
          <Text className="text-sm font-semibold text-foreground">{t("premium.benefitsHeading")}</Text>
          {benefits.map((label, i) => {
            const Icon = BENEFIT_ICONS[i];
            return (
              <View key={label} className="flex-row items-start gap-3">
                <View className="mt-0.5 size-8 items-center justify-center rounded-full bg-ai-soft">
                  <Icon size={16} color={colors.ai} />
                </View>
                <Text className="flex-1 text-sm leading-5 text-foreground">{label}</Text>
              </View>
            );
          })}
        </View>

        {isActive ? (
          <View className="gap-2">
            <Button onPress={handleRenew} loading={busy} fullWidth>
              {t("premium.renew")}
            </Button>
            <Button onPress={handleUnsubscribe} loading={busy} variant="outline" fullWidth>
              {t("premium.cancel")}
            </Button>
          </View>
        ) : (
          <Button onPress={handleSubscribe} loading={busy} fullWidth>
            {t("premium.subscribeCta")}
          </Button>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
